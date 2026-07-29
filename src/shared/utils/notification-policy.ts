import type { AttentionNotice, QueueJob } from '../types/domain.js';
import { isCookieBlockingCode } from './cookie-policy.js';

/**
 * Thông báo thường cần đủ lâu để đọc nhưng không được chiếm giao diện quá lâu.
 * Chỉ lỗi vẫn đang chặn tác vụ mới được giữ cố định.
 */
export const TRANSIENT_NOTIFICATION_DURATION_MS = 4_800;
export const SUCCESS_NOTIFICATION_DURATION_MS = 3_600;
export const WARNING_NOTIFICATION_DURATION_MS = 6_500;

export function notificationDuration(severity: AttentionNotice['severity'] | 'error'): number {
  if (severity === 'success') return SUCCESS_NOTIFICATION_DURATION_MS;
  if (severity === 'warning' || severity === 'error') return WARNING_NOTIFICATION_DURATION_MS;
  return TRANSIENT_NOTIFICATION_DURATION_MS;
}

const INLINE_BLOCKING_STATUSES: ReadonlySet<QueueJob['status']> = new Set([
  'paused',
  'interrupted',
  'failed'
]);

function noticeMatchesJob(
  notice: Pick<AttentionNotice, 'jobId' | 'projectId' | 'code'>,
  job: Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>
): boolean {
  if (!INLINE_BLOCKING_STATUSES.has(job.status)) return false;
  if (notice.jobId && notice.jobId !== job.id) return false;
  if (!notice.jobId && notice.projectId && notice.projectId !== job.projectId) return false;
  if (!notice.code) return true;
  if (notice.code === 'JOB_FAILED') return Boolean(job.errorCode);
  if (notice.code === job.errorCode) return true;
  return isCookieBlockingCode(notice.code) && isCookieBlockingCode(job.errorCode);
}

export function isAttentionNoticeResolved(
  notice: Pick<AttentionNotice, 'sticky' | 'jobId' | 'projectId' | 'code'>,
  jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[]
): boolean {
  if (!notice.sticky) return false;
  if (!notice.jobId && !notice.projectId) return false;
  return !jobs.some((job) => noticeMatchesJob(notice, job));
}

export function shouldShowInlineBlockingIssue(
  job: Pick<QueueJob, 'status' | 'errorCode'>,
  blockingCodes: readonly string[]
): boolean {
  return Boolean(
    job.errorCode && INLINE_BLOCKING_STATUSES.has(job.status) && blockingCodes.includes(job.errorCode)
  );
}
