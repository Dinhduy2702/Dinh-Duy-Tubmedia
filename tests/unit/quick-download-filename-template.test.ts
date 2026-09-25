/**
 * Giai đoạn 6 mục 7 (2026-09-24) — "Mẫu đặt tên tệp": người dùng cấu hình một mẫu (token {title}/
 * {channel}/{date}/{id}) trong Cài đặt cho Tải nhanh. Chỉ áp dụng cho NHÁNH BÌNH THƯỜNG — nhánh
 * "compactFilename" là lưới an toàn tự động (tên quá dài/không hợp lệ với Windows) PHẢI giữ cố định.
 */
import { describe, expect, it } from 'vitest';
import {
  buildFilenamePrefixFromTemplate,
  buildQuickDownloadArguments,
  DEFAULT_QUICK_DOWNLOAD_FILENAME_TEMPLATE
} from '../../src/main/download/quick-download-command.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';

function request(overrides: Partial<Parameters<typeof validateQuickDownloadRequest>[0]> = {}) {
  return validateQuickDownloadRequest({
    url: 'https://www.youtube.com/watch?v=test',
    outputDirectory: 'C:\\Downloads',
    quality: 'best',
    mode: 'full',
    startTime: '',
    endTime: '',
    accurateCut: false,
    ...overrides
  });
}

const FIXED_NOW = new Date('2026-09-24T08:00:00.000Z');

describe('Giai đoạn 6 mục 7 — buildFilenamePrefixFromTemplate (mẫu đặt tên tệp Tải nhanh)', () => {
  it('mặc định (không cấu hình gì) khớp ĐÚNG hành vi cũ trước khi có tính năng này', () => {
    expect(buildFilenamePrefixFromTemplate(DEFAULT_QUICK_DOWNLOAD_FILENAME_TEMPLATE, FIXED_NOW)).toBe(
      '%(title).80B [%(id)s]'
    );
  });

  it('thay đúng cả 4 token khi mẫu dùng đủ cả 4', () => {
    const result = buildFilenamePrefixFromTemplate('{title} - {channel} ({date}) [{id}]', FIXED_NOW);
    expect(result).toBe('%(title).80B - %(uploader,channel,uploader_id|)s (2026-09-24) [%(id)s]');
  });

  it('{date} là NGÀY TẢI tính tại thời điểm chạy (chuỗi tĩnh YYYY-MM-DD), không phải trường yt-dlp', () => {
    expect(buildFilenamePrefixFromTemplate('{date}', new Date('2026-01-05T23:59:00.000Z'))).toBe('2026-01-05');
  });

  it("loại bỏ ký tự '%' của người dùng để không chèn được cú pháp trường yt-dlp khác ngoài 4 token", () => {
    // Nếu không lọc, chuỗi này sẽ vô tình tạo ra một trường yt-dlp lạ (%(filepath)s) không nằm trong 4
    // token đã định nghĩa và đã được duyệt.
    expect(buildFilenamePrefixFromTemplate('%(filepath)s {title}')).toBe('(filepath)s %(title).80B');
  });

  it('mẫu rỗng/toàn khoảng trắng rơi về mẫu mặc định, không tạo tên tệp trống', () => {
    expect(buildFilenamePrefixFromTemplate('   ', FIXED_NOW)).toBe(
      buildFilenamePrefixFromTemplate(DEFAULT_QUICK_DOWNLOAD_FILENAME_TEMPLATE, FIXED_NOW)
    );
  });

  it('token lạ không nằm trong 4 token đã định nghĩa được giữ nguyên dạng chữ (vô hại)', () => {
    expect(buildFilenamePrefixFromTemplate('{title} {unknown}', FIXED_NOW)).toBe('%(title).80B {unknown}');
  });
});

describe('Giai đoạn 6 mục 7 — buildQuickDownloadArguments dùng đúng mẫu đã cấu hình', () => {
  it('dùng filenameTemplate đã cấu hình khi KHÔNG ở chế độ compactFilename', () => {
    const args = buildQuickDownloadArguments(
      request(),
      { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\quick', runToken: 'token' },
      undefined,
      { filenameTemplate: '{channel} - {title}' }
    );
    const outputArg = args[args.indexOf('-o') + 1]!;
    expect(outputArg.startsWith('%(uploader,channel,uploader_id|)s - %(title).80B')).toBe(true);
    expect(outputArg).toContain('[QD-token]'); // hậu tố bắt buộc, không do người dùng chỉnh được.
  });

  it('KHÔNG dùng mẫu đã cấu hình khi compactFilename=true — lưới an toàn tự động PHẢI cố định', () => {
    const args = buildQuickDownloadArguments(
      request(),
      { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\quick', runToken: 'token' },
      undefined,
      { compactFilename: true, filenameTemplate: '{channel} - {title} - {date}' }
    );
    const outputArg = args[args.indexOf('-o') + 1]!;
    expect(outputArg.startsWith('Video [%(id)s]')).toBe(true);
    expect(outputArg).not.toContain('uploader');
  });

  it('không cấu hình gì (filenameTemplate=undefined): dùng đúng mẫu mặc định, khớp hành vi cũ', () => {
    const args = buildQuickDownloadArguments(request(), {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'token'
    });
    const outputArg = args[args.indexOf('-o') + 1]!;
    expect(outputArg.startsWith('%(title).80B [%(id)s]')).toBe(true);
  });

  it('vẫn giữ đúng khoảng cắt và hậu tố [QD-token] khi kết hợp với mẫu tùy chỉnh', () => {
    const args = buildQuickDownloadArguments(
      request({ mode: 'range', startTime: '00:00:10', endTime: '00:00:20' }),
      { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\quick', runToken: 'abc' },
      undefined,
      { filenameTemplate: '{date}' }
    );
    const outputArg = args[args.indexOf('-o') + 1]!;
    expect(outputArg).toMatch(/^\d{4}-\d{2}-\d{2} \[00-10-00-20\] \[QD-abc]\./);
  });
});
