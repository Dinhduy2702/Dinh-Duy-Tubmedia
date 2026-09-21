import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSafeYtDlpArguments,
  withEndOfOptionsUrl,
  withIgnoredConfig
} from '../../src/main/downloader/ytdlp-arguments.js';
import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';
import { isSafeMediaUrl } from '../../src/shared/utils/url.js';

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('tham số an toàn cho yt-dlp', () => {
  it('đặt --ignore-config đầu tiên và URL cuối cùng sau "--"', () => {
    const args = buildSafeYtDlpArguments(['--no-playlist', '-o', 'x.%(ext)s'], 'https://example.com/v');
    expect(args).toEqual(['--ignore-config', '--no-playlist', '-o', 'x.%(ext)s', '--', 'https://example.com/v']);
  });

  it('URL giống tùy chọn vẫn chỉ là đối số vị trí nằm sau "--"', () => {
    const args = buildSafeYtDlpArguments(['--no-playlist'], '--exec calc.exe');
    const separator = args.indexOf('--');
    expect(args.slice(separator)).toEqual(['--', '--exec calc.exe']);
    expect(args.indexOf('--exec calc.exe')).toBeGreaterThan(separator);
    expect(args.slice(0, separator)).not.toContain('--exec calc.exe');
  });

  it('không nhân đôi --ignore-config hay "--"', () => {
    const args = buildSafeYtDlpArguments(['--ignore-config', '--no-playlist', '--'], 'https://example.com/v');
    expect(args.filter((value) => value === '--ignore-config')).toHaveLength(1);
    expect(args.filter((value) => value === '--')).toHaveLength(1);
    expect(withIgnoredConfig([])).toEqual(['--ignore-config']);
    expect(withEndOfOptionsUrl([], 'u')).toEqual(['--', 'u']);
  });
});

describe('luồng tải nhanh (quick download)', () => {
  it('kết thúc bằng "--" rồi URL và vẫn giữ --ignore-config', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://www.youtube.com/watch?v=test',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'full',
      startTime: '',
      endTime: '',
      accurateCut: false
    });
    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'token'
    });
    expect(args[0]).toBe('--ignore-config');
    expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=test']);
    expect(args.filter((value) => value === '--')).toHaveLength(1);
  });
});

describe('nối dây vào luồng tải chính và luồng lọc video', () => {
  it('luồng tải chính không để URL đứng đầu và chạy yt-dlp qua bộ dựng tham số an toàn', () => {
    const engine = source('src/main/downloader/download-engine.ts');
    expect(engine.match(/buildSafeYtDlpArguments/g)).toHaveLength(2); // import + lời gọi
    expect(engine).toContain('ytdlp-arguments.js');
    expect(engine).toContain('args: buildSafeYtDlpArguments(args, source.originalUrl)');
    expect(engine).not.toMatch(/const args = \[\s*source\.originalUrl/);
  });

  it('luồng lọc video luôn truyền --ignore-config cho yt-dlp', () => {
    const filter = source('src/main/media/video-link-filter-service.ts');
    const block = /const args = \[([\s\S]*?)\];/.exec(filter)?.[1] ?? '';
    expect(block).toContain("'--ignore-config'");
    expect(block.indexOf("'--ignore-config'")).toBeLessThan(block.indexOf("'--batch-file'"));
  });
});

describe('isSafeMediaUrl', () => {
  it.each([
    'https://www.youtube.com/watch?v=abc123',
    'http://example.com/video.mp4',
    'HTTPS://Example.com/Ti%E1%BB%81u',
    'https://example.com/tiêu-đề?x=1'
  ])('chấp nhận %s', (value) => {
    expect(isSafeMediaUrl(value)).toBe(true);
  });

  it.each([
    '',
    '--exec calc.exe',
    '-o C:\\x',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'ftp://example.com/x',
    'https://',
    'https://example.com/a b',
    'https://example.com/a\nb',
    ' https://example.com/',
    'https://example.com/\u0000',
    `https://example.com/${'a'.repeat(9000)}`
  ])('từ chối %j', (value) => {
    expect(isSafeMediaUrl(value)).toBe(false);
  });

  it('từ chối giá trị không phải chuỗi', () => {
    expect(isSafeMediaUrl(null)).toBe(false);
    expect(isSafeMediaUrl(42)).toBe(false);
    expect(isSafeMediaUrl(undefined)).toBe(false);
  });
});
