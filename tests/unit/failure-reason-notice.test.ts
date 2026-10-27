import { beforeEach, describe, expect, it } from 'vitest';
import { failureReasonLabel, summarizeFailureReasons } from '../../src/shared/utils/failure-reason.js';
import {
  coalesceBatchJobFailureAttention,
  resetBatchErrorNotificationAggregatorForTests
} from '../../src/shared/batch-error-notification-aggregator.js';
import { classifyYtDlpFailure } from '../../src/shared/utils/download-failure.js';

// 2026-10-27 (người dùng yêu cầu): thông báo "Có 2 video gặp lỗi trong 'Danh sách tải 3'" quá chung chung, phải mở Nhật ký
// mới biết lý do. Giờ nêu nguyên nhân ngay (có tên nền tảng gốc); gộp nhiều video thì nêu một lý do chung hoặc liệt kê ngắn.

describe('câu lý do ngắn, đúng tên nền tảng', () => {
  it('video bị xoá / riêng tư / chặn theo vùng — trên đúng nền tảng', () => {
    expect(failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'removed', platformLabel: 'YouTube' })).toBe('Video đã bị xoá khỏi YouTube');
    expect(
      failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'unavailable', platformLabel: 'Facebook', technicalSummary: "ERROR: [facebook] 1: This content isn't available right now" })
    ).toBe('Video đã bị xoá khỏi Facebook');
    expect(
      failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'unavailable', platformLabel: 'YouTube', technicalSummary: 'ERROR: [youtube] BAydFXOIuvo: Video unavailable. This video is private' })
    ).toBe('Video ở chế độ riêng tư trên YouTube');
    expect(
      failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'unavailable', platformLabel: 'TikTok', technicalSummary: 'This video is not available in your country' })
    ).toBe('Video bị TikTok chặn theo vùng');
    expect(failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'unavailable', platformLabel: 'Vimeo' })).toBe('Video không còn khả dụng trên Vimeo');
  });

  it('các lý do khác; không rõ nền tảng thì nói "nền tảng gốc"', () => {
    expect(failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'http_403', platformLabel: 'YouTube' })).toBe('Máy chủ YouTube từ chối tải (HTTP 403)');
    expect(failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'removed' })).toBe('Video đã bị xoá khỏi nền tảng gốc');
    expect(failureReasonLabel({ code: 'NETWORK_ERROR' })).toBe('Mạng hoặc máy chủ không ổn định');
    expect(failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype: 'unknown' })).toBe('Lỗi chưa xác định (xem Nhật ký)');
  });

  it('Vimeo "chỉ hoạt động khi đã đăng nhập" là lỗi đăng nhập, không còn "chưa xác định"', () => {
    const text =
      'ERROR: [vimeo] 190516756: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.';
    expect(classifyYtDlpFailure(text)).toMatchObject({ category: 'authentication' });
  });

  it('liệt kê theo số video, nhiều nhất trước', () => {
    expect(summarizeFailureReasons(['A', 'B', 'A'])).toBe('2 video — A; 1 video — B');
  });
});

describe('thông báo gộp nhiều video', () => {
  beforeEach(() => resetBatchErrorNotificationAggregatorForTests());
  const notice = (jobId: string, reason?: string) => ({
    id: `job-failure-p1-DOWNLOAD_FAILED`,
    severity: 'error',
    title: 'Không thể tải video',
    message: 'chi tiết',
    projectId: 'p1',
    jobId,
    code: 'DOWNLOAD_FAILED',
    ...(reason ? { reason } : {})
  });

  it('cùng một lý do → nêu ngay trên tiêu đề', () => {
    coalesceBatchJobFailureAttention(notice('a', 'Video đã bị xoá khỏi YouTube'), 'Danh sách tải 3');
    const merged = coalesceBatchJobFailureAttention(notice('b', 'Video đã bị xoá khỏi YouTube'), 'Danh sách tải 3');
    expect(merged?.title).toBe('Có 2 video lỗi trong "Danh sách tải 3": Video đã bị xoá khỏi YouTube');
    expect(merged?.message).not.toContain('Mở Nhật ký riêng');
  });

  it('nhiều lý do khác nhau → liệt kê ngắn từng lý do theo số video', () => {
    coalesceBatchJobFailureAttention(notice('a', 'Video đã bị xoá khỏi YouTube'), 'Danh sách tải 3');
    coalesceBatchJobFailureAttention(notice('b', 'Máy chủ YouTube từ chối tải (HTTP 403)'), 'Danh sách tải 3');
    const merged = coalesceBatchJobFailureAttention(notice('c', 'Video đã bị xoá khỏi YouTube'), 'Danh sách tải 3');
    expect(merged?.title).toBe('Có 3 video lỗi trong "Danh sách tải 3"');
    expect(merged?.message).toContain('Lý do: 2 video — Video đã bị xoá khỏi YouTube; 1 video — Máy chủ YouTube từ chối tải (HTTP 403).');
  });
});
