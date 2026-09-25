import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttentionNotice } from '../../src/shared/types/domain.js';
import { encodeTypedMessage, toneForErrorCode } from '../../src/shared/utils/notice-tone.js';
import {
  ACTION_REQUIRED_WARNING_MIN_DURATION_MS,
  isActionRequiredWarning,
  noticeDisplayPolicy,
  notificationDuration
} from '../../src/shared/utils/notification-policy.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';

// Kho trạng thái của giao diện nằm ngoài dự án TypeScript của tiến trình chính (không có thư viện DOM), nên
// nạp bằng đường dẫn tính lúc chạy để trình kiểm tra kiểu không kéo cả tệp giao diện vào.
interface NotificationLike {
  id: string;
  readAt?: string;
}
interface StoreLike {
  getState(): {
    notifications: NotificationLike[];
    attention: { severity: string; code?: string } | null;
    setAttention(notice: AttentionNotice): void;
    dismissAttention(id?: string): void;
    setError(error: unknown): void;
  };
  setState(partial: Record<string, unknown>): void;
}
const storeModulePath = '../../src/renderer/src/stores/app-store.js';
const { useAppStore } = (await import(/* @vite-ignore */ storeModulePath)) as { useAppStore: StoreLike };

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('DISK_FULL là LỖI ở mọi tầng và không tự tắt', () => {
  it('bảng mức theo mã lỗi: lỗi', () => {
    expect(toneForErrorCode('DISK_FULL')).toBe('error');
    expect(toneForErrorCode('PERMISSION_DENIED')).toBe('error');
  });

  it('lỗi có dấu kiểu qua IPC: lỗi', () => {
    const wire = encodeTypedMessage('error', 'DISK_FULL', 'Ổ đĩa không đủ dung lượng: D:');
    expect(friendlyIssue(new Error(wire)).tone).toBe('error');
  });

  it('câu chữ chưa có dấu kiểu (nhật ký, tác vụ đã lưu) cũng ra lỗi, không còn cảnh báo', () => {
    expect(friendlyIssue('DISK_FULL').tone).toBe('error');
    expect(friendlyIssue('Ổ đĩa không đủ dung lượng: D:').tone).toBe('error');
    expect(friendlyIssue('ENOSPC: no space left on device').tone).toBe('error');
    expect(friendlyIssue('PERMISSION_DENIED: Không có quyền truy cập').tone).toBe('error');
  });

  it('thông báo chặn từ tiến trình chính lấy mức từ bảng mức theo mã, không ghi cứng danh sách cảnh báo', () => {
    const queue = source('src/main/queue/queue-manager.ts');
    expect(queue).toContain("import { toneForErrorCode } from '@shared/utils/notice-tone.js';");
    expect(queue).toContain('severity: toneForErrorCode(code),');
    // Ngay sau khi dựng thông báo chặn (id "blocking-…") mức phải lấy từ bảng mức, không phải danh sách viết cứng.
    const block = /id: `blocking-\$\{scope\}-\$\{code\}`,([\s\S]{0,600}?)title,/.exec(queue)?.[1] ?? '';
    expect(block).toContain('severity: toneForErrorCode(code)');
    expect(block).not.toContain("'warning'");
  });

  it('thông báo DISK_FULL không tự tắt dù không có cờ sticky', () => {
    const notice: AttentionNotice = {
      id: 'x',
      severity: toneForErrorCode('DISK_FULL'),
      title: 'Ổ đĩa không đủ dung lượng',
      message: 'm',
      code: 'DISK_FULL'
    };
    expect(noticeDisplayPolicy(notice).persistent).toBe(true);
    expect(noticeDisplayPolicy({ ...notice, sticky: true }).persistent).toBe(true);
  });

  it('bảng kiểm kê ghi DISK_FULL là Lỗi và không nơi nào ghi là cảnh báo', () => {
    const doc = source('docs/THONG_BAO_v1.4.md');
    const lines = doc.split('\n').filter((line) => line.includes('DISK_FULL') && line.startsWith('|'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, line).toMatch(/\| Lỗi \|/);
      expect(line, line).not.toMatch(/\| Cảnh báo \|/);
    }
  });
});

