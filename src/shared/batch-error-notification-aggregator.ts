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
};

type ProjectBucket = {
  firstSeenAt: number;
  jobIds: Set<string>;
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
 */
export function coalesceBatchJobFailureAttention<T extends BatchAttentionNotice>(notice: T): T | null {
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
      jobIds: new Set<string>()
    };

    buckets.set(projectId, bucket);
  }

  if (bucket.jobIds.has(jobId)) {
    return null;
  }

  bucket.jobIds.add(jobId);

  const count = bucket.jobIds.size;
  const recoverableWarning = notice.severity === 'warning';

  return {
    ...notice,
    id: `batch-job-failures:${projectId}`,
    title: recoverableWarning
      ? count === 1
        ? 'Có 1 video chưa tải được sau khi tự thử lại'
        : `Có ${count} video chưa tải được sau khi tự thử lại`
      : count === 1
        ? 'Có 1 video gặp lỗi trong danh sách này'
        : `Có ${count} video gặp lỗi trong danh sách này`,
    message: recoverableWarning
      ? 'Tubmedia đã gom các cảnh báo phục hồi vào một thông báo. Tệp .part vẫn được giữ để thử lại đúng video khi nguồn ổn định.'
      : 'Các lỗi được gom vào một thông báo. Mở Nhật ký riêng của danh sách để xem chi tiết từng video.',
    sticky: false
  };
}
