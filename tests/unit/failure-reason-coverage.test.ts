import { describe, expect, it } from 'vitest';
import {
  classifyYtDlpFailure,
  exhaustedDownloadFailureMessage,
  failureSubtypeFromDetails,
  finalDownloadFailureMessage,
  retryableDownloadFailureMessage
} from '../../src/shared/utils/download-failure.js';
import { failureReasonLabel } from '../../src/shared/utils/failure-reason.js';

// 2026-10-27 (rà soát trước 1.7.3, người dùng duyệt): các lỗi trước đây hiện "Lỗi chưa xác định" hoặc báo lệch giờ có lý do
// cụ thể — cả lỗi yt-dlp lẫn lỗi Tubmedia tự phát hiện sau khi tải, và lý do khi ghép video lỗi.

describe('câu yt-dlp trước đây rơi vào "chưa xác định" hoặc báo lệch', () => {
  it.each([
    ['ERROR: [youtube] x: This live event will begin in 3 hours.', 'live'],
    ['ERROR: [youtube] x: Premieres in 2 days', 'live'],
    ['ERROR: [youtube] x: Requested format is not available. Use --list-formats for a list of available formats', 'format_unavailable'],
    ['ERROR: [generic] Unable to download webpage: HTTP Error 404: Not Found', 'not_found'],
    ['ERROR: unable to download video data: HTTP Error 410: Gone', 'not_found'],
    ['ERROR: [vimeo] x: Unable to download JSON metadata: HTTP Error 401: Unauthorized', 'authentication'],
    ["ERROR: unable to rename file: [WinError 32] The process cannot access the file because it is being used by another process", 'file_access'],
    ["ERROR: unable to open for writing: [Errno 13] Permission denied: 'E:\\\\Video\\\\a.mp4.part'", 'file_access'],
    ['ERROR: [youtube] x: Unable to download webpage: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed>', 'ssl'],
    ['ERROR: Postprocessing: Conversion failed!', 'postprocess']
  ])('%s → %s', (text, subtype) => {
    expect(classifyYtDlpFailure(text).subtype).toBe(subtype);
  });

  it('"không có định dạng khớp chất lượng" nói rõ video VẪN còn, chỉ cần nới cài đặt — không còn "không khả dụng"', () => {
    const message = finalDownloadFailureMessage('format_unavailable', 'YouTube');
    expect(message).toContain('Video vẫn còn trên YouTube');
    expect(message).toContain('nới giới hạn chất lượng');
    expect(finalDownloadFailureMessage('live', 'YouTube')).toContain('phát trực tiếp');
    expect(finalDownloadFailureMessage('not_found', 'Facebook')).toContain('không còn tồn tại trên Facebook');
  });

  it('lượt sẽ thử lại nói đúng nguyên nhân (không còn mọi thứ thành "mạng không ổn định")', () => {
    expect(retryableDownloadFailureMessage('file_access')).toContain('bị chương trình khác khoá');
    expect(retryableDownloadFailureMessage('ssl')).toContain('SSL');
    expect(retryableDownloadFailureMessage('postprocess')).toContain('FFmpeg');
    expect(exhaustedDownloadFailureMessage('x', { failureSubtype: 'file_access' }, 3)).toContain('sau 3 lần thử');
  });
});

describe('lỗi Tubmedia tự phát hiện sau khi tải có lý do riêng', () => {
  it.each([
    ['file_invalid', 'Tệp tải về bị hỏng (đã cách ly)'],
    ['video_short', 'Tệp tải về bị hụt hình'],
    ['audio_lost', 'Tệp tải về bị mất tiếng'],
    ['quality_unmet', 'Không có bản đạt giới hạn chất lượng đã đặt'],
    ['remux_failed', 'Đóng gói lại sang MP4 bị lỗi'],
    ['edit_copy_failed', 'Tạo bản dựng CapCut bị lỗi'],
    ['encoder_missing', 'FFmpeg thiếu bộ mã hoá cho bản CapCut'],
    ['name_conflict', 'Trùng tên tệp với nguồn của danh sách khác']
  ])('%s → "%s"', (subtype, label) => {
    expect(failureSubtypeFromDetails({ failureSubtype: subtype }), 'loại lỗi được nhận qua details').toBe(subtype);
    expect(failureReasonLabel({ code: 'DOWNLOAD_FAILED', subtype, platformLabel: 'YouTube' })).toBe(label);
  });
});

describe('ghép video lỗi nêu lý do cụ thể', () => {
  it.each([
    ['Video nguồn #3 không vượt qua kiểm tra giải mã toàn bộ: hỏng tiếng', 'Video nguồn #3 bị hỏng'],
    ['Tubmedia đã chặn thành phẩm vì luồng âm thanh bị thiếu. File lỗi đã chuyển vào khu cách ly: x', 'Thành phẩm bị thiếu tiếng (đã chặn)'],
    ['Tubmedia đã chặn thành phẩm vì âm thanh và hình ảnh lệch 2.10 giây (giới hạn 0.5)', 'Thành phẩm lệch tiếng và hình (đã chặn)'],
    ['Các file vẫn chưa tương thích concat: a; b', 'Các video không cùng định dạng để ghép nối'],
    ['Lỗi lạ chưa gặp', 'Ghép video gặp sự cố']
  ])('%s', (message, label) => {
    expect(failureReasonLabel({ code: 'MERGE_FAILED', jobType: 'merge', message })).toBe(label);
  });
});
