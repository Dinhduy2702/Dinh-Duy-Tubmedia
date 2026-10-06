import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isIssueDismissed,
  mergeNoticeIntoQueue,
  noticeIssueKey,
  pruneDismissedIssues,
  recordIssueDismissal,
  type DismissedIssue
} from '@shared/utils/notice-issue.js';
import { noticeDisplayPolicy } from '@shared/utils/notification-policy.js';
import { shouldDisplayDiagnostic } from '@shared/utils/diagnostic-policy.js';
import type { AttentionNotice, LogEntry, QueueJob } from '@shared/types/domain.js';

// Người dùng duyệt phần B (2026-10-06): (1) "khóa vấn đề" = nhóm mã lỗi + phạm vi; cùng khóa thì THAY thông báo cũ bằng
// bản mới nhất, khác khóa vẫn hiện đủ; (2) mọi thông báo tự tắt — lỗi thường ~12s, cảnh báo chặn việc giữ ≥12s;
// (3) bấm X thì không hiện lại vấn đề tương tự: gắn danh sách → nhớ qua các lần mở app tới khi danh sách hết bị chặn,
// thông báo thao tác → chỉ trong phiên; (4) một vấn đề chỉ hiện một nơi.

const notice = (over: Partial<AttentionNotice>): AttentionNotice => ({
  id: over.id ?? `n-${Math.random()}`,
  severity: 'warning',
  title: 'T',
  message: 'M',
  ...over
});
const job = (over: Partial<QueueJob>): Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'> => ({
  id: 'j1',
  projectId: 'p1',
  status: 'failed',
  errorCode: 'DOWNLOAD_FAILED',
  ...over
});

describe('khóa vấn đề = nhóm mã lỗi + phạm vi', () => {
  it('cùng nhóm, cùng danh sách → cùng khóa dù id/nội dung khác', () => {
    const a = noticeIssueKey(notice({ id: 'blocking-p1-COOKIES_EXPIRED', code: 'COOKIES_EXPIRED', projectId: 'p1' }));
    const b = noticeIssueKey(notice({ id: 'x2', code: 'AUTHENTICATION_REQUIRED', projectId: 'p1', message: 'khác' }));
    expect(a).toBe(b);
    expect(noticeIssueKey(notice({ code: 'DISK_FULL', projectId: 'p1' }))).toBe(
      noticeIssueKey(notice({ code: 'DISK_SPACE_RECOVERED', projectId: 'p1', severity: 'success' }))
    );
    expect(noticeIssueKey(notice({ id: 'batch-job-failures:p1', code: 'DOWNLOAD_FAILED', projectId: 'p1' }))).toBe(
      noticeIssueKey(notice({ id: 'job-failure-p1-SOURCE_UNAVAILABLE', code: 'SOURCE_UNAVAILABLE', projectId: 'p1' }))
    );
  });

  it('khác loại vấn đề hoặc khác danh sách → khác khóa (không gộp nhầm)', () => {
    const cookies = noticeIssueKey(notice({ code: 'COOKIES_EXPIRED', projectId: 'p1' }));
    expect(noticeIssueKey(notice({ code: 'DISK_FULL', projectId: 'p1' }))).not.toBe(cookies);
    expect(noticeIssueKey(notice({ code: 'COOKIES_EXPIRED', projectId: 'p2' }))).not.toBe(cookies);
    expect(noticeIssueKey(notice({ code: 'SETTINGS_SAVED', title: 'Đã lưu' }))).not.toBe(
      noticeIssueKey(notice({ code: 'BACKUP_DONE', title: 'Đã sao lưu' }))
    );
  });

  it('thông báo thao tác không mã lỗi: cùng tiêu đề là cùng vấn đề (id ngẫu nhiên không còn tách ra)', () => {
    expect(noticeIssueKey(notice({ id: 'ui-error-1', title: 'Không mở được thư mục' }))).toBe(
      noticeIssueKey(notice({ id: 'ui-error-2', title: 'Không mở được thư mục', message: 'lần 2' }))
    );
  });
});

