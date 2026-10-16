import { describe, expect, it } from 'vitest';
import { classifyYtDlpFailure } from '../../src/shared/utils/download-failure.js';

/**
 * 2026-10-16: bài e2e "Khởi động…" đỏ chập chờn trên CI (tái hiện 2/8 lượt ở 2 lõi, có từ 1.6.3). `taskkill /T /F` giết
 * yt-dlp trước tiến trình chính vài ms; yt-dlp bị giết không in câu lỗi nào → rơi vào nhánh cuối "Video không khả dụng…",
 * KHÔNG thử lại. Nguyên văn yt-dlp in ra khi bị giết giữa lúc lấy thông tin (đo thật): mã 1, stderr rỗng, stdout dưới đây.
 */
const KILLED_WHILE_EXTRACTING =
  '\n[generic] Extracting URL: http://127.0.0.1:56695/treo/video.html\n[generic] video: Downloading webpage\n';

describe('classifyYtDlpFailure — yt-dlp bị dừng ngang (không in câu lỗi nào)', () => {
  it('nguyên văn yt-dlp bị taskkill giữa lúc lấy thông tin → gián đoạn, thử lại được', () => {
    expect(classifyYtDlpFailure(KILLED_WHILE_EXTRACTING)).toEqual({
      category: 'retryable',
      subtype: 'interrupted',
      httpStatus: null,
      retryable: true
    });
  });

  it('không có chút đầu ra nào → gián đoạn, thử lại được', () => {
    expect(classifyYtDlpFailure('')).toMatchObject({ subtype: 'interrupted', retryable: true });
    expect(classifyYtDlpFailure('\n')).toMatchObject({ subtype: 'interrupted', retryable: true });
  });

  it('có câu ERROR: mà không nhận ra loại → lỗi không xác định, không thử lại (không còn gắn "không khả dụng")', () => {
    expect(classifyYtDlpFailure('[generic] Extracting URL: x\nERROR: something odd happened in the extractor')).toEqual({
      category: 'non_retryable',
      subtype: 'unknown',
      httpStatus: null,
      retryable: false
    });
  });

  it('yt-dlp sập kèm Traceback → lỗi không xác định (không coi là bị dừng ngang)', () => {
    expect(
      classifyYtDlpFailure('Traceback (most recent call last):\n  File "yt_dlp/__main__.py", line 17\nKeyError: \'formats\'')
    ).toMatchObject({ subtype: 'unknown', retryable: false });
  });

  it('các lỗi đã nhận ra vẫn giữ nguyên phân loại', () => {
    expect(classifyYtDlpFailure('ERROR: [youtube] abc: Video unavailable')).toMatchObject({ subtype: 'unavailable', retryable: false });
    expect(classifyYtDlpFailure('ERROR: HTTP Error 429: Too Many Requests')).toMatchObject({ category: 'rate_limit' });
    expect(classifyYtDlpFailure('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toMatchObject({ httpStatus: 403 });
  });
});
