import { createHash, randomUUID } from 'node:crypto';
import { access, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  MediaInfo,
  QualityDecision,
  QualityProfile,
  QueueJob,
  ResourceProfile
} from '@shared/types/domain.js';
import { decideQuality } from '@shared/utils/quality-decision.js';
import {
  isNvencEncoder,
  selectVideoEncoder,
  type ResolvedVideoEncoder
} from '@shared/utils/encoder-selection.js';
import { sanitizeFilename } from '@shared/utils/filename.js';
import { matchNormalizationTarget } from '@shared/utils/normalization-match.js';
import { sourceEquivalentVideoBitrate } from '@shared/utils/merge-target.js';
import { sanitizeProgress } from '@shared/utils/progress-policy.js';
import { ProcessingFailedError, ToolNotFoundError } from '@shared/errors/app-errors.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ProcessManager, ProcessResult } from '../processes/process-manager.js';
import type { MediaAnalyzer } from '../media/media-analyzer.js';
import type { FileVerifier } from '../media/file-verifier.js';
import type { QuarantineService } from '../media/quarantine-service.js';
import type { Logger } from '../logging/logger.js';
import { ensureDirectory } from '../files/ensure-directory.js';
import { ensureTubmediaOwnedDirectory, isReservedTubmediaDirectory } from '../files/file-ownership.js';

export interface NormalizeTarget {
  width: number;
  height: number;
  fps: number;
  hdr: boolean;
  videoCodec: 'h264' | 'hevc';
  pixelFormat: string;
  audioCodec: 'aac' | null;
  sampleRate: number | null;
  channels: number | null;
  videoBitrate?: number | null;
}

function safeCpuPreset(value: string | undefined): string {
  if (!value || /^p[1-7]$/i.test(value)) return 'veryfast';
  return value;
}

function safeNvencPreset(value: string | undefined): string {
  return value && /^p[1-7]$/i.test(value) ? value.toLowerCase() : 'p5';
}

function normalizedExtension(path: string): string {
  return extname(path).toLocaleLowerCase('en-US');
}

/**
 * Tệp tạm riêng cho MỖI lần làm bản đệm (hai quy trình dùng chung một nguồn trước đây cùng ghi vào "<bản đệm>.pending.mp4").
 * Giữ đuôi ".pending.mp4" để bộ dọn rác vẫn nhận ra.
 */
function cachePendingPath(final: string): string {
  return final + '.' + randomUUID().slice(0, 8) + '.pending.mp4';
}

export class NormalizeEngine {
  public constructor(
    private readonly tools: ToolManager,
    private readonly processes: ProcessManager,
    private readonly analyzer: MediaAnalyzer,
    private readonly verifier: FileVerifier,
    private readonly quarantine: QuarantineService,
    private readonly logger: Logger
  ) {}

  public async normalize(
    job: QueueJob,
    input: string,
    outputFolder: string,
    profile: QualityProfile,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (percent: number) => void
  ): Promise<string> {
    const source = await this.analyzer.analyze(input, job.id);
    const decision = decideQuality(source, profile);
    if (decision.action === 'COPY') return input;

    const target: NormalizeTarget = {
      width: decision.target.width,
      height: decision.target.height,
      fps: decision.target.fps,
      hdr: decision.target.hdr,
      videoCodec: decision.target.videoCodec === 'hevc' ? 'hevc' : 'h264',
      pixelFormat: decision.target.pixelFormat,
      audioCodec: decision.target.audioCodec ? 'aac' : null,
      sampleRate: decision.target.sampleRate,
      channels: decision.target.channels,
      videoBitrate: null
    };

    return this.normalizeToTarget(
      job,
      input,
      source,
      outputFolder,
      target,
      resource,
      signal,
      onProgress,
      profile,
      decision
    );
  }

