import { rm } from 'node:fs/promises';
import { ProcessStalledError } from '@shared/errors/app-errors.js';
import { buildFfmpegStallMessage, injectFastAacCoder } from '@shared/utils/ffmpeg-progress.js';
import type { ProcessManager, ProcessResult, ProcessRunOptions } from './process-manager.js';

export interface FastAacRescueContext {
  pendingPath: string;
  logModule: string;
  stepLabel: string;
  videoLabel?: string | null;
  sourceIndex?: number | null;
  exhaustedAdvice?: string;
  onBeforeRetry?: () => void;
  onRescueAttempted?: () => void;
}

/**
 * 1.7.6 (Thang cứu Bậc 1 + Bậc 3 cho lỗi đứng im bộ mã hoá AAC `twoloop`):
 * - Lượt thường giữ nguyên 100% lệnh gốc (không đổi chất lượng tiếng đại trà).
 * - Chỉ khi bị bộ canh V6 dừng vì đứng im (`ProcessStalledError`) và lệnh có `-c:a aac`:
 *   xoá tệp `.pending` dở, tự chạy lại ĐÚNG 1 lần với `-aac_coder fast` (giữ nguyên số luồng theo máy).
 * - Nếu lượt cứu qua được: ghi nhật ký rõ đã cứu bằng bộ mã hoá tiếng nhanh.
 * - Nếu lượt cứu vẫn đứng im: dừng ở Bậc 3, xoá `.pending` dở và báo rõ tiếng Việt tên video, bước, mốc kẹt + thay video khác.
 */
export async function runFfmpegWithFastAacRescue(
  processes: ProcessManager,
  options: ProcessRunOptions,
  rescue: FastAacRescueContext
): Promise<ProcessResult> {
  try {
    return await processes.run(options);
  } catch (firstError) {
    await rm(rescue.pendingPath, { force: true }).catch(() => undefined);
    if (!(firstError instanceof ProcessStalledError) || options.signal?.aborted) {
      throw firstError;
    }
    const rescueArgs = injectFastAacCoder(options.args);
    if (!rescueArgs) {
      throw firstError;
    }

    rescue.onRescueAttempted?.();
    rescue.onBeforeRetry?.();
    processes.logEvent(
      'warn',
      rescue.logModule,
      'FFMPEG_AAC_FAST_RESCUE_STARTED',
      `Phát hiện đứng tiến độ ở bước ${rescue.stepLabel}; đang tự thử cứu 1 lần bằng bộ mã hoá tiếng nhanh (-aac_coder fast).`,
      {
        jobId: options.jobId,
        ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
        metadata: {
          videoLabel: rescue.videoLabel ?? null,
          sourceIndex: rescue.sourceIndex ?? null,
          firstStallDetails: firstError.details ?? null
        }
      }
    );

    const advice =
      rescue.exhaustedAdvice ??
      'Tubmedia đã tự thử cứu 1 lần bằng bộ mã hoá tiếng nhanh nhưng vẫn không qua được; hãy thay video này bằng tệp khác rồi bấm chạy lại (các video đã xử lý xong vẫn được giữ nguyên).';

    let secondResult: ProcessResult;
    try {
      secondResult = await processes.run({
        ...options,
        args: rescueArgs,
        describeStall: ({ lastProgressValue }) => ({
          message: buildFfmpegStallMessage({
            stepLabel: rescue.stepLabel,
            videoLabel: rescue.videoLabel ?? null,
            sourceIndex: rescue.sourceIndex ?? null,
            lastProgressSeconds: lastProgressValue,
            advice
          }),
          details: {
            ...(firstError.details ?? {}),
            aacFastRescueAttempted: true,
            lastProgressSeconds: lastProgressValue
          }
        })
      });
    } catch (secondError) {
      await rm(rescue.pendingPath, { force: true }).catch(() => undefined);
      throw secondError;
    }

    if (secondResult.code === 0) {
      processes.logEvent(
        'info',
        rescue.logModule,
        'FFMPEG_AAC_FAST_RESCUED',
        `Đã cứu bằng bộ mã hoá tiếng nhanh (-aac_coder fast) ở bước ${rescue.stepLabel}${rescue.videoLabel ? ` cho "${rescue.videoLabel}"` : ''}.`,
        {
          jobId: options.jobId,
          ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
          metadata: {
            videoLabel: rescue.videoLabel ?? null,
            sourceIndex: rescue.sourceIndex ?? null
          }
        }
      );
    } else {
      await rm(rescue.pendingPath, { force: true }).catch(() => undefined);
    }
    return secondResult;
  }
}
