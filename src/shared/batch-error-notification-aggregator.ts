import { summarizeFailureReasons } from './utils/failure-reason.js';

export type BatchAttentionNotice = {
  id: string;
  severity: string;
  title: string;
  message: string;
  projectId?: string;
  jobId?: string;
  code?: string;
  sticky?: boolean;
  steps?: string[];
  /** Nguyên nhân ngắn của lỗi (xem failure-reason.ts) — gộp nhiều video thì liệt kê theo lý do. */
  reason?: string;
};

type ProjectBucket = {
  firstSeenAt: number;
  jobIds: Set<string>;
  /** Mã tác vụ → lý do (2026-10-27: thông báo gộp nêu lý do, không chỉ "gặp lỗi"). */
  reasons: Map<string, string>;
};

const PROJECT_WINDOW_MS = 10 * 60 * 1000;
const buckets = new Map<string, ProjectBucket>();

function pruneExpired(current: number): void {
  for (const [key, bucket] of buckets) {
    if (current - bucket.firstSeenAt >= PROJECT_WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

function isBatchableFinalJobFailure(notice: BatchAttentionNotice): boolean {
  const projectId = notice.projectId?.trim();
  const jobId = notice.jobId?.trim();

  if (!projectId || !jobId) return false;

  const code = (notice.code ?? '').trim().toUpperCase();

  // These are already project/source blockers with their own stable lifecycle.
  if (
    code === 'DISK_FULL' ||
    code === 'DISK_SPACE_RECOVERED' ||
    code === 'SOURCE_REMOVED' ||
    code.startsWith('JOB_SKIPPED_SOURCE_REMOVED') ||
    code.includes('RATE_LIMIT') ||
    code.includes('COOKIE') ||
    code.includes('AUTH_REQUIRED')
  ) {
    return false;
  }

  if (
    code === 'JOB_FAILED' ||
    code === 'DOWNLOAD_FAILED' ||
    code.endsWith('_FAILED') ||
    code.includes('UNAVAILABLE')
  ) {
    return true;
  }

  // Lỗi nguồn/mạng đã thử hết lượt nhưng vẫn có thể phục hồi được gửi với mức
  // warning. Gom theo dự án để không bật một popup cho từng video.
  if (notice.severity === 'warning') {
    return true;
  }

  // Keep a conservative fallback for final job errors whose producer has no code.
  return notice.severity === 'error';
}

export function resetBatchErrorNotificationAggregatorForTests(): void {
  buckets.clear();
}

/**
 * Returns:
 * - the original notice for unrelated notifications;
 * - a stable project-scoped aggregate notice for a new failed job;
 * - null for a duplicate failure from the same job.
 *
 * Queue state, diagnostics and per-job logs are never modified here.
 *
 * projectName: tên danh sách để nêu trong tiêu đề. Thông báo nằm ở Trung tâm thông báo chung cho mọi danh sách
 * nên "danh sách này" không cho biết là danh sách nào (khám phá bản cài #10).
 */
export function coalesceBatchJobFailureAttention<T extends BatchAttentionNotice>(notice: T, projectName?: string): T | null {
  if (!isBatchableFinalJobFailure(notice)) {
    return notice;
  }

  const current = Date.now();
  pruneExpired(current);

  const projectId = notice.projectId!.trim();
  const jobId = notice.jobId!.trim();

  let bucket = buckets.get(projectId);

  if (!bucket) {
    bucket = {
      firstSeenAt: current,
      jobIds: new Set<string>(),
      reasons: new Map<string, string>()
    };

    buckets.set(projectId, bucket);
  }

  if (bucket.jobIds.has(jobId)) {
    return null;
  }

  bucket.jobIds.add(jobId);
  const reason = notice.reason?.trim();
  if (reason) bucket.reasons.set(jobId, reason);

  const count = bucket.jobIds.size;
  const recoverableWarning = notice.severity === 'warning';
  const name = projectName?.trim();
  const where = name ? `"${name}"` : 'một danh sách tải';
  // 2026-10-27 (người dùng yêu cầu): nêu nguyên nhân ngay trong thông báo. Cùng một lý do → đưa lên tiêu đề; nhiều lý do →
  // liệt kê ngắn theo số video (nhiều nhất trước). Video không có lý do (bản cũ) tính là "chưa rõ".
  if (bucket.reasons.size === 0) {
    // Thông báo không kèm lý do (nguồn khác/bản cũ): giữ đúng câu cũ.
    return {
      ...notice,
      id: `batch-job-failures:${projectId}`,
      title: recoverableWarning
        ? `Có ${count} video${name ? ` trong ${where}` : ''} chưa tải được sau khi tự thử lại`
        : `Có ${count} video gặp lỗi trong ${where}`,
      message: recoverableWarning
        ? 'Tubmedia đã gom các cảnh báo phục hồi vào một thông báo. Tệp .part vẫn được giữ để thử lại đúng video khi nguồn ổn định.'
        : 'Các lỗi được gom vào một thông báo. Mở Nhật ký riêng của danh sách để xem chi tiết từng video.',
      sticky: false
    };
  }
  const reasons = [...bucket.jobIds].map((id) => bucket.reasons.get(id) ?? 'Lỗi chưa xác định (xem Nhật ký)');
  const distinct = new Set(reasons);
  const single = distinct.size === 1 ? [...distinct][0]! : null;
  const title = recoverableWarning
    ? `Có ${count} video${name ? ` trong ${where}` : ''} chưa tải được sau khi tự thử lại${single ? `: ${single}` : ''}`
    : single
      ? `Có ${count} video lỗi trong ${where}: ${single}`
      : `Có ${count} video lỗi trong ${where}`;
  const reasonLine = single ? '' : `Lý do: ${summarizeFailureReasons(reasons)}. `;

  return {
    ...notice,
    id: `batch-job-failures:${projectId}`,
    title,
    message: recoverableWarning
      ? `${reasonLine}Tệp .part vẫn được giữ để thử lại đúng video khi nguồn ổn định.`
      : `${reasonLine}Xem từng video ở trang Tiến trình; Nhật ký riêng của danh sách có chi tiết kỹ thuật.`,
    sticky: false
  };
}