  /**
   * Remux stream-compatible media to a clean MP4 without re-encoding.
   * This is the fast fallback for mixed containers or broken timestamps before
   * resorting to an expensive full normalization pass.
   *
   * `sourceDecodeVerified`: nguồn đã được giải mã toàn bộ ngay trước đó (bước "kiểm tra toàn bộ nguồn stream-copy" của
   * MergeEngine) → tệp vừa remux chỉ cần kiểm standard, khỏi giải mã lần hai.
   */
  public async remuxForConcat(
    job: QueueJob,
    input: string,
    outputFolder: string,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (percent: number) => void,
    options: { sourceDecodeVerified?: boolean } = {}
  ): Promise<string> {
    const source = await this.analyzer.analyze(input, job.id);
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    await ensureDirectory(outputFolder);
    if (isReservedTubmediaDirectory(outputFolder)) {
      await ensureTubmediaOwnedDirectory(outputFolder, 'normalize-cache');
    }
    const key = await this.cacheKey(input, {
      operation: 'remux-v4-core-resilience',
      format: 'mp4',
      videoCodec: source.videoCodec,
      audioCodec: source.audioCodec
    });
    const safe = sanitizeFilename(basename(input).replace(/\.[^.]+$/, ''));
    const final = join(outputFolder, `${safe}.${key}.remux.mp4`);
    const pending = cachePendingPath(final);

    if (await this.validRemuxCache(final, source, job, signal)) {
      this.logger.info('normalize', 'REMUX_CACHE_HIT', 'Đã dùng lại tệp remux tương thích trong bộ nhớ đệm.', {
        ...(job.projectId ? { projectId: job.projectId } : {}),
        jobId: job.id,
        metadata: { input, cached: final }
      });
      onProgress(100);
      return final;
    }

    await rm(pending, { force: true });
    const result = await this.processes.run({
      jobId: job.id,
      projectId: job.projectId,
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath,
      args: [
        '-hide_banner', '-nostdin', '-y',
        '-fflags', '+genpts',
        '-copyts',
        '-start_at_zero',
        '-i', input,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-video_track_timescale', '90000',
        '-progress', 'pipe:1',
        '-nostats',
        pending
      ],
      priority: resource.processPriority,
      signal,
      timeoutMs: 12 * 60 * 60 * 1000,
      onStdoutLine: (line) => {
        if (!line.startsWith('out_time_ms=')) return;
        const microseconds = Number(line.slice(12));
        if (!Number.isFinite(microseconds) || source.duration <= 0) return;
        onProgress(sanitizeProgress((microseconds / 1_000_000 / source.duration) * 100));
      }
    });

    if (result.code !== 0) {
      await rm(pending, { force: true });
      throw new ProcessingFailedError(result.stderrTail || 'Remux video thất bại.');
    }

    // Tệp vừa remux phải giải mã được TOÀN BỘ hình + tiếng (mức deep, như bản đệm lấy lại — FIX18). Remux là chép luồng nên
    // gói hỏng của nguồn đi thẳng sang; ở bước chuẩn hóa timestamp, tệp remux thay chỗ nguồn nên nguồn cũng không qua bước
    // "kiểm tra toàn bộ nguồn stream-copy" của MergeEngine — trước đây tiếng hỏng lọt tới tận hậu kiểm thành phẩm.
    const level = options.sourceDecodeVerified ? 'standard' : 'deep';
    const check = await this.verifier.verify(pending, level, source.duration, {
      jobId: job.id,
      projectId: job.projectId,
      signal,
      expectedStreams: { video: true, audio: source.audioCodec !== null }
    });
    if (signal.aborted) {
      // Tạm dừng/hủy giữa lúc kiểm: tệp chưa bị chứng minh là hỏng → không cách ly, chỉ bỏ tệp tạm.
      await rm(pending, { force: true }).catch(() => undefined);
      throw signal.reason instanceof Error ? signal.reason : new Error('Đã dừng khi đang kiểm tệp remux.');
    }
    if (!check.ok) {
      const reason = check.reasons.join('; ');
      this.logger.warn('normalize', 'REMUX_FRESH_REJECTED', 'Tệp vừa remux không qua kiểm tra giải mã — không dùng làm bản đệm.', {
        ...(job.projectId ? { projectId: job.projectId } : {}),
        jobId: job.id,
        metadata: { input, level, reason: reason.slice(0, 1_500) }
      });
      const quarantined = await this.quarantine.move(pending, reason, { jobId: job.id, projectId: job.projectId });
      throw new ProcessingFailedError(
        level === 'deep'
          ? `Tệp remux không giải mã được toàn bộ — remux chép nguyên luồng nên lỗi nằm ở video nguồn ${basename(input)} ` +
              `(${reason.slice(0, 300)}). Tệp lỗi đã chuyển vào khu cách ly: ${quarantined}`
          : `Tệp remux bị lỗi, đã chuyển vào khu cách ly: ${quarantined}`
      );
    }

    const committed = await this.commitCacheFile(pending, final, job);
    onProgress(100);
    return committed;
  }

