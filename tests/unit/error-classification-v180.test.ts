import { describe, expect, it } from 'vitest';
import {
  APP_FAULT_DEFAULT_SUMMARY,
  formatAppFaultMessage,
  formatUserActionMessage,
  parseAppFaultMessage,
  parseUserActionMessage
} from '../../src/shared/utils/user-action-message.js';
import { friendlyIssue, jobFriendlyIssue } from '../../src/shared/utils/ui-error.js';
import { encodeTypedMessage } from '../../src/shared/utils/notice-tone.js';
import { exhaustedDownloadFailureMessage } from '../../src/shared/utils/download-failure.js';

/**
 * 1.8.0 (yêu cầu người dùng 2026-11-25): lỗi người dùng tự xử lý được → tiêu đề đời thường + bước cụ thể + nút mở đúng
 * trang; lỗi của ứng dụng → "Lỗi của ứng dụng" (báo cáo đã tự lưu), không đổ cho người dùng, chi tiết kỹ thuật chỉ ở mục
 * Chi tiết.
 */
describe('lỗi của ứng dụng (app fault)', () => {
  it('dựng và đọc lại câu lỗi ứng dụng, tách phần kỹ thuật', () => {
    const text = formatAppFaultMessage({ technical: 'TypeError: Cannot read properties of undefined (reading "id")' });
    expect(text.split('\n')[0]).toBe(`Lỗi của ứng dụng — ${APP_FAULT_DEFAULT_SUMMARY}`);
    expect(parseAppFaultMessage(text)).toEqual({
      summary: APP_FAULT_DEFAULT_SUMMARY,
      technical: 'TypeError: Cannot read properties of undefined (reading "id")'
    });
    expect(parseUserActionMessage(text)).toBeNull();
    expect(parseAppFaultMessage('Video đã bị xoá')).toBeNull();
  });

  it('friendlyIssue hiện thẻ lỗi ứng dụng: không lộ kỹ thuật ở câu chính, có bước Thử lại / Gửi báo cáo', () => {
    const issue = friendlyIssue(new Error(formatAppFaultMessage({ technical: 'ReferenceError: foo is not defined\n    at x (a.js:1:2)' })));
    expect(issue.kind).toBe('app-fault');
    expect(issue.title).toBe('Lỗi của ứng dụng');
    expect(issue.tone).toBe('error');
    expect(issue.message).not.toMatch(/ReferenceError|foo/);
    expect(issue.technical).toContain('ReferenceError: foo is not defined');
    expect(issue.steps.join(' ')).toMatch(/Thử lại/);
    expect(issue.steps.join(' ')).toMatch(/Gửi báo cáo lỗi/);
    expect(issue.action).toBeUndefined();
  });

  it('lỗi IPC gửi về từ tiến trình chính (có tiền tố Electron) vẫn được nhận ra', () => {
    const raw = `Error invoking remote method 'queue:retry': Error: ${formatAppFaultMessage({ technical: 'TypeError: x' })}`;
    expect(friendlyIssue(raw).kind).toBe('app-fault');
  });

  it('tác vụ UNHANDLED_ERROR (kể cả câu lỗi cũ thô) luôn là lỗi ứng dụng', () => {
    const issue = jobFriendlyIssue({ errorCode: 'UNHANDLED_ERROR', errorMessage: 'Cannot read properties of null' });
    expect(issue.kind).toBe('app-fault');
    expect(issue.technical).toContain('Cannot read properties of null');
    expect(friendlyIssue(encodeTypedMessage('error', 'UNHANDLED_ERROR', 'x is undefined')).kind).toBe('app-fault');
  });
});

describe('lỗi người dùng tự xử lý được — tiêu đề đời thường, bước cụ thể, nút đường tắt', () => {
  const cases: Array<{ name: string; text: string; title: string; page?: string }> = [
    {
      name: 'HTTP 429',
      text: 'Nền tảng đang giới hạn số yêu cầu (HTTP 429). Tubmedia đã tạm dừng đúng danh sách.',
      title: 'Nền tảng đang tạm giới hạn tải',
      page: 'settings'
    },
    {
      name: 'bị chặn bot',
      text: 'yt-dlp không hoàn tất được video: YouTube tạm chặn vì nghi tải tự động ("Sign in to confirm you’re not a bot").',
      title: 'Nền tảng đang tạm giới hạn tải',
      page: 'settings'
    },
    {
      name: 'ổ đầy',
      text: 'DISK_FULL: không đủ dung lượng trên ổ E:',
      title: 'Ổ đĩa không đủ dung lượng',
      page: 'cleanup'
    },
    {
      name: 'đường dẫn quá dài',
      text: exhaustedDownloadFailureMessage('x', { failureSubtype: 'path_too_long' }, 3),
      title: 'Đường dẫn lưu tệp quá dài'
    },
    {
      name: 'tệp bị chương trình khác mở',
      text: exhaustedDownloadFailureMessage('x', { failureSubtype: 'file_access' }, 3),
      title: 'Tệp đang bị chương trình khác mở'
    },
    {
      name: 'mất mạng',
      text: 'getaddrinfo ENOTFOUND www.youtube.com',
      title: 'Mất kết nối mạng',
      page: 'settings'
    },
    {
      name: 'video riêng tư',
      text: 'Video không khả dụng trên YouTube (riêng tư, bị gỡ hoặc bị chặn theo vùng). Mở link trong trình duyệt để xem lý do cụ thể.',
      title: 'Video không xem được công khai'
    },
    {
      name: 'giới hạn độ tuổi',
      text: 'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.',
      title: 'Video không xem được công khai'
    },
    {
      name: 'thiếu công cụ',
      text: 'Không tìm thấy công cụ yt-dlp.',
      title: 'Thiếu công cụ xử lý video',
      page: 'tools'
    },
    {
      name: 'quyền ghi thư mục',
      text: 'PERMISSION_DENIED: Không có quyền ghi vào thư mục đã chọn.',
      title: 'Không thể ghi vào thư mục đã chọn'
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const issue = friendlyIssue(testCase.text);
      expect(issue.title).toBe(testCase.title);
      expect(issue.kind).toBe('user-action');
      expect(issue.steps.length).toBeGreaterThanOrEqual(2);
      expect(issue.action?.page).toBe(testCase.page);
      // Không lộ tên hàm / mã lỗi thô trong câu chính và các bước.
      expect([issue.title, issue.message, ...issue.steps].join(' ')).not.toMatch(/ENOTFOUND|DISK_FULL|PERMISSION_DENIED|getaddrinfo/);
    });
  }

  it('câu formatUserActionMessage chỉ "Cài đặt ›" bất kỳ mục nào cũng có nút Mở Cài đặt', () => {
    const text = formatUserActionMessage({
      title: 'Nguồn chỉ có 720p',
      summary: 'Video gốc cao nhất 720p.',
      steps: ['Bật ô "Cho phép thấp hơn" trong Cài đặt › Chất lượng đầu ra.', 'Bấm Thử lại.']
    });
    const issue = friendlyIssue(text);
    expect(issue.kind).toBe('user-action');
    expect(issue.action).toEqual({ label: 'Mở Cài đặt', page: 'settings' });
  });

  it('video đã bị xoá giữ tiêu đề cũ, mức trung tính (không phải lỗi cần xử lý gấp)', () => {
    const issue = friendlyIssue(encodeTypedMessage('neutral', 'SOURCE_REMOVED', 'Video này đã bị xóa khỏi YouTube nên không thể tải. Tubmedia đã bỏ qua video này.'));
    expect(issue.title).toBe('Video không còn khả dụng');
    expect(issue.tone).toBe('neutral');
  });
});
