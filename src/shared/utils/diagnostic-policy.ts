import type { LogEntry, QueueJob } from '../types/domain.js';
import { isCookieBlockingCode } from './cookie-policy.js';

const NON_ACTIONABLE_EVENT_CODES = new Set([
  'APP_UPDATE_DOWNGRADE_BLOCKED',
  'APP_UPDATE_DOWNLOADED_DOWNGRADE_BLOCKED',
  'APP_UPDATE_SERVER_OLDER',
  'APP_UPDATE_STALE_PACKAGE_IGNORED',
  'TOOL_RELEASE_API_DIRECT_FALLBACK',
  'PROCESS_STARTED',
  'PROCESS_FINISHED',
  'TOOLS_AUTO_CONNECTED',
  'JOB_RETRY_SCHEDULED',
  'COOKIE_RETRY_SCHEDULED',
  'COOKIE_BLOCKS_AUTO_RESUMED',
  'LEGACY_SIZE_ESTIMATE_FAILURES_RECOVERED',
  'SOURCE_CACHE_MISSING',
  'DOWNLOAD_QUALITY_FALLBACK',
  'DOWNLOAD_SIZE_ESTIMATE_MISMATCH'
]);

const ACTIONABLE_WARNING_EVENT_CODES = new Set([
  'DISK_FULL',
  'DISK_SPACE_LOW',
  'OUTPUT_PERMISSION_DENIED',
  'PERMISSION_REQUIRED',
  'FILE_LOCKED',
  'COOKIES_REQUIRED',
  'COOKIES_EXPIRED'
]);

const BLOCKING_STATUSES: ReadonlySet<QueueJob['status']> = new Set(['paused', 'interrupted', 'failed']);

/** Lỗi cấp ứng dụng ở khung chẩn đoán tự tắt cùng nhịp với lỗi thường của thông báo nổi (~12 giây). */
export const TRANSIENT_DIAGNOSTIC_DURATION_MS = 12_000;

export function isActionableDiagnostic(entry: Pick<LogEntry, 'level' | 'eventCode'>): boolean {
  if (NON_ACTIONABLE_EVENT_CODES.has(entry.eventCode)) return false;
  if (entry.level === 'error') return true;
  // Chỉ đưa cảnh báo cần người dùng hành động vào trung tâm chẩn đoán.
  // Các cảnh báo kỹ thuật đã tự phục hồi hoặc chỉ mang tính thông tin vẫn bị ẩn.
  return entry.level === 'warn' && ACTIONABLE_WARNING_EVENT_CODES.has(entry.eventCode);
}

export function isDiagnosticStillBlocking(
  entry: Pick<LogEntry, 'jobId' | 'projectId' | 'eventCode'>,
  jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[]
): boolean {
  const candidates = jobs.filter((job) => {
    if (!BLOCKING_STATUSES.has(job.status)) return false;
    if (entry.jobId) return job.id === entry.jobId;
    if (entry.projectId) return job.projectId === entry.projectId;
    return false;
  });
  if (candidates.length === 0) return false;
  return candidates.some((job) => {
    if (entry.eventCode === 'JOB_FAILED') return Boolean(job.errorCode);
    if (entry.eventCode === job.errorCode) return true;
    if (isCookieBlockingCode(entry.eventCode) && isCookieBlockingCode(job.errorCode)) {
      return true;
    }
    return entry.eventCode.endsWith('_FAILED') && Boolean(job.errorCode);
  });
}

export function shouldDisplayDiagnostic(
  entry: LogEntry,
  // Giữ tham số để nơi gọi không đổi; nhật ký gắn tác vụ giờ không hiện ở khung chẩn đoán nữa nên không cần dùng.
  _jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[],
  now = Date.now()
): boolean {
  if (!isActionableDiagnostic(entry)) return false;
  // Phần B rà soát thông báo (2026-10-06): một vấn đề chỉ hiện ở MỘT nơi. Nhật ký gắn danh sách/tác vụ đã có thông báo
  // nổi đại diện (tiến trình chính gửi: tác vụ bị chặn, "Có N video gặp lỗi…") — trước đây khung chẩn đoán còn bật thêm
  // MỖI dòng lỗi của từng video, người dùng phải tắt nhiều lần. Khung chỉ còn dành cho lỗi cấp ứng dụng.
  if (entry.jobId || entry.projectId) return false;
  const timestamp = Date.parse(entry.timestamp);
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp <= TRANSIENT_DIAGNOSTIC_DURATION_MS;
}