  public async normalizeToTarget(
    job: QueueJob,
    input: string,
    source: MediaInfo,
    outputFolder: string,
    target: NormalizeTarget,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (percent: number) => void,
    profile?: QualityProfile,
    existingDecision?: QualityDecision,
    forceVideoTranscode = false,
    forceAudioTranscode = false
  ): Promise<string> {
    /* TUBMEDIA FORCE VIDEO NORMALIZE R33 */
    const streamMatch = matchNormalizationTarget(source, target);
    const matches =
      streamMatch.videoMatches &&
      streamMatch.audioMatches &&
      !forceVideoTranscode &&
      !forceAudioTranscode;

    if (matches) return input;

    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    await ensureDirectory(outputFolder);
    if (isReservedTubmediaDirectory(outputFolder)) {
      await ensureTubmediaOwnedDirectory(outputFolder, 'normalize-cache');
    }
    const cacheKey = await this.cacheKey(input, {
      operation: forceVideoTranscode
        ? 'normalize-v6-force-video-core-resilience'
        : forceAudioTranscode
          ? 'normalize-v6-force-audio-core-resilience'
          : 'normalize-v5-core-resilience',
      target,
      encoder: profile?.encoder ?? 'cpu_auto',
      crf: profile?.crf ?? 18,
      cq: profile?.cq ?? 20,
      bitrateMode: profile?.bitrateMode ?? 'quality',
      preset: profile?.preset ?? 'veryfast',
      audioMode: profile?.audioMode ?? 'aac_256'
    });
    const safe = sanitizeFilename(basename(input).replace(/\.[^.]+$/, ''));
    const final = join(
      outputFolder,
      `${safe}.${cacheKey}.normalized-${target.width}x${target.height}-${Math.round(target.fps * 100) / 100}fps.mp4`
    );
    const pending = cachePendingPath(final);

    if (await this.validNormalizeCache(final, target, job, signal)) {
      this.logger.info('normalize', 'NORMALIZE_CACHE_HIT', 'Đã dùng lại video chuẩn hóa hợp lệ trong bộ nhớ đệm.', {
        ...(job.projectId ? { projectId: job.projectId } : {}),
        jobId: job.id,
        metadata: { input, cached: final }
      });
      onProgress(100);
      return final;
    }

    const caps = ffmpeg.capabilities;
    const requested = profile?.encoder ?? 'cpu_auto';
    const videoCopy = streamMatch.videoCopy && !forceVideoTranscode;
    const audioCopy = streamMatch.audioCopy && !forceAudioTranscode;
    const addSilentAudio = streamMatch.addSilentAudio;

    const filters: string[] = [];
    if (source.hdr && !target.hdr) {
      if (!caps.includes('zscale') || !caps.includes('tonemap')) {
        throw new ProcessingFailedError('FFmpeg thiếu zscale/tonemap để chuyển HDR sang SDR.');
      }
      filters.push(
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'tonemap=hable:desat=0',
        'zscale=p=bt709:t=bt709:m=bt709:r=tv'
      );
    }

    if (source.width !== target.width || source.height !== target.height) {
      const allowUpscale = profile?.allowUpscale === true;
      const scaleWidth = allowUpscale ? String(target.width) : `min(iw\\,${target.width})`;
      const scaleHeight = allowUpscale ? String(target.height) : `min(ih\\,${target.height})`;
      filters.push(
        `scale=w='${scaleWidth}':h='${scaleHeight}':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
        `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black`
      );

      if (!allowUpscale && (source.width < target.width || source.height < target.height)) {
        this.logger.info(
          'normalize',
          'MERGE_NO_UPSCALE_PADDING',
          'Clip nhỏ được giữ nguyên tỷ lệ và thêm viền để không phóng lớn hoặc cắt mất nội dung.',
          {
            ...(job.projectId ? { projectId: job.projectId } : {}),
            jobId: job.id,
            metadata: {
              sourceWidth: source.width,
              sourceHeight: source.height,
              targetWidth: target.width,
              targetHeight: target.height
            }
          }
        );
      }
    }
    if (Math.abs(source.fps - target.fps) >= 0.01) filters.push(`fps=${target.fps}`);
    if (!videoCopy) filters.push('setsar=1', `format=${target.pixelFormat}`);

    const selection = selectVideoEncoder(target.videoCodec, requested, caps, resource.gpuJobs);

    if (!videoCopy && selection.usedCpuFallback && selection.reason) {
      this.logger.warn('normalize', 'ENCODER_CPU_FALLBACK', selection.reason, {
        ...(job.projectId ? { projectId: job.projectId } : {}),
        jobId: job.id,
        metadata: {
          requestedEncoder: requested,
          selectedEncoder: selection.encoder,
          targetCodec: target.videoCodec
        }
      });
    }

    const sourceSizeBitrate =
      profile?.bitrateMode === 'source_average'
        ? target.videoBitrate ?? sourceEquivalentVideoBitrate(source)
        : null;

    const buildArgs = (encoder: ResolvedVideoEncoder): string[] => {
      const args = ['-hide_banner', '-nostdin', '-y', '-xerror', '-err_detect', 'explode', '-i', input];
      if (addSilentAudio) {
        args.push(
          '-f',
          'lavfi',
          '-i',
          `anullsrc=channel_layout=${(target.channels ?? 2) === 1 ? 'mono' : 'stereo'}:sample_rate=${target.sampleRate ?? 48000}`
        );
      }

      args.push('-map', '0:v:0');
      if (target.audioCodec) args.push('-map', addSilentAudio ? '1:a:0' : '0:a:0?');
      else args.push('-an');
      if (filters.length) args.push('-vf', filters.join(','));

      if (videoCopy) {
        args.push('-c:v', 'copy');
      } else {
        args.push('-c:v', encoder);
        const preset = isNvencEncoder(encoder)
          ? safeNvencPreset(profile?.preset)
          : safeCpuPreset(profile?.preset);
        if (profile?.bitrateMode === 'source_average' && sourceSizeBitrate && sourceSizeBitrate > 0) {
          const bitrate = Math.round(sourceSizeBitrate);
          args.push(
            '-preset', preset,
            '-b:v', String(bitrate),
            '-minrate', String(Math.round(bitrate * 0.85)),
            '-maxrate', String(Math.round(bitrate * 1.15)),
            '-bufsize', String(Math.round(bitrate * 2))
          );
        } else if (isNvencEncoder(encoder)) {
          args.push('-preset', preset, '-cq', String(profile?.cq ?? 20), '-b:v', '0');
        } else {
          args.push('-preset', preset, '-crf', String(profile?.crf ?? 18));
        }
        args.push(
          '-threads', String(resource.ffmpegThreads),
          '-filter_threads', String(resource.filterThreads),
          '-filter_complex_threads', String(resource.filterComplexThreads),
          '-pix_fmt', target.pixelFormat
        );
      }

      if (target.audioCodec) {
        if (audioCopy && !addSilentAudio) args.push('-c:a', 'copy');
        else {
          args.push(
            '-c:a', 'aac',
            '-b:a', profile?.audioMode === 'aac_320' ? '320k' : '256k',
            '-ar', String(target.sampleRate ?? 48000),
            '-ac', String(target.channels ?? 2)
          );
        }
      }

      if (addSilentAudio) args.push('-shortest');
      if (!target.hdr) {
        args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
      }
      args.push(
        '-map_metadata', '-1',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-video_track_timescale', '90000',
        '-progress', 'pipe:1',
        '-nostats',
        pending
      );
      return args;
    };

    const runEncoder = async (encoder: ResolvedVideoEncoder): Promise<ProcessResult> => {
      await rm(pending, { force: true });
      this.logger.info(
        'normalize',
        'ENCODER_SELECTED',
        videoCopy ? 'Video tương thích, sử dụng stream copy.' : `Encoder đang dùng: ${encoder}.`,
        {
          ...(job.projectId ? { projectId: job.projectId } : {}),
          jobId: job.id,
          metadata: {
            requestedEncoder: requested,
            encoder,
            targetCodec: target.videoCodec,
            videoStreamCopy: videoCopy,
            audioStreamCopy: audioCopy
          }
        }
      );
      return this.processes.run({
        jobId: job.id,
        projectId: job.projectId,
        tool: 'ffmpeg',
        executablePath: ffmpeg.executablePath!,
        args: buildArgs(encoder),
        priority: resource.processPriority,
        signal,
        timeoutMs: 48 * 60 * 60 * 1000,
        onStdoutLine: (line) => {
          if (!line.startsWith('out_time_ms=')) return;
          const microseconds = Number(line.slice(12));
          if (!Number.isFinite(microseconds) || !Number.isFinite(source.duration) || source.duration <= 0) return;
          onProgress(sanitizeProgress((microseconds / 1_000_000 / source.duration) * 100));
        }
      });
    };

    let encoder = selection.encoder;
    let result = await runEncoder(encoder);

    if (!videoCopy && result.code !== 0 && isNvencEncoder(encoder)) {
      const failedEncoder = encoder;
      encoder = selection.cpuEncoder;
      this.logger.warn(
        'normalize',
        'NVENC_RUNTIME_FAILED_CPU_RETRY',
        `NVENC không khởi động được. Ứng dụng tự chuyển sang ${encoder} và thử lại.`,
        {
          ...(job.projectId ? { projectId: job.projectId } : {}),
          jobId: job.id,
          metadata: {
            failedEncoder,
            cpuEncoder: encoder,
            technicalTail: result.stderrTail.slice(-1200)
          }
        }
      );
      onProgress(0);
      result = await runEncoder(encoder);
    }

    if (result.code !== 0) {
      try {
        await this.quarantine.move(
          pending,
          result.stderrTail || 'Normalize thất bại.',
          { jobId: job.id, projectId: job.projectId }
        );
      } catch {
        // pending chưa tồn tại
      }
      throw new ProcessingFailedError(
        result.stderrTail || existingDecision?.reasons.join('; ') || 'Normalize thất bại.'
      );
    }

    const check = await this.verifier.verify(pending, 'standard', source.duration, {
      jobId: job.id,
      projectId: job.projectId,
      signal,
      expectedStreams: { video: true, audio: target.audioCodec !== null }
    });
    if (!check.ok) {
      const quarantined = await this.quarantine.move(
        pending,
        check.reasons.join('; '),
        { jobId: job.id, projectId: job.projectId }
      );
      throw new ProcessingFailedError(`Tệp chuẩn hóa bị lỗi và đã chuyển vào khu cách ly: ${quarantined}`);
    }

    // Tiếng vừa mã hóa lại phải giải mã được TOÀN BỘ (rẻ). Vụ khách 2026-10-15: bộ mã hóa AAC của ffmpeg 8.0 (gyan.dev)
    // tạo một gói hỏng giữa NA361 ở 256k/48 kHz — kiểm 3 khung hình không thấy, hậu kiểm thành phẩm mới chặn.
    if (target.audioCodec && !audioCopy && !addSilentAudio) {
      await this.repairCorruptAudioEncode(job, input, pending, target, resource, signal, profile, ffmpeg.version);
    }

    const committed = await this.commitCacheFile(pending, final, job);
    onProgress(100);
    return committed;
  }

  /**
   * Luồng tiếng của tệp vừa chuẩn hóa không giải mã được → mã hóa lại CHỈ phần tiếng từ nguồn bằng bộ mã hóa AAC dự phòng
   * (-aac_coder fast), giữ nguyên phần hình đã mã hóa. Vẫn hỏng → cách ly và báo lỗi nêu rõ phiên bản ffmpeg.
   */
  private async repairCorruptAudioEncode(
    job: QueueJob,
    input: string,
    pending: string,
    target: NormalizeTarget,
    resource: ResourceProfile,
    signal: AbortSignal,
    profile: QualityProfile | undefined,
    ffmpegVersion: string | null
  ): Promise<void> {
    const options = { jobId: job.id, projectId: job.projectId, signal };
    const failure = await this.verifier.decodeStreamFailure(pending, 'audio', options);
    if (!failure) return;
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Đã dừng khi đang kiểm tiếng.');

    const context = { ...(job.projectId ? { projectId: job.projectId } : {}), jobId: job.id };
    this.logger.warn(
      'normalize',
      'NORMALIZE_AUDIO_ENCODE_CORRUPT',
      'Bộ mã hóa AAC của ffmpeg tạo luồng tiếng hỏng — đang mã hóa lại phần tiếng bằng cách dự phòng.',
      { ...context, metadata: { input, ffmpegVersion, ffmpegError: failure } }
    );

    const ffmpeg = this.tools.get('ffmpeg');
    const repaired = `${pending}.audio-fallback.mp4`;
    await rm(repaired, { force: true });
    const result = await this.processes.run({
      jobId: job.id,
      projectId: job.projectId,
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath!,
      args: [
        '-hide_banner', '-nostdin', '-y', '-xerror', '-err_detect', 'explode',
        '-i', pending,
        '-i', input,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-aac_coder', 'fast',
        '-b:a', profile?.audioMode === 'aac_320' ? '320k' : '256k',
        '-ar', String(target.sampleRate ?? 48000),
        '-ac', String(target.channels ?? 2),
        '-map_metadata', '-1',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-video_track_timescale', '90000',
        '-nostats',
        repaired
      ],
      priority: resource.processPriority,
      signal,
      timeoutMs: 12 * 60 * 60 * 1000
    });

    const stillBroken =
      result.code !== 0
        ? result.stderrTail || 'Mã hóa lại phần tiếng thất bại.'
        : await this.verifier.decodeStreamFailure(repaired, 'audio', options);
    if (stillBroken) {
      await rm(repaired, { force: true }).catch(() => undefined);
      const quarantined = await this.quarantine.move(pending, failure, { jobId: job.id, projectId: job.projectId });
      throw new ProcessingFailedError(
        `ffmpeg ${ffmpegVersion ?? ''} tạo luồng tiếng hỏng khi chuẩn hóa và mã hóa lại cũng không sửa được ` +
          `(${stillBroken.slice(0, 300)}). Tệp lỗi đã chuyển vào khu cách ly: ${quarantined}`
      );
    }
    await rm(pending, { force: true });
    await rename(repaired, pending);
    this.logger.info('normalize', 'NORMALIZE_AUDIO_ENCODE_REPAIRED', 'Đã mã hóa lại phần tiếng; luồng tiếng giải mã sạch.', {
      ...context,
      metadata: { input, ffmpegVersion }
    });
  }

  /**
   * Chốt tệp vừa làm thành bản đệm. Hai quy trình dùng chung một nguồn có thể cùng làm lại một bản đệm: trước đây chốt bằng
   * rm(bản đệm) + rename — bản đệm đang bị quy trình kia mở (đang ghép) thì Windows từ chối xóa (EBUSY) → quy trình này hỏng.
   * Giờ ghi đè thẳng; không ghi đè được (đang bị mở) thì dùng tệp vừa làm dưới tên riêng cho quy trình này, KHÔNG dùng bản
   * đệm cũ (có thể chính là bản vừa bị loại vì không qua kiểm tra).
   */
  private async commitCacheFile(pending: string, final: string, job: QueueJob): Promise<string> {
    try {
      await rename(pending, final);
      return final;
    } catch (error) {
      const own = final.replace(/\.mp4$/i, '') + '.' + randomUUID().slice(0, 8) + '.mp4';
      await rename(pending, own);
      this.logger.warn('normalize', 'NORMALIZE_CACHE_IN_USE', 'Bản đệm đang được quy trình khác dùng — quy trình này dùng bản vừa làm dưới tên riêng.', {
        ...(job.projectId ? { projectId: job.projectId } : {}),
        jobId: job.id,
        metadata: { cached: final, used: own, error: error instanceof Error ? error.message : String(error) }
      });
      return own;
    }
  }

  private async cacheKey(input: string, payload: Record<string, unknown>): Promise<string> {
    const file = await stat(input);
    return createHash('sha256')
      .update(JSON.stringify({
        path: input.toLocaleLowerCase('en-US'),
        size: file.size,
        modified: Math.round(file.mtimeMs),
        extension: normalizedExtension(input),
        ...payload
      }))
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Bản đệm chỉ được dùng lại sau khi GIẢI MÃ TOÀN BỘ hình + tiếng (mức deep). Trước đây chỉ thử 3 khung hình (standard,
   * không giải mã tiếng): vụ khách 2026-10-15 có bản đệm hỏng một gói AAC ở giữa, được coi là hợp lệ và dùng lại ở MỌI
   * lần ghép — lần nào hậu kiểm cũng chặn ở cùng chỗ. Bản đệm không qua được thì xóa để làm lại từ nguồn.
   * Bản đệm không đi qua bước "kiểm tra toàn bộ nguồn stream-copy" của MergeEngine nên phải tự kiểm ở đây.
   */
  private async validNormalizeCache(
    path: string,
    target: NormalizeTarget,
    job: QueueJob,
    signal: AbortSignal
  ): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
    } catch {
      return false;
    }
    try {
      /* TUBMEDIA VERIFIED CACHE REUSE R35 */
      const info = await this.analyzer.analyze(path, job.id);
      const match = matchNormalizationTarget(info, target);
      if (!(match.videoMatches && match.audioMatches && info.timeBase === '1/90000')) {
        throw new Error('Bản đệm không còn khớp thông số chuẩn hóa.');
      }
      await this.assertCacheDecodes(path, info.duration, target.audioCodec !== null, job, signal);
      return true;
    } catch (error) {
      await this.rejectCache('NORMALIZE_CACHE_REJECTED', path, error, job, signal);
      return false;
    }
  }

  private async validRemuxCache(
    path: string,
    source: MediaInfo,
    job: QueueJob,
    signal: AbortSignal
  ): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
    } catch {
      return false;
    }
    try {
      /* TUBMEDIA VERIFIED CACHE REUSE R35 */
      const info = await this.analyzer.analyze(path, job.id);
      const matches =
        Math.abs(info.duration - source.duration) <= Math.max(1.5, source.duration * 0.01) &&
        info.videoCodec === source.videoCodec &&
        info.width === source.width &&
        info.height === source.height &&
        info.audioCodec === source.audioCodec &&
        info.timeBase === '1/90000';
      if (!matches) throw new Error('Bản đệm remux không còn khớp với nguồn.');
      await this.assertCacheDecodes(path, source.duration, source.audioCodec !== null, job, signal);
      return true;
    } catch (error) {
      await this.rejectCache('REMUX_CACHE_REJECTED', path, error, job, signal);
      return false;
    }
  }

  private async assertCacheDecodes(
    path: string,
    duration: number,
    audio: boolean,
    job: QueueJob,
    signal: AbortSignal
  ): Promise<void> {
    const check = await this.verifier.verify(path, 'deep', duration, {
      jobId: job.id + '-cache-check',
      projectId: job.projectId,
      signal,
      expectedStreams: { video: true, audio }
    });
    if (!check.ok) throw new Error(check.reasons.join('; '));
  }

  private async rejectCache(
    eventCode: 'NORMALIZE_CACHE_REJECTED' | 'REMUX_CACHE_REJECTED',
    path: string,
    error: unknown,
    job: QueueJob,
    signal: AbortSignal
  ): Promise<void> {
    // Tạm dừng/hủy giữa lúc kiểm: bản đệm chưa bị chứng minh là hỏng → giữ lại, để lần sau kiểm tiếp.
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Đã dừng khi đang kiểm bản đệm.');
    this.logger.warn('normalize', eventCode, 'Bản đệm không qua kiểm tra giải mã toàn bộ — xóa và làm lại từ nguồn.', {
      ...(job.projectId ? { projectId: job.projectId } : {}),
      jobId: job.id,
      metadata: {
        cached: path,
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 1_500)
      }
    });
    await rm(path, { force: true }).catch(() => undefined);
  }
}
