import {
  sanitizeNonNegativeNumber,
  sanitizeNullableSeconds,
  sanitizeProgress
} from '@shared/utils/progress-policy.js';
import { access, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type {
  MediaInfo,
  QualityProfile,
  QueueJob,
  ResourceProfile,
  TimelineRow
} from '@shared/types/domain.js';
import { compareForConcat } from '@shared/utils/concat-compatibility.js';
import { matchNormalizationTarget } from '@shared/utils/normalization-match.js';
import { sanitizeFilename } from '@shared/utils/filename.js';
import { chooseMergeTarget, validateMergeOutputSize } from '@shared/utils/merge-target.js';
import { FfmpegProgressTracker } from '@shared/utils/ffmpeg-progress.js';
import { formatTimelineLine } from '@shared/utils/timestamp.js';
import { MergeFailedError, ToolNotFoundError } from '@shared/errors/app-errors.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ProcessManager, ProcessResult } from '../processes/process-manager.js';
import type { MediaAnalyzer } from '../media/media-analyzer.js';
import type {
  FileVerifier,
  VerificationOptions,
  VerificationResult
} from '../media/file-verifier.js';
import type { NormalizeEngine, NormalizeTarget } from '../normalize/normalize-engine.js';
import type { TimelineArtifact, TimelineService } from './timeline-service.js';
import type { QuarantineService } from '../media/quarantine-service.js';
import { ensureDirectory } from '../files/ensure-directory.js';
import { ensureTubmediaOwnedDirectory } from '../files/file-ownership.js';
import { commitFileWithoutOverwrite } from '../files/non-conflicting-path.js';

export interface MergeInput {
  path: string;
  label: string;
  note: string;
}

export interface MergeProgress {
  percent: number;
  stage: string;
  speed: string | null;
  etaSeconds: number | null;
  elapsedSeconds: number;
  processedSeconds: number;
  totalSeconds: number;
  currentItem: number;
  itemCount: number;
}

export interface MergeResult {
  video: string;
  timeline: {
    txt: string | null;
    totalDuration: number;
    itemCount: number;
    rows: TimelineRow[];
  };
  warnings: string[];
}

interface PreparedInput extends MergeInput {
  info: MediaInfo;
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, values.length)) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        result[index] = await worker(values[index]!, index);
      }
    }
  );
  await Promise.all(runners);
  return result;
}

function escapeConcatPath(path: string): string {
  return path.replaceAll('\\', '/').replaceAll("'", "'\\''");
}

export class MergeEngine {
  public constructor(
    private readonly tools: ToolManager,
    private readonly processes: ProcessManager,
    private readonly analyzer: MediaAnalyzer,
    private readonly verifier: FileVerifier,
    private readonly normalizer: NormalizeEngine,
    private readonly timeline: TimelineService,
    private readonly quarantine: QuarantineService
  ) {}

