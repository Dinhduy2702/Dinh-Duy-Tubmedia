import type { AttentionNotice, QueueJob } from '../types/domain.js';
import { isCookieBlockingCode } from './cookie-policy.js';
import type { UiTone } from './ui-error.js';

/**
 * Thông báo thường cần đủ lâu để đọc nhưng không được chiếm giao diện quá lâu.
 * Chỉ lỗi vẫn đang chặn tác vụ mới được giữ cố định.
 */
export const TRANSIENT_NOTIFICATION_DURATION_MS = 4_800;
export const SUCCESS_NOTIFICATION_DURATION_MS = 3_600;
export const WARNING_NOTIFICATION_DURATION_MS = 6_500;

export function notificationDuration(severity: AttentionNotice['severity']): number {
  if (severity === 'success') return SUCCESS_NOTIFICATION_DURATION_MS;
  if (severity === 'warning' || severity === 'error') return WARNING_NOTIFICATION_DURATION_MS;
  return TRANSIENT_NOTIFICATION_DURATION_MS;
}

export function shouldRouteIssueToAttention(tone: UiTone): boolean {
  return tone !== 'error';
}

/**
 * Chỉ LỖI THẬT mới nằm lại trên màn hình cho tới khi người dùng đóng. Mọi mức khác (cảnh báo,
 * thông tin, thành công, trung tính) tự tắt sau vài giây; nội dung vẫn còn trong Trung tâm thông báo.
 */
export function isPersistentNoticeTone(tone: AttentionNotice['severity']): boolean {
  return tone === 'error';
}

/** Phần của một thông báo mà quy tắc hiển thị cần biết (cho phép thiếu trường tùy chọn). */
export interface NoticeDisplayInput {
  severity: AttentionNotice['severity'];
  code?: string | undefined;
  sticky?: boolean | undefined;
  steps?: readonly string[] | undefined;
}

/** Cảnh báo mà người dùng phải LÀM GÌ ĐÓ mới tiếp tục được: không được biến mất quá nhanh. */
export const ACTION_REQUIRED_WARNING_MIN_DURATION_MS = 12_000;

const ACTION_REQUIRED_WARNING_CODES: ReadonlySet<string> = new Set([
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED',
  'INVALID_COOKIE_TEXT',
  'INVALID_INPUT',
  'SOURCE_RATE_LIMITED',
  'NETWORK_CIRCUIT_OPEN',
  'NETWORK_ERROR',
  'PROCESS_TIMEOUT',
  'UPDATE_BLOCKED_ACTIVE_WORK',
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_INSTALL_PREPARATION_FAILED'
]);

/**
 * Cảnh báo cần hành động: thuộc danh sách mã đã biết, hoặc được đánh dấu cố định (sticky), hoặc có
 * các bước hướng dẫn người dùng làm tiếp. Cảnh báo chỉ để biết thì không thuộc nhóm này.
 */
export function isActionRequiredWarning(notice: NoticeDisplayInput): boolean {
  if (notice.severity !== 'warning') return false;
  if (notice.sticky) return true;
  if ((notice.steps?.length ?? 0) > 0) return true;
  return ACTION_REQUIRED_WARNING_CODES.has((notice.code ?? '').toUpperCase());
}

export interface NoticeDisplayPolicy {
  /** true: nằm lại cho tới khi người dùng đóng (chỉ lỗi thật, và chưa được giải quyết). */
  persistent: boolean;
  /** Thời gian hiện trước khi tự tắt (bị bỏ qua khi persistent). Tạm dừng khi trỏ chuột/focus. */
  durationMs: number;
  actionRequired: boolean;
}

/**
 * Quy tắc hiển thị DUY NHẤT cho thông báo nổi:
 *  - lỗi thật: không tự tắt (đóng được), trừ khi nguyên nhân đã được giải quyết;
 *  - cảnh báo cần hành động: tối thiểu 12 giây;
 *  - cảnh báo chỉ để biết, thông tin, thành công, trung tính: thời gian ngắn theo mức.
 * Mọi thông báo đều còn ở Trung tâm thông báo dưới dạng mục CHƯA ĐỌC, kể cả khi thông báo nổi đã tắt.
 */
export function noticeDisplayPolicy(notice: NoticeDisplayInput, resolved = false): NoticeDisplayPolicy {
  const actionRequired = isActionRequiredWarning(notice);
  return {
    persistent: isPersistentNoticeTone(notice.severity) && !resolved,
    durationMs: actionRequired
      ? Math.max(ACTION_REQUIRED_WARNING_MIN_DURATION_MS, WARNING_NOTIFICATION_DURATION_MS)
      : notificationDuration(notice.severity),
    actionRequired
  };
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

/**
 * A persisted notification may outlive the queue row that originally created it.
 * Treat it as actionable only while a matching job is still genuinely blocked.
 * Logs remain the durable audit trail after the blocker has been resolved.
 */
export function isJobNoticeStillBlocking(
  notice: Pick<AttentionNotice, 'jobId' | 'projectId' | 'code'>,
  jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[]
): boolean {
  if (!notice.jobId && !notice.projectId) return false;
  return jobs.some((job) => noticeMatchesJob(notice, job));
}

export function isAttentionNoticeResolved(
  notice: Pick<AttentionNotice, 'sticky' | 'jobId' | 'projectId' | 'code'>,
  jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[]
): boolean {
  if (!notice.sticky) return false;
  if (!notice.jobId && !notice.projectId) return false;
  return !isJobNoticeStillBlocking(notice, jobs);
}

export function shouldShowInlineBlockingIssue(
  job: Pick<QueueJob, 'status' | 'errorCode'>,
  blockingCodes: readonly string[]
): boolean {
  return Boolean(
    job.errorCode && INLINE_BLOCKING_STATUSES.has(job.status) && blockingCodes.includes(job.errorCode)
  );
}
