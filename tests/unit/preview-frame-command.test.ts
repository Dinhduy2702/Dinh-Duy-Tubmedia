import { describe, expect, it } from 'vitest';
import {
  buildFrameExtractArguments,
  buildPreviewFrameDownloadArguments,
  PREVIEW_WINDOW_SECONDS
} from '../../src/main/download/preview-frame-command.js';

// Giai đoạn 3 (2026-09-23) — "Tải theo khoảng có xem trước": kiểm tra ĐÚNG những gì đã hỏi và được người
// dùng chọn — dùng yt-dlp (không tự lấy URL trực tiếp rồi tua ffmpeg từ xa), đoạn tải NHỎ NHẤT có thể
// (chỉ đủ 1 khung hình), và không cấu hình nào vô tình tải nguyên video.
describe('preview-frame-command — Giai đoạn 3', () => {
  it('chỉ tải đúng PREVIEW_WINDOW_SECONDS quanh mốc thời gian, không hơn', () => {
    expect(PREVIEW_WINDOW_SECONDS).toBeLessThanOrEqual(2); // "nhỏ nhất có thể"

    const args = buildPreviewFrameDownloadArguments(
      'https://example.invalid/watch?v=abc',
      83,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp\\preview' }
    );
    const sectionIndex = args.indexOf('--download-sections');
    expect(sectionIndex).toBeGreaterThanOrEqual(0);
    expect(args[sectionIndex + 1]).toBe(`*83-${83 + PREVIEW_WINDOW_SECONDS}`);
  });

  it('mốc âm được kẹp về 0 (không tải "trước khi video bắt đầu")', () => {
    const args = buildPreviewFrameDownloadArguments(
      'https://example.invalid/x',
      -5,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp\\preview' }
    );
    const sectionIndex = args.indexOf('--download-sections');
    expect(args[sectionIndex + 1]).toBe(`*0-${PREVIEW_WINDOW_SECONDS}`);
  });

  it('chỉ lấy VIDEO chất lượng thấp nhất có, không âm thanh — đúng yêu cầu "nhỏ nhất có thể"', () => {
    const args = buildPreviewFrameDownloadArguments(
      'https://example.invalid/x',
      0,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp\\preview' }
    );
    const formatIndex = args.indexOf('-f');
    expect(formatIndex).toBeGreaterThanOrEqual(0);
    const selector = args[formatIndex + 1];
    expect(selector).not.toContain('+ba'); // không ghép thêm luồng âm thanh
    expect(selector).toMatch(/^wv\*|^w\[/); // chỉ chọn luồng video ("worst video")
  });

  it('luôn dùng yt-dlp thật (không phải gọi trực tiếp tới URL media) — có URL nguồn ở cuối lệnh, sau "--"', () => {
    const args = buildPreviewFrameDownloadArguments(
      'https://example.invalid/watch?v=xyz',
      10,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp\\preview' }
    );
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('https://example.invalid/watch?v=xyz');
  });

  it('ép cắt chính xác tại mốc (--force-keyframes-at-cuts) để khung hình khớp đúng mốc đã chọn', () => {
    const args = buildPreviewFrameDownloadArguments('https://example.invalid/x', 0, {
      ffmpegDirectory: 'C:\\tool',
      workDirectory: 'C:\\temp\\preview'
    });
    expect(args).toContain('--force-keyframes-at-cuts');
  });

  it('không tải khi chưa cần: dùng thư mục tạm RIÊNG (home/temp trỏ đúng workDirectory truyền vào), không đụng thư mục tải chính', () => {
    const args = buildPreviewFrameDownloadArguments('https://example.invalid/x', 0, {
      ffmpegDirectory: 'C:\\tool',
      workDirectory: 'C:\\rieng\\thu-muc-tam'
    });
    expect(args).toContain('home:C:\\rieng\\thu-muc-tam');
    expect(args).toContain('temp:C:\\rieng\\thu-muc-tam');
  });

  it('có cookies khi cấu hình có — dùng đúng logic ưu tiên tệp cookies trước trình duyệt, giống tải thật', () => {
    const withFile = buildPreviewFrameDownloadArguments(
      'https://example.invalid/x',
      0,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp' },
      { cookiesFilePath: 'C:\\cookies.txt', cookiesBrowser: 'chrome', cookiesBrowserProfile: '' }
    );
    expect(withFile).toContain('--cookies');
    expect(withFile).toContain('C:\\cookies.txt');
    expect(withFile).not.toContain('--cookies-from-browser');

    const withBrowser = buildPreviewFrameDownloadArguments(
      'https://example.invalid/x',
      0,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp' },
      { cookiesFilePath: '', cookiesBrowser: 'edge', cookiesBrowserProfile: 'Default' }
    );
    expect(withBrowser).toContain('--cookies-from-browser');
    expect(withBrowser).toContain('edge:Default');

    const withNone = buildPreviewFrameDownloadArguments(
      'https://example.invalid/x',
      0,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp' },
      { cookiesFilePath: '', cookiesBrowser: 'none', cookiesBrowserProfile: '' }
    );
    expect(withNone).not.toContain('--cookies');
    expect(withNone).not.toContain('--cookies-from-browser');
  });

  it('buildFrameExtractArguments: trích ĐÚNG 1 khung hình (-frames:v 1) từ đúng tệp đã tải, ghi đè an toàn vào tệp tạm riêng', () => {
    const args = buildFrameExtractArguments('C:\\temp\\preview\\preview.mp4', 'C:\\temp\\preview\\frame.jpg');
    expect(args).toEqual(['-y', '-i', 'C:\\temp\\preview\\preview.mp4', '-frames:v', '1', '-q:v', '3', 'C:\\temp\\preview\\frame.jpg']);
  });
});