describe('quy tắc hiển thị thông báo nổi', () => {
  it('lỗi thật không tự tắt, kể cả khi không có cờ sticky; chỉ đóng khi nguyên nhân đã được giải quyết', () => {
    expect(noticeDisplayPolicy({ severity: 'error' }).persistent).toBe(true);
    expect(noticeDisplayPolicy({ severity: 'error', sticky: false }).persistent).toBe(true);
    expect(noticeDisplayPolicy({ severity: 'error', sticky: true }, true).persistent).toBe(false);
  });

  it('mọi mức khác không nằm lại, dù có cờ sticky', () => {
    for (const severity of ['warning', 'info', 'success', 'neutral'] as const) {
      expect(noticeDisplayPolicy({ severity, sticky: true }).persistent, severity).toBe(false);
    }
  });

  it('cảnh báo cần hành động hiện tối thiểu 12 giây', () => {
    expect(ACTION_REQUIRED_WARNING_MIN_DURATION_MS).toBe(12_000);
    for (const code of [
      'AUTHENTICATION_REQUIRED',
      'COOKIES_EXPIRED',
      'BROWSER_COOKIE_DATABASE_LOCKED',
      'SOURCE_RATE_LIMITED',
      'NETWORK_CIRCUIT_OPEN',
      'NETWORK_ERROR',
      'UPDATE_BLOCKED_ACTIVE_WORK',
      'UPDATE_DOWNLOAD_FAILED',
      'UPDATE_INSTALL_PREPARATION_FAILED'
    ]) {
      const policy = noticeDisplayPolicy({ severity: 'warning', code });
      expect(policy.actionRequired, code).toBe(true);
      expect(policy.durationMs, code).toBeGreaterThanOrEqual(12_000);
    }
  });

  it('cảnh báo có các bước hướng dẫn hoặc được đánh dấu sticky cũng là cảnh báo cần hành động', () => {
    expect(isActionRequiredWarning({ severity: 'warning', steps: ['Đăng nhập lại.'] })).toBe(true);
    expect(isActionRequiredWarning({ severity: 'warning', sticky: true })).toBe(true);
    expect(isActionRequiredWarning({ severity: 'warning', steps: [] })).toBe(false);
    expect(isActionRequiredWarning({ severity: 'error', code: 'NETWORK_ERROR' })).toBe(false);
  });

  it('cảnh báo chỉ để biết, thông tin, thành công, trung tính giữ thời gian ngắn như cũ', () => {
    expect(noticeDisplayPolicy({ severity: 'warning', code: 'MA_LA' }).durationMs).toBe(notificationDuration('warning'));
    expect(noticeDisplayPolicy({ severity: 'success' }).durationMs).toBe(notificationDuration('success'));
    expect(noticeDisplayPolicy({ severity: 'info' }).durationMs).toBe(notificationDuration('info'));
    expect(noticeDisplayPolicy({ severity: 'neutral' }).durationMs).toBe(notificationDuration('neutral'));
    for (const severity of ['warning', 'info', 'success', 'neutral'] as const) {
      expect(noticeDisplayPolicy({ severity }).durationMs, severity).toBeLessThanOrEqual(6_500);
    }
  });

  it('chặn cập nhật đi qua IPC (lỗi có kiểu) là cảnh báo cần hành động ≥ 12 giây', () => {
    const wire = encodeTypedMessage(
      'warning',
      'UPDATE_BLOCKED_ACTIVE_WORK',
      'Hãy tạm dừng hoặc hoàn tất mọi tác vụ tải, cắt, ghép và Tải nhanh trước khi cập nhật.'
    );
    const issue = friendlyIssue(new Error(wire));
    expect(issue.code).toBe('UPDATE_BLOCKED_ACTIVE_WORK');
    const policy = noticeDisplayPolicy({ severity: issue.tone, code: issue.code, steps: issue.steps });
    expect(policy.persistent).toBe(false);
    expect(policy.durationMs).toBeGreaterThanOrEqual(12_000);
  });

  it('thông báo nổi tạm dừng đồng hồ khi trỏ chuột hoặc focus vào và dùng đúng quy tắc chung', () => {
    const toast = source('src/renderer/src/components/AttentionCenter.tsx');
    expect(toast).toContain('onMouseEnter={() => setPaused(true)}');
    expect(toast).toContain('onMouseLeave={() => setPaused(false)}');
    expect(toast).toContain('onFocusCapture={() => setPaused(true)}');
    expect(toast).toContain('onBlurCapture={() => setPaused(false)}');
    expect(toast).toMatch(/if \(!key \|\| sticky \|\| paused \|\| phase !== 'visible'\) return;/);
    expect(toast).toContain('noticeDisplayPolicy(');
    expect(toast).toContain('const duration = display.durationMs;');
  });
});

describe('thông báo luôn còn ở Trung tâm thông báo dưới dạng mục chưa đọc', () => {
  beforeEach(() => {
    useAppStore.setState({ notifications: [], attention: null, attentionQueue: [], error: null });
  });

  it('cảnh báo cần hành động vẫn chưa đọc sau khi thông báo nổi đã đóng', () => {
    const notice: AttentionNotice = {
      id: 'cookie-blocker:test',
      severity: 'warning',
      title: 'Cần thêm Cookies',
      message: 'Nguồn này yêu cầu đăng nhập để xem.',
      code: 'AUTHENTICATION_REQUIRED'
    };
    useAppStore.getState().setAttention(notice);
    useAppStore.getState().dismissAttention(notice.id);

    const state = useAppStore.getState();
    expect(state.attention).toBeNull();
    const stored = state.notifications.find((item) => item.id === notice.id);
    expect(stored).toBeDefined();
    expect(stored?.readAt).toBeUndefined();
    expect(state.notifications.filter((item) => !item.readAt).length).toBe(1);
  });

  it('lỗi qua setError cũng để lại mục chưa đọc kèm mã lỗi khi đóng thông báo nổi', () => {
    const wire = encodeTypedMessage('warning', 'UPDATE_BLOCKED_ACTIVE_WORK', 'Hãy tạm dừng hoặc hoàn tất mọi tác vụ.');
    useAppStore.getState().setError(new Error(wire));
    const state = useAppStore.getState();
    expect(state.attention?.severity).toBe('warning');
    expect(state.attention?.code).toBe('UPDATE_BLOCKED_ACTIVE_WORK');
    useAppStore.getState().dismissAttention();
    const after = useAppStore.getState();
    expect(after.notifications).toHaveLength(1);
    expect(after.notifications[0]?.readAt).toBeUndefined();
  });

  it('có chấm báo chưa đọc ở chuông và ở từng mục, và nhãn "Cần xử lý" cho cảnh báo cần hành động', () => {
    const topbar = source('src/renderer/src/layout/Topbar.tsx');
    expect(topbar).toContain('notificationSummary.unread > 0');
    expect(topbar).toContain('has-unread');
    const center = source('src/renderer/src/components/NotificationCenter.tsx');
    expect(center).toContain('notification-unread-dot');
    expect(center).toContain('isActionRequiredWarning(notification)');
  });
});