describe('cùng vấn đề thì THAY thông báo cũ, khác vấn đề thì xếp hàng', () => {
  it('đang hiện cùng khóa → thay ngay bằng bản mới nhất, hàng đợi không tăng', () => {
    const current = notice({ id: 'a', code: 'COOKIES_EXPIRED', projectId: 'p1', message: 'cũ' });
    const next = notice({ id: 'b', code: 'COOKIES_EXPIRED', projectId: 'p1', message: 'mới nhất' });
    const result = mergeNoticeIntoQueue(current, [], next);
    expect(result.current?.message).toBe('mới nhất');
    expect(result.queue).toEqual([]);
  });

  it('trong hàng đợi đã có cùng khóa → thay tại chỗ, không chồng thêm', () => {
    const current = notice({ id: 'a', code: 'DISK_FULL', projectId: 'p1' });
    const queued = notice({ id: 'b', code: 'COOKIES_EXPIRED', projectId: 'p1', message: '1' });
    const result = mergeNoticeIntoQueue(current, [queued], notice({ id: 'c', code: 'COOKIES_EXPIRED', projectId: 'p1', message: '2' }));
    expect(result.current?.id).toBe('a');
    expect(result.queue.map((item) => item.message)).toEqual(['2']);
  });

  it('khác vấn đề → vẫn xếp hàng để hiện đầy đủ', () => {
    const current = notice({ id: 'a', code: 'DISK_FULL', projectId: 'p1' });
    const result = mergeNoticeIntoQueue(current, [], notice({ id: 'b', code: 'COOKIES_EXPIRED', projectId: 'p1' }));
    expect(result.current?.id).toBe('a');
    expect(result.queue.map((item) => item.id)).toEqual(['b']);
  });
});

describe('đã bấm X thì không hiện lại vấn đề tương tự', () => {
  it('vấn đề gắn danh sách (cảnh báo/lỗi): nhớ bền tới khi danh sách hết bị chặn', () => {
    const blocked = notice({ code: 'COOKIES_EXPIRED', projectId: 'p1', severity: 'warning' });
    let list: DismissedIssue[] = recordIssueDismissal([], blocked, new Date('2026-10-06T10:00:00Z'));
    expect(list[0]!.persistent).toBe(true);
    expect(isIssueDismissed(list, notice({ code: 'AUTHENTICATION_REQUIRED', projectId: 'p1' }))).toBe(true);
    expect(isIssueDismissed(list, notice({ code: 'COOKIES_EXPIRED', projectId: 'p2' }))).toBe(false);

    // Danh sách vẫn còn tác vụ bị chặn → giữ.
    list = pruneDismissedIssues(list, [job({ status: 'paused', errorCode: 'COOKIES_EXPIRED' })]);
    expect(list).toHaveLength(1);
    // Hết bị chặn (đã sửa / bấm Thử lại → tác vụ về pending) → tình huống đổi khác, lần chặn sau sẽ hiện lại.
    list = pruneDismissedIssues(list, [job({ status: 'pending', errorCode: null })]);
    expect(list).toHaveLength(0);
  });

  it('thông báo chặn cookies gộp chung cả app: nhớ bền tới khi KHÔNG còn tác vụ nào bị chặn vì cookies', () => {
    const blocker = notice({ id: 'cookie-blocker:global', code: 'AUTHENTICATION_REQUIRED', severity: 'warning' });
    let list = recordIssueDismissal([], blocker, new Date());
    expect(list[0]!.persistent).toBe(true);
    list = pruneDismissedIssues(list, [job({ projectId: 'p9', status: 'paused', errorCode: 'COOKIES_EXPIRED' })]);
    expect(list).toHaveLength(1);
    list = pruneDismissedIssues(list, [job({ projectId: 'p9', status: 'failed', errorCode: 'DOWNLOAD_FAILED' })]);
    expect(list).toHaveLength(0);
  });

  it('thông báo thao tác / thông tin: chỉ im trong phiên (không ghi bền)', () => {
    const list = recordIssueDismissal([], notice({ title: 'Đã sao chép', severity: 'success' }), new Date());
    expect(list[0]!.persistent).toBe(false);
    expect(isIssueDismissed(list, notice({ title: 'Đã sao chép', severity: 'success', id: 'khác' }))).toBe(true);
    // Không bị dọn theo tác vụ.
    expect(pruneDismissedIssues(list, [])).toHaveLength(1);
  });
});

