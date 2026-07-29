import { createHash } from 'node:crypto';
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
   */
  public async remuxForConcat(
    job: QueueJob,
    input: string,
    outputFolder: string,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (percent: number) => void
  ): Promise<string> {
    const source = await this.analyzer.analyze(input, job.id);
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    await ensureDirectory(outputFolder);
    if (isReservedTubmediaDirectory(outputFolder)) {
      await ensureTubmediaOwnedDirectory(outputFolder, 'normalize-cache');
    }
    const key = await this.cacheKey(input, {
      operation: 'remux-v3-timestamp-reset',
      format: 'mp4',
      videoCodec: source.videoCodec,
      audioCodec: source.audioCodec
    });
    const safe = sanitizeFilename(basename(input).replace(/\.[^.]+$/, ''));
    const final = join(outputFolder, `${safe}.${key}.remux.mp4`);
    const pending = `${final}.pending.mp4`;

    if (await this.validRemuxCache(final, source, job.id)) {
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

    const check = await this.verifier.verify(pending, 'fast', source.duration, {
      jobId: job.id,
      projectId: job.projectId,
      signal
    });
    if (!check.ok) {
      const quarantined = await this.quarantine.move(
        pending,
        join(outputFolder, '_quarantine'),
        check.reasons.join('; '),
        job.id
      );
      throw new ProcessingFailedError(`Tệp remux bị lỗi, đã chuyển vào khu cách ly: ${quarantined}`);
    }

    await rm(final, { force: true });
    await rename(pending, final);
    onProgress(100);
    return final;
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
    existingDecision?: QualityDecision
  ): Promise<string> {
    const streamMatch = matchNormalizationTarget(source, target);
    const matches = streamMatch.videoMatches && streamMatch.audioMatches;

    if (matches) return input;

    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    await ensureDirectory(outputFolder);
    if (isReservedTubmediaDirectory(outputFolder)) {
      await ensureTubmediaOwnedDirectory(outputFolder, 'normalize-cache');
    }
    const cacheKey = await this.cacheKey(input, {
      operation: 'normalize-v3',
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
    const pending = `${final}.pending.mp4`;

    if (await this.validNormalizeCache(final, target, job.id)) {
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
    const videoCopy = streamMatch.videoCopy;
    const audioCopy = streamMatch.audioCopy;
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
      const args = ['-hide_banner', '-nostdin', '-y', '-i', input];
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
          join(outputFolder, '_quarantine'),
          result.stderrTail || 'Normalize thất bại.',
          job.id
        );
      } catch {
        // pending chưa tồn tại
      }
      throw new ProcessingFailedError(
        result.stderrTail || existingDecision?.reasons.join('; ') || 'Normalize thất bại.'
      );
    }

    const check = await this.verifier.verify(pending, 'fast', source.duration, {
      jobId: job.id,
      projectId: job.projectId,
      signal
    });
    if (!check.ok) {
      const quarantined = await this.quarantine.move(
        pending,
        join(outputFolder, '_quarantine'),
        check.reasons.join('; '),
        job.id
      );
      throw new ProcessingFailedError(`Tệp chuẩn hóa bị lỗi và đã chuyển vào khu cách ly: ${quarantined}`);
    }

    await rm(final, { force: true });
    await rename(pending, final);
    onProgress(100);
    return final;
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

  private async validNormalizeCache(
    path: string,
    target: NormalizeTarget,
    jobId: string
  ): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
      const info = await this.analyzer.analyze(path, jobId);
      const match = matchNormalizationTarget(info, target);
      return match.videoMatches && match.audioMatches;
    } catch {
      await rm(path, { force: true }).catch(() => undefined);
      return false;
    }
  }

  private async validRemuxCache(path: string, source: MediaInfo, jobId: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
      const info = await this.analyzer.analyze(path, jobId);
      return (
        Math.abs(info.duration - source.duration) <= Math.max(1.5, source.duration * 0.01) &&
        info.videoCodec === source.videoCodec &&
        info.width === source.width &&
        info.height === source.height &&
        info.audioCodec === source.audioCodec
      );
    } catch {
      await rm(path, { force: true }).catch(() => undefined);
      return false;
    }
  }
}
