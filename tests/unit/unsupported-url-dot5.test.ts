import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyYtDlpFailure,
  failureSubtypeFromDetails,
  unsupportedSourceUrlMessage
} from '../../src/shared/utils/download-failure.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';

// Đợt 5 mục 19 (rà soát bản cài 2026-10-02): link trang báo bị yt-dlp báo rõ "Unsupported URL" nhưng Tubmedia xếp vào
// subtype 'unavailable' và báo câu chung "Video không khả dụng, URL không được hỗ trợ hoặc nền tảng đang từ chối truy
// cập". Phải tách riêng loại "link không được hỗ trợ" kèm câu cụ thể: trang không có video tải được, dùng link video gốc.

// Đúng nguyên văn yt-dlp thật in ra với một trang HTML không có video (đã chạy thật 2026-10-09).
const REAL_OUTPUT = [
  '[generic] Extracting URL: https://vnexpress.net/tin-tuc/bai-bao-123.html',
  '[generic] bai-bao-123: Downloading webpage',
  '[generic] bai-bao-123: Extracting information',
  'WARNING: [generic] Falling back on generic information extractor',
  'ERROR: Unsupported URL: https://vnexpress.net/tin-tuc/bai-bao-123.html'
].join('\n');

describe('classifyYtDlpFailure — link không được hỗ trợ là loại riêng', () => {
  it('"Unsupported URL" → unsupported_url, không thử lại', () => {
    expect(classifyYtDlpFailure(REAL_OUTPUT)).toEqual({
      category: 'non_retryable',
      subtype: 'unsupported_url',
      httpStatus: null,
      retryable: false
    });
  });

  it('các câu cùng nghĩa của yt-dlp cũng là unsupported_url', () => {
    for (const text of [
      'ERROR: No suitable extractor found for URL https://example.com/x',
      "ERROR: 'abc' is not a valid URL. Set --default-search \"ytsearch\" (or run  yt-dlp \"ytsearch:abc\" ) to search YouTube",
      'ERROR: unknown url type: abc'
    ]) {
      expect(classifyYtDlpFailure(text).subtype, text).toBe('unsupported_url');
    }
  });

  it('video không khả dụng/riêng tư/chặn vùng VẪN là unavailable (không bị kéo sang loại mới)', () => {
    for (const text of [
      'ERROR: [youtube] abc: Video unavailable',
      'ERROR: [youtube] abc: Private video. Sign in if you',
      'ERROR: The uploader has not made this video available in your country',
      'ERROR: [youtube] abc: Requested format is not available'
    ]) {
      const subtype = classifyYtDlpFailure(text).subtype;
      expect(subtype, text).not.toBe('unsupported_url');
    }
    expect(classifyYtDlpFailure('ERROR: [youtube] abc: Video unavailable').subtype).toBe('unavailable');
  });

  it('subtype mới đọc lại được từ chi tiết lỗi đã lưu', () => {
    expect(failureSubtypeFromDetails({ failureSubtype: 'unsupported_url' })).toBe('unsupported_url');
  });
});

describe('câu báo cho link không được hỗ trợ', () => {
  it('nói rõ trang này không có video tải được và hướng dẫn dùng link video gốc', () => {
    const message = unsupportedSourceUrlMessage();
    expect(message).toContain('không có video');
    expect(message).toContain('liên kết gốc');
    expect(message).not.toContain('nền tảng đang từ chối truy cập');
  });

  it('giao diện (Hàng đợi, thông báo) hiện tiêu đề và cách xử lý riêng, không phải câu chung', () => {
    const issue = friendlyIssue(unsupportedSourceUrlMessage());
    expect(issue.title).toBe('Liên kết không phải trang video');
    expect(issue.steps.join(' ')).toContain('liên kết gốc');
  });

  it('DownloadEngine dùng câu riêng khi subtype là unsupported_url', () => {
    const engine = readFileSync('src/main/downloader/download-engine.ts', 'utf8');
    expect(engine).toContain("failure.subtype === 'unsupported_url'");
    expect(engine).toContain('unsupportedSourceUrlMessage()');
  });
});