describe('mọi thông báo nổi đều tự tắt; cảnh báo chặn việc giữ ≥ 12 giây', () => {
  it('lỗi thường không còn đứng cố định — tự tắt sau ~12 giây', () => {
    const policy = noticeDisplayPolicy({ severity: 'error' });
    expect(policy.persistent).toBe(false);
    expect(policy.durationMs).toBe(12_000);
  });

  it('lỗi/cảnh báo chặn việc (DISK_FULL, cookies) cũng tự tắt nhưng tối thiểu 12 giây', () => {
    expect(noticeDisplayPolicy({ severity: 'error', code: 'DISK_FULL', sticky: true }).persistent).toBe(false);
    expect(noticeDisplayPolicy({ severity: 'error', code: 'DISK_FULL', sticky: true }).durationMs).toBeGreaterThanOrEqual(12_000);
    expect(noticeDisplayPolicy({ severity: 'warning', code: 'COOKIES_EXPIRED' }).durationMs).toBeGreaterThanOrEqual(12_000);
  });
});

describe('một vấn đề chỉ hiện ở một nơi', () => {
  const log = (over: Partial<LogEntry>): LogEntry => ({
    id: 'l1',
    timestamp: new Date().toISOString(),
    level: 'error',
    module: 'download',
    eventCode: 'JOB_FAILED',
    message: 'lỗi',
    ...over
  });

  it('khung chẩn đoán bỏ qua nhật ký gắn danh sách/tác vụ (đã có thông báo nổi đại diện)', () => {
    const jobs = [job({ id: 'j1', status: 'failed', errorCode: 'DOWNLOAD_FAILED' })];
    expect(shouldDisplayDiagnostic(log({ jobId: 'j1', projectId: 'p1' }), jobs)).toBe(false);
    expect(shouldDisplayDiagnostic(log({ projectId: 'p1', eventCode: 'DOWNLOAD_FAILED' }), jobs)).toBe(false);
  });

  it('lỗi cấp ứng dụng (không gắn danh sách) vẫn hiện ở khung chẩn đoán', () => {
    expect(shouldDisplayDiagnostic(log({ module: 'tools', eventCode: 'TOOL_HEALTH_CHECK_FAILED' }), [])).toBe(true);
  });
});

describe('nối vào giao diện', () => {
  const store = readFileSync('src/renderer/src/stores/app-store.ts', 'utf8');
  const center = readFileSync('src/renderer/src/components/AttentionCenter.tsx', 'utf8');
  const dock = readFileSync('src/renderer/src/components/DiagnosticDock.tsx', 'utf8');

  it('store: thay theo khóa vấn đề, bỏ qua vấn đề đã tắt (vẫn ghi vào chuông), ghi nhớ bền và dọn khi hết bị chặn', () => {
    expect(store).toContain('mergeNoticeIntoQueue(');
    expect(store).toContain('isIssueDismissed(');
    expect(store).toContain('dismissIssueByUser:');
    expect(store).toContain('pruneDismissedIssues(');
    expect(store).toContain("'tubmedia.dismissed-issues.v1'");
  });

  it('nút X của thông báo nổi ghi nhận "người dùng đã tắt"; tự tắt theo giờ thì KHÔNG', () => {
    expect(center).toMatch(/className="attention-close"[^>]*onClick=\{closeByUser\}/);
    expect(center).toContain('dismissIssueByUser(');
  });

  it('khung chẩn đoán: X ghi nhận đã tắt trong phiên, không bật lại cùng loại', () => {
    expect(dock).toContain('dismissedDiagnosticCodes');
  });
});