  public async merge(
    job: QueueJob,
    inputs: MergeInput[],
    outputFolder: string,
    workFolder: string,
    quarantineFolder: string,
    finalFileName: string,
    profile: QualityProfile,
    resource: ResourceProfile,
    signal: AbortSignal,
    exportTimelineTxt: boolean,
    onProgress: (progress: MergeProgress) => void
  ): Promise<MergeResult> {
    if (!inputs.length) throw new MergeFailedError('Không có video hợp lệ để ghép.');
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const startedAt = Date.now();
    let knownTotalDuration = 0;
    const emit = (
      percent: number,
      stage: string,
      detail: Partial<
        Omit<MergeProgress, 'percent' | 'stage' | 'elapsedSeconds' | 'itemCount'>
      > = {}
    ): void => {
      onProgress({
        percent: sanitizeProgress(percent),
        stage,
        speed: detail.speed ?? null,
        etaSeconds: sanitizeNullableSeconds(detail.etaSeconds),
        elapsedSeconds: sanitizeNonNegativeNumber(
          Math.floor((Date.now() - startedAt) / 1000)
        ),
        processedSeconds: sanitizeNonNegativeNumber(detail.processedSeconds ?? 0),
        totalSeconds: sanitizeNonNegativeNumber(detail.totalSeconds ?? knownTotalDuration),
        currentItem: Math.max(
          0,
          Math.floor(sanitizeNonNegativeNumber(detail.currentItem ?? 0))
        ),
        itemCount: inputs.length
      });
    };

    emit(1, 'Khởi tạo luồng ghép thông minh');
    await ensureDirectory(outputFolder);
    await ensureDirectory(workFolder);
    await ensureDirectory(quarantineFolder);

    // Thư mục cache được giữ lại giữa các lần chạy. Cache key phụ thuộc kích thước,
    // mtime và target nên nguồn thay đổi sẽ không bao giờ dùng nhầm tệp cũ.
    const normalizeCacheFolder = join(workFolder, '_normalized-cache');
    const remuxCacheFolder = join(workFolder, '_remux-cache');
    await ensureTubmediaOwnedDirectory(normalizeCacheFolder, 'normalize-cache');
    await ensureTubmediaOwnedDirectory(remuxCacheFolder, 'remux-cache');

    let analyzed = 0;
    const analyzeConcurrency = Math.max(1, Math.min(resource.analyzeWorkers, inputs.length));
    const infos = await mapLimit(inputs, analyzeConcurrency, async (input) => {
      const info = await this.analyzer.analyze(input.path, job.id);
      analyzed += 1;
      emit(
        2 + (analyzed / inputs.length) * 10,
        `Phân tích video nguồn ${analyzed}/${inputs.length}`,
        { currentItem: analyzed }
      );
      return info;
    });

    knownTotalDuration = infos.reduce((sum, info) => sum + info.duration, 0);
    let prepared: PreparedInput[] = inputs.map((input, index) => ({
      ...input,
      info: infos[index]!
    }));

    emit(14, 'Đối chiếu codec, kích thước, FPS và âm thanh', {
      totalSeconds: knownTotalDuration
    });

    const reference = infos[0]!;
    const allCompatible = infos.every((info) => compareForConcat(reference, info).compatible);
    const profileRequiresNormalization = [
      'compatible_1080p',
      'smooth_background',
      'maximum_cpu',
      'custom'
    ].includes(profile.mode);
    const normalizationRequired = !allCompatible || profileRequiresNormalization;

    if (normalizationRequired) {
      const target: NormalizeTarget = chooseMergeTarget(infos, profile);
      const progressByItem = new Array<number>(prepared.length).fill(0);
      let finishedItems = 0;
      const normalizeConcurrency = Math.max(
        1,
        Math.min(resource.normalizeWorkers, prepared.length)
      );

      emit(
        15,
        `Chuẩn hóa thông minh · tối đa ${normalizeConcurrency} video đồng thời`,
        { totalSeconds: knownTotalDuration }
      );

      prepared = await mapLimit(
        prepared,
        normalizeConcurrency,
        async (current, index): Promise<PreparedInput> => {
          const match = matchNormalizationTarget(current.info, target);
          if (match.videoMatches && match.audioMatches) {
            progressByItem[index] = 100;
            finishedItems += 1;
            const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
            emit(15 + aggregate * 0.5, `Video ${index + 1}/${prepared.length} không cần chuẩn hóa`, {
              currentItem: finishedItems,
              totalSeconds: knownTotalDuration
            });
            return current;
          }

          const path = await this.normalizer.normalizeToTarget(
            job,
            current.path,
            current.info,
            normalizeCacheFolder,
            target,
            resource,
            signal,
            (percent) => {
              progressByItem[index] = sanitizeProgress(percent);
              const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
              emit(
                15 + aggregate * 0.5,
                match.videoMatches
                  ? `Chuẩn hóa âm thanh video ${index + 1}/${prepared.length}`
                  : `Chuẩn hóa video ${index + 1}/${prepared.length}`,
                {
                  currentItem: Math.max(1, finishedItems + 1),
                  totalSeconds: knownTotalDuration
                }
              );
            },
            profile
          );

          progressByItem[index] = 100;
          finishedItems += 1;
          const info = path === current.path
            ? current.info
            : await this.analyzer.analyze(path, job.id);
          const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
          emit(15 + aggregate * 0.5, `Đã chuẩn bị video ${finishedItems}/${prepared.length}`, {
            currentItem: finishedItems,
            totalSeconds: knownTotalDuration
          });
          return { ...current, path, info };
        }
      );
    } else {
      emit(20, 'Tất cả nguồn tương thích · bỏ qua mã hóa lại', {
        totalSeconds: knownTotalDuration
      });
    }

    this.assertConcatCompatible(prepared);

    const safeName = sanitizeFilename(finalFileName.replace(/\.mp4$/i, ''), 'Thành phẩm');
    const final = join(outputFolder, `${safeName}.mp4`);
    const pending = join(outputFolder, `${safeName}.tubmedia-${job.id}.pending.mp4`);
    const expectedDuration = prepared.reduce((sum, item) => sum + item.info.duration, 0);
    knownTotalDuration = expectedDuration;

    let mergeStartPercent = normalizationRequired ? 68 : 22;
    emit(mergeStartPercent, 'Ghép nhanh bằng stream copy', {
      totalSeconds: knownTotalDuration
    });

    let result = await this.concatCopy(
      job,
      prepared,
      workFolder,
      pending,
      resource,
      signal,
      mergeStartPercent,
      emit
    );

    // Một số file có codec giống nhau nhưng timestamp/container không sạch.
    // Thay vì mã hóa lại, remux các nguồn sang MP4 rồi concat-copy lần nữa.
    if (result.code !== 0 && !normalizationRequired) {
      await rm(pending, { force: true });
      const remuxProgress = new Array<number>(prepared.length).fill(0);
      let remuxed = 0;
      const remuxConcurrency = Math.max(1, Math.min(resource.remuxWorkers, prepared.length));
      emit(24, `Concat trực tiếp chưa phù hợp · remux nhanh ${remuxConcurrency} luồng`, {
        totalSeconds: knownTotalDuration
      });

      prepared = await mapLimit(prepared, remuxConcurrency, async (current, index) => {
        const path = await this.normalizer.remuxForConcat(
          job,
          current.path,
          remuxCacheFolder,
          resource,
          signal,
          (percent) => {
            remuxProgress[index] = sanitizeProgress(percent);
            const aggregate = remuxProgress.reduce((sum, value) => sum + value, 0) / prepared.length;
            emit(24 + aggregate * 0.3, `Remux video ${index + 1}/${prepared.length}`, {
              currentItem: Math.max(1, remuxed + 1),
              totalSeconds: knownTotalDuration
            });
          }
        );
        remuxProgress[index] = 100;
        remuxed += 1;
        return {
          ...current,
          path,
          info: await this.analyzer.analyze(path, job.id)
        };
      });

      this.assertConcatCompatible(prepared);
      mergeStartPercent = 58;
      result = await this.concatCopy(
        job,
        prepared,
        workFolder,
        pending,
        resource,
        signal,
        mergeStartPercent,
        emit
      );
    }

    if (result.code !== 0) {
      try {
        await access(pending, constants.F_OK);
        await this.quarantine.move(
          pending,
          quarantineFolder,
          result.stderrTail || 'Concat copy thất bại.',
          job.id
        );
      } catch {
        // chưa tạo được pending
      }
      throw new MergeFailedError(result.stderrTail || 'Concat copy thất bại.');
    }

    emit(94, 'Kiểm tra thành phẩm đầu, giữa và cuối', {
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    const verifyOptions = {
      jobId: job.id,
      projectId: job.projectId,
      signal
    };
    let timestampRepairAttempted = false;
    let check = await this.verifyPendingTwice(
      pending,
      expectedDuration,
      verifyOptions
    );

    // Một số nguồn có timestamp bắt đầu rất lớn hoặc edit-list không sạch.
    // FFmpeg vẫn concat-copy thành công nhưng duration của container có thể bị
    // phóng đại thành nhiều ngày. Không quarantine ngay: remux từng nguồn để
    // đưa timeline về 0, concat lại đúng một lần rồi mới quyết định.
    if (!check.ok && this.shouldRepairTimestamps(check, expectedDuration)) {
      timestampRepairAttempted = true;
      emit(94.4, 'Phát hiện timestamp bất thường · đang tự sửa và ghép lại', {
        processedSeconds: Math.min(check.duration || 0, expectedDuration),
        totalSeconds: expectedDuration
      });
      await rm(pending, { force: true });

      const repairProgress = new Array<number>(prepared.length).fill(0);
      let repaired = 0;
      const repairConcurrency = Math.max(
        1,
        Math.min(resource.remuxWorkers, prepared.length)
      );
      prepared = await mapLimit(prepared, repairConcurrency, async (current, index) => {
        const path = await this.normalizer.remuxForConcat(
          job,
          current.path,
          remuxCacheFolder,
          resource,
          signal,
          (percent) => {
            repairProgress[index] = sanitizeProgress(percent);
            const aggregate = repairProgress.reduce((sum, value) => sum + value, 0) /
              prepared.length;
            emit(94.4 + aggregate * 0.025, `Sửa timestamp video ${index + 1}/${prepared.length}`, {
              currentItem: Math.max(1, repaired + 1),
              totalSeconds: expectedDuration
            });
          }
        );
        repairProgress[index] = 100;
        repaired += 1;
        return {
          ...current,
          path,
          info: await this.analyzer.analyze(path, job.id)
        };
      });

      this.assertConcatCompatible(prepared);
      const repairedConcat = await this.concatCopy(
        job,
        prepared,
        workFolder,
        pending,
        resource,
        signal,
        97,
        emit,
        98
      );
      if (repairedConcat.code !== 0) {
        throw new MergeFailedError(
          repairedConcat.stderrTail || 'Ghép lại sau khi sửa timestamp thất bại.',
          {
            phase: 'timestamp-repair-concat',
            expectedDuration,
            originalVerification: check
          }
        );
      }
      check = await this.verifyPendingTwice(
        pending,
        expectedDuration,
        verifyOptions
      );
    }
    if (!check.ok) {
      const exactReason = check.reasons.join('; ') || 'Không xác định được nguyên nhân xác minh.';
      const quarantined = await this.quarantine.move(
        pending,
        quarantineFolder,
        exactReason,
        job.id
      );
      throw new MergeFailedError(
        `Thành phẩm pending không hợp lệ: ${exactReason} Đã chuyển vào quarantine: ${quarantined}`,
        {
          phase: 'verify-merged-output',
          expectedDuration,
          actualDuration: check.duration,
          allowedDifferenceSeconds: Math.max(3, expectedDuration * 0.02),
          reasons: check.reasons,
          pendingPath: pending,
          quarantinePath: quarantined,
          timestampRepairAttempted,
          inputCount: prepared.length,
          inputs: prepared.map((item, index) => ({
            position: index + 1,
            path: item.path,
            duration: item.info.duration,
            codec: item.info.videoCodec,
            width: item.info.width,
            height: item.info.height,
            fps: item.info.fps
          }))
        }
      );
    }

    const pendingInfo = await this.analyzer.analyze(pending, job.id);
    const sizeValidation = validateMergeOutputSize(
      infos,
      pendingInfo.fileSize,
      profile
    );
    if (!sizeValidation.ok) {
      const quarantined = await this.quarantine.move(
        pending,
        quarantineFolder,
        sizeValidation.message ?? 'Dung lượng thành phẩm thấp bất thường.',
        job.id
      );
      throw new MergeFailedError(
        `Tubmedia đã chặn thành phẩm bị nén nhỏ bất thường và chuyển vào khu cách ly: ${quarantined}. ${sizeValidation.message ?? ''}`
      );
    }

    const finalizePercent = timestampRepairAttempted ? 99 : 97;
    emit(finalizePercent, 'Thành phẩm hợp lệ, đang ghi tệp cuối', {
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    let committedFinal: string;
    try {
      committedFinal = await commitFileWithoutOverwrite(pending, final);
    } catch (error) {
      throw new MergeFailedError(`Không thể commit thành phẩm an toàn: ${String(error)}`);
    }

    emit(timestampRepairAttempted ? 99.5 : 99, 'Đang tạo timeline thành phẩm', {
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    const timelineInputs = prepared.map((item) => ({
      path: item.path,
      label: item.label,
      note: item.note
    }));
    const warnings: string[] = [];
    let timeline: TimelineArtifact;
    try {
      timeline = await this.timeline.write(
        timelineInputs,
        outputFolder,
        safeName,
        exportTimelineTxt
      );
    } catch (error) {
      warnings.push(`Video đã hoàn tất nhưng không thể tạo hoặc ghi timeline TXT: ${String(error)}`);
      let cursor = 0;
      const rows: TimelineRow[] = prepared.map((item, index) => {
        const start = cursor;
        cursor += item.info.duration;
        return {
          index: index + 1,
          start,
          end: cursor,
          duration: item.info.duration,
          code: formatTimelineLine(start, index + 1),
          label: item.label,
          note: item.note,
          file: item.path
        };
      });
      timeline = { txt: null, totalDuration: cursor, itemCount: rows.length, rows };
    }

    emit(100, 'Ghép và kiểm tra thành phẩm hoàn tất', {
      etaSeconds: 0,
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    return { video: committedFinal, timeline, warnings };
  }

  private assertConcatCompatible(prepared: PreparedInput[]): void {
    const reference = prepared[0]!.info;
    const incompatible = prepared.flatMap((item, index) =>
      index === 0
        ? []
        : compareForConcat(reference, item.info).reasons.map(
            (reason) => `Video ${index + 1}: ${reason}`
          )
    );
    if (incompatible.length) {
      throw new MergeFailedError(
        `Các file vẫn chưa tương thích concat: ${incompatible.slice(0, 10).join('; ')}`
      );
    }
  }

  private async verifyPendingTwice(
    pending: string,
    expectedDuration: number,
    options: VerificationOptions
  ): Promise<VerificationResult> {
    let check = await this.verifier.verify(
      pending,
      'standard',
      expectedDuration,
      options
    );
    if (check.ok) return check;

    // Đợi hệ thống tệp hoàn tất flush metadata rồi phân tích lại một lần.
    // Cách này tránh quarantine nhầm MP4 stream-copy vừa đóng file xong.
    if (options.signal) {
      await delay(650, undefined, { signal: options.signal });
    } else {
      await delay(650);
    }
    this.analyzer.forget(pending);
    check = await this.verifier.verify(
      pending,
      'standard',
      expectedDuration,
      options
    );
    return check;
  }

  private shouldRepairTimestamps(
    check: VerificationResult,
    expectedDuration: number
  ): boolean {
    if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) return false;
    const tolerance = Math.max(3, expectedDuration * 0.02);
    const durationMismatch = !Number.isFinite(check.duration) ||
      check.duration <= 0 ||
      Math.abs(check.duration - expectedDuration) > tolerance;
    const timestampReason = check.reasons.some((reason) => {
      const lower = reason.toLowerCase();
      return lower.includes('thời lượng lệch') ||
        lower.includes('timestamp') ||
        lower.includes('không đọc được mẫu') ||
        lower.includes('không giải mã được mẫu');
    });
    return durationMismatch || timestampReason;
  }

  private async concatCopy(
    job: QueueJob,
    prepared: PreparedInput[],
    workFolder: string,
    pending: string,
    resource: ResourceProfile,
    signal: AbortSignal,
    mergeStartPercent: number,
    emit: (
      percent: number,
      stage: string,
      detail?: Partial<
        Omit<MergeProgress, 'percent' | 'stage' | 'elapsedSeconds' | 'itemCount'>
      >
    ) => void,
    mergeEndPercent = 92
  ): Promise<ProcessResult> {
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const concatPath = join(workFolder, `concat-${job.id}.txt`);
    await writeFile(
      concatPath,
      prepared.map((item) => [
        `file '${escapeConcatPath(item.path)}'`,
        `duration ${Math.max(0.001, item.info.duration).toFixed(6)}`
      ].join('\r\n')).join('\r\n'),
      'utf8'
    );
    await rm(pending, { force: true });

    const expectedDuration = prepared.reduce((sum, item) => sum + item.info.duration, 0);
    const tracker = new FfmpegProgressTracker(expectedDuration);
    try {
      return await this.processes.run({
        jobId: job.id,
        projectId: job.projectId,
        tool: 'ffmpeg',
        executablePath: ffmpeg.executablePath,
        args: [
          '-hide_banner', '-nostdin', '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatPath,
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          '-progress', 'pipe:1',
          '-nostats',
          pending
        ],
        priority: resource.processPriority,
        signal,
        timeoutMs: 24 * 60 * 60 * 1000,
        onStdoutLine: (line) => {
          const snapshot = tracker.update(line);
          if (!snapshot) return;
          emit(
            mergeStartPercent +
              (snapshot.percent / 100) * (mergeEndPercent - mergeStartPercent),
            `Đang ghép ${prepared.length} video bằng stream copy`,
            {
              speed: snapshot.speed,
              etaSeconds: snapshot.etaSeconds,
              processedSeconds: snapshot.processedSeconds,
              totalSeconds: snapshot.totalSeconds
            }
          );
        }
      });
    } finally {
      await rm(concatPath, { force: true });
    }
  }
}
