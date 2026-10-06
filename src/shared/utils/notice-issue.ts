import type { AttentionNotice, QueueJob } from '../types/domain.js';
import { isCookieBlockingCode } from './cookie-policy.js';

/**
 * "Khóa vấn đề" cho thông báo nổi — phần B rà soát thông báo, người dùng duyệt 2026-10-06.
 *
 * Trước đây hai thông báo chỉ được coi là một khi CÙNG id, mà phần lớn nơi tạo thông báo ở giao diện dùng id ngẫu nhiên
 * → cùng một vấn đề xếp hàng thành nhiều cái, người dùng phải bấm tắt nhiều lần. Giờ:
 *  - khóa = NHÓM mã lỗi + PHẠM VI (danh sách hoặc toàn ứng dụng);
 *  - cùng khóa → THAY thông báo đang hiện/đang chờ bằng bản mới nhất; khác khóa → vẫn xếp hàng để hiện đầy đủ;
 *  - người dùng bấm X → không hiện lại vấn đề cùng khóa: gắn danh sách (cảnh báo/lỗi) thì nhớ bền tới khi danh sách hết
 *    bị chặn; thông báo thao tác/thông tin thì chỉ trong phiên.
 */

type IssueNotice = Pick<AttentionNotice, 'id' | 'severity' | 'title' | 'code' | 'projectId' | 'jobId'>;

const DISK_CODES = new Set(['DISK_FULL', 'DISK_SPACE_LOW', 'DISK_SPACE_RECOVERED']);
const PERMISSION_CODES = new Set(['PERMISSION_DENIED', 'OUTPUT_PERMISSION_DENIED', 'PERMISSION_REQUIRED', 'FILE_LOCKED']);
const NETWORK_CODES = new Set(['SOURCE_RATE_LIMITED', 'NETWORK_CIRCUIT_OPEN', 'NETWORK_ERROR', 'PROCESS_TIMEOUT']);

function issueGroup(notice: IssueNotice): string {
  const code = (notice.code ?? '').trim().toUpperCase();
  if (notice.id.startsWith('app-update-')) return 'update';
  if (isCookieBlockingCode(code) || code === 'INVALID_COOKIE_TEXT') return 'cookies';
  if (DISK_CODES.has(code)) return 'disk';
  if (PERMISSION_CODES.has(code)) return 'permission';
  if (NETWORK_CODES.has(code)) return 'network';
  if (code.startsWith('TOOL_')) return 'tools';
  // Video tải lỗi trong một danh sách (đã gộp "Có N video gặp lỗi…") là MỘT vấn đề, bất kể mã lỗi từng video.
  if (
    notice.projectId &&
    (notice.id.startsWith('batch-job-failures:') ||
      notice.id.startsWith('job-failure-') ||
      code === 'JOB_FAILED' ||
      code.endsWith('_FAILED') ||
      code.includes('UNAVAILABLE'))
  ) {
    return 'job-failure';
  }
  if (code) return `code:${code}`;
  return `title:${notice.title.trim().toLowerCase()}`;
}

export function noticeIssueKey(notice: IssueNotice): string {
  return `${issueGroup(notice)}@${notice.projectId ?? 'app'}`;
}

/** Thông báo mới vào: cùng khóa thì THAY (đang hiện hoặc đang chờ), khác khóa thì xếp hàng (tối đa `limit`). */
export function mergeNoticeIntoQueue<T extends IssueNotice>(
  current: T | null,
  queue: readonly T[],
  incoming: T,
  limit = 5
): { current: T | null; queue: T[] } {
  const key = noticeIssueKey(incoming);
  if (!current) return { current: incoming, queue: queue.filter((item) => noticeIssueKey(item) !== key) };
  if (noticeIssueKey(current) === key) {
    return { current: incoming, queue: queue.filter((item) => noticeIssueKey(item) !== key) };
  }
  const index = queue.findIndex((item) => noticeIssueKey(item) === key);
  if (index >= 0) {
    const next = [...queue];
    next[index] = incoming;
    return { current, queue: next };
  }
  return { current, queue: [...queue, incoming].slice(-limit) };
}

export interface DismissedIssue {
  key: string;
  /**
   * true: nhớ qua các lần mở app tới khi tình huống đổi khác — vấn đề gắn danh sách (cảnh báo/lỗi): tới khi danh sách
   * hết bị chặn; thông báo chặn cookies (gộp chung cả app): tới khi không còn tác vụ nào bị chặn vì cookies.
   */
  persistent: boolean;
  projectId?: string;
  at: string;
}

export function recordIssueDismissal(list: readonly DismissedIssue[], notice: IssueNotice, now: Date): DismissedIssue[] {
  const key = noticeIssueKey(notice);
  const blockingSeverity = notice.severity === 'warning' || notice.severity === 'error';
  const persistent = blockingSeverity && (Boolean(notice.projectId) || key.startsWith('cookies@'));
  const entry: DismissedIssue = {
    key,
    persistent,
    ...(notice.projectId ? { projectId: notice.projectId } : {}),
    at: now.toISOString()
  };
  return [...list.filter((item) => item.key !== key), entry];
}

export function isIssueDismissed(list: readonly DismissedIssue[], notice: IssueNotice): boolean {
  const key = noticeIssueKey(notice);
  return list.some((item) => item.key === key);
}

const BLOCKED_STATUSES: ReadonlySet<QueueJob['status']> = new Set(['paused', 'interrupted', 'failed']);

/**
 * "Tới khi tình huống đổi khác": bỏ ghi nhớ của danh sách đã HẾT bị chặn (đã sửa, hoặc bấm Thử lại/Tiếp tục → tác vụ
 * về chờ/chạy). Lần bị chặn sau đó là tình huống mới nên sẽ hiện lại. Ghi nhớ trong phiên (không gắn danh sách) giữ nguyên.
 */
export function pruneDismissedIssues(
  list: readonly DismissedIssue[],
  jobs: readonly Pick<QueueJob, 'projectId' | 'status' | 'errorCode'>[]
): DismissedIssue[] {
  const blocked = jobs.filter((job) => BLOCKED_STATUSES.has(job.status) && Boolean(job.errorCode));
  return list.filter((item) => {
    if (!item.persistent) return true;
    if (item.key.startsWith('cookies@')) return blocked.some((job) => isCookieBlockingCode(job.errorCode));
    if (!item.projectId) return true;
    return blocked.some((job) => job.projectId === item.projectId);
  });
}
