/**
 * Rà soát toàn diện (2026-09-24) — mục 2.2: buildCookieArguments() gộp logic dựng tham số cookie cho
 * yt-dlp trước đây lặp lại giống hệt ở 3 nơi (download-engine.ts, quick-download-command.ts,
 * preview-frame-command.ts) thành MỘT hàm dùng chung. Test này xác nhận hành vi ĐÚNG NHƯ TRƯỚC KHI GỘP
 * (đối chiếu với logic if/else-if gốc: ưu tiên tệp cookies, rồi mới tới trình duyệt, không có gì thì
 * không thêm tham số nào) — viết TRƯỚC khi wiring vào 3 nơi gọi thật, theo đúng quy trình đã thống nhất.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCookieArguments } from '../../src/main/downloader/ytdlp-cookie-arguments.js';

const read = (relativePath: string): string => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('Rà soát toàn diện mục 2.2 — buildCookieArguments (dùng chung cho mọi luồng gọi yt-dlp)', () => {
  it('ưu tiên tệp cookies Netscape khi có, bỏ qua cấu hình trình duyệt dù cũng có', () => {
    const args = buildCookieArguments({
      cookiesFilePath: 'C:\\cookies.txt',
      cookiesBrowser: 'chrome',
      cookiesBrowserProfile: 'Default'
    });
    expect(args).toEqual(['--cookies', 'C:\\cookies.txt']);
  });

  it('không có tệp cookies: dùng trình duyệt, kèm hồ sơ nếu có (nối bằng ":")', () => {
    const args = buildCookieArguments({
      cookiesFilePath: '',
      cookiesBrowser: 'edge',
      cookiesBrowserProfile: 'Default'
    });
    expect(args).toEqual(['--cookies-from-browser', 'edge:Default']);
  });

  it('trình duyệt không có hồ sơ riêng: chỉ tên trình duyệt, không có dấu ":"', () => {
    const args = buildCookieArguments({
      cookiesFilePath: '',
      cookiesBrowser: 'firefox',
      cookiesBrowserProfile: ''
    });
    expect(args).toEqual(['--cookies-from-browser', 'firefox']);
  });

  it("cookiesBrowser='none' và không có tệp: không thêm tham số nào cả", () => {
    const args = buildCookieArguments({
      cookiesFilePath: '',
      cookiesBrowser: 'none',
      cookiesBrowserProfile: ''
    });
    expect(args).toEqual([]);
  });

  it('không truyền settings (undefined): không thêm tham số nào — không lỗi', () => {
    expect(buildCookieArguments(undefined)).toEqual([]);
    expect(buildCookieArguments()).toEqual([]);
  });
});

describe('Rà soát toàn diện mục 2.2 — cả 3 nơi gọi yt-dlp đều dùng buildCookieArguments() dùng chung', () => {
  it('download-engine.ts, quick-download-command.ts, preview-frame-command.ts đều import và gọi hàm dùng chung, không tự dựng lại logic cookie riêng', () => {
    const downloadEngine = read('src/main/downloader/download-engine.ts');
    const quickDownloadCommand = read('src/main/download/quick-download-command.ts');
    const previewFrameCommand = read('src/main/download/preview-frame-command.ts');

    for (const source of [downloadEngine, quickDownloadCommand, previewFrameCommand]) {
      expect(source).toContain("ytdlp-cookie-arguments.js'");
      expect(source).toContain('buildCookieArguments(');
      // Không còn logic if/else-if dựng cookie riêng lẻ ở bất kỳ nơi nào trong 3 nơi này.
      expect(source).not.toContain("args.push('--cookies-from-browser'");
    }
    expect(downloadEngine).toContain("from './ytdlp-cookie-arguments.js'");

    // download-engine.ts: import tương đối trong cùng thư mục ('./'), 2 nơi kia import chéo thư mục
    // ('../downloader/') — khác đường dẫn tương đối nhưng cùng trỏ về một tệp nguồn duy nhất.
    expect(quickDownloadCommand).toContain("from '../downloader/ytdlp-cookie-arguments.js'");
    expect(previewFrameCommand).toContain("from '../downloader/ytdlp-cookie-arguments.js'");
  });
});
