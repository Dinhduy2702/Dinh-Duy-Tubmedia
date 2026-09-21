import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertGuardedSettingsChange,
  defaultFeedHosts,
  expectedToolFileName,
  feedHostsFromUpdateConfig,
  feedUrlError,
  sanitizeGuardedSettings,
  sanitizeRestoredAppSettings,
  toolPathDiskError,
  toolPathSyntaxError
} from '../../src/main/security/settings-policy.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { AppSettings } from '../../src/shared/types/domain.js';

const HOSTS = ['github.com'];
let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function makeTool(name: string): string {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-policy-'));
  const path = join(folder, name);
  writeFileSync(path, 'x');
  return path;
}

describe('đường dẫn công cụ (cú pháp)', () => {
  it.each([
    ['ytdlpPath', 'C:\\Tools\\yt-dlp.exe'],
    ['ytdlpPath', '"C:\\Program Files\\yt-dlp\\YT-DLP.EXE"'],
    ['ffmpegPath', 'D:\\bin\\ffmpeg.exe'],
    ['ffprobePath', 'D:\\bin\\ffprobe.exe'],
    ['aria2cPath', 'E:\\a\\aria2c.exe']
  ] as const)('chấp nhận %s = %s', (key, value) => {
    expect(toolPathSyntaxError(key, value, 'win32')).toBeNull();
  });

  it('chuỗi rỗng nghĩa là tự động và luôn hợp lệ', () => {
    expect(toolPathSyntaxError('ytdlpPath', '', 'win32')).toBeNull();
    expect(toolPathSyntaxError('ytdlpPath', '   ', 'win32')).toBeNull();
  });

  it.each([
    ['UNC', '\\\\server\\share\\yt-dlp.exe'],
    ['UNC dạng //', '//server/share/yt-dlp.exe'],
    ['đường dẫn thiết bị', '\\\\?\\C:\\Tools\\yt-dlp.exe'],
    ['sai tên tệp', 'C:\\Tools\\virus.exe'],
    ['tên công cụ khác', 'C:\\Tools\\ffmpeg.exe'],
    ['đuôi thừa', 'C:\\Tools\\yt-dlp.exe.exe'],
    ['dấu chấm cuối', 'C:\\Tools\\yt-dlp.exe.'],
    ['luồng dữ liệu phụ', 'C:\\Tools\\yt-dlp.exe:evil'],
    ['đường dẫn tương đối', 'tool\\yt-dlp.exe'],
    ['tên trần', 'yt-dlp.exe'],
    ['thư mục', 'C:\\Tools\\']
  ])('từ chối %s', (_label, value) => {
    expect(toolPathSyntaxError('ytdlpPath', value, 'win32')).not.toBeNull();
  });

  it('tên hợp lệ phụ thuộc hệ điều hành', () => {
    expect(expectedToolFileName('ytdlpPath', 'win32')).toBe('yt-dlp.exe');
    expect(expectedToolFileName('aria2cPath', 'linux')).toBe('aria2c');
  });
});

describe('đường dẫn công cụ (trên đĩa)', () => {
  it('chấp nhận tệp thật, từ chối thư mục và tệp không tồn tại', () => {
    const tool = makeTool(expectedToolFileName('ytdlpPath'));
    expect(toolPathDiskError(tool)).toBeNull();
    expect(toolPathDiskError(folder)).toMatch(/không phải là một tệp/);
    expect(toolPathDiskError(join(folder, 'khong-co', 'yt-dlp.exe'))).toMatch(/Không tìm thấy/);
  });
});

describe('địa chỉ nhận cập nhật', () => {
  it('chấp nhận HTTPS cùng host mặc định', () => {
    expect(feedUrlError('https://github.com/Dinhduy2702/Dinh-Duy-Tubmedia/releases/latest/download/', HOSTS)).toBeNull();
    expect(feedUrlError('HTTPS://GitHub.com/x/y/', HOSTS)).toBeNull();
    expect(feedUrlError('', HOSTS)).toBeNull();
  });

  it.each([
    ['http thường', 'http://github.com/x/y/'],
    ['host khác', 'https://updates.evil.example/tubmedia/'],
    ['host giả có tiền tố', 'https://github.com.evil.example/x/'],
    ['host phụ', 'https://objects.github.com/x/'],
    ['userinfo đánh lừa', 'https://github.com@evil.example/x/'],
    ['có tài khoản', 'https://user:pass@github.com/x/'],
    ['cổng khác', 'https://github.com:8443/x/'],
    ['giao thức khác', 'file://github.com/x/'],
    ['không phải URL', 'không-phải-url']
  ])('từ chối %s', (_label, value) => {
    expect(feedUrlError(value, HOSTS)).not.toBeNull();
  });

  it('lấy host mặc định từ app-update.yml', () => {
    expect(feedHostsFromUpdateConfig('provider: github\nowner: a\nrepo: b\n')).toEqual(['github.com']);
    expect(feedHostsFromUpdateConfig('provider: github\nhost: ghe.example.com\n')).toEqual(['ghe.example.com']);
    expect(feedHostsFromUpdateConfig('provider: generic\nurl: https://Updates.Example.com/tubmedia/\n')).toEqual([
      'updates.example.com'
    ]);
    expect(feedHostsFromUpdateConfig('linh tinh')).toEqual([]);
  });

  it('đọc app-update.yml trong thư mục resources và mặc định về github.com khi thiếu', () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-feed-'));
    writeFileSync(join(folder, 'app-update.yml'), 'provider: generic\nurl: https://updates.example.com/t/\n');
    expect(defaultFeedHosts(folder)).toEqual(['updates.example.com']);
    const empty = join(folder, 'empty');
    mkdirSync(empty);
    expect(defaultFeedHosts(empty)).toEqual(['github.com']);
    expect(defaultFeedHosts(undefined)).toEqual(['github.com']);
  });
});

function settingsWith(patch: Partial<AppSettings>): AppSettings {
  return { ...defaultAppSettings, ...patch };
}

describe('làm sạch cài đặt khi đọc từ database', () => {
  it('bỏ giá trị nguy hiểm, giữ giá trị hợp lệ, không đụng vào trường khác', () => {
    const { settings, dropped } = sanitizeGuardedSettings(
      settingsWith({
        appFeedUrl: 'https://evil.example/feed/',
        ytdlpPath: 'C:\\evil\\virus.exe',
        ffmpegPath: '\\\\server\\share\\ffmpeg.exe',
        ffprobePath: 'D:\\bin\\ffprobe.exe',
        proxy: 'http://127.0.0.1:8080'
      }),
      HOSTS
    );
    expect(settings.appFeedUrl).toBe('');
    expect(settings.ytdlpPath).toBe('');
    expect(settings.ffmpegPath).toBe('');
    expect(settings.ffprobePath).toBe('D:\\bin\\ffprobe.exe');
    expect(settings.proxy).toBe('http://127.0.0.1:8080');
    expect(dropped.map((item) => item.key).sort()).toEqual(['appFeedUrl', 'ffmpegPath', 'ytdlpPath']);
  });

  it('trả lại đúng đối tượng cũ khi mọi thứ hợp lệ', () => {
    const original = settingsWith({});
    const { settings, dropped } = sanitizeGuardedSettings(original, HOSTS);
    expect(settings).toBe(original);
    expect(dropped).toEqual([]);
  });
});

describe('kiểm tra khi người dùng lưu cài đặt', () => {
  it('từ chối địa chỉ cập nhật khác host và đường dẫn sai tên', () => {
    const current = settingsWith({});
    expect(() => assertGuardedSettingsChange(current, { appFeedUrl: 'https://evil.example/x/' }, HOSTS)).toThrow(
      /Địa chỉ nhận cập nhật/
    );
    expect(() => assertGuardedSettingsChange(current, { ytdlpPath: 'C:\\x\\calc.exe' }, HOSTS)).toThrow(
      /Đường dẫn yt-dlp/
    );
    expect(() => assertGuardedSettingsChange(current, { ffmpegPath: '\\\\s\\share\\ffmpeg.exe' }, HOSTS)).toThrow(
      /UNC/
    );
  });

  it('từ chối đường dẫn đúng tên nhưng tệp không tồn tại', () => {
    const missing = join(tmpdir(), 'tubmedia-khong-ton-tai', expectedToolFileName('ytdlpPath'));
    expect(() => assertGuardedSettingsChange(settingsWith({}), { ytdlpPath: missing }, HOSTS)).toThrow(
      /Không tìm thấy/
    );
  });

  it('chấp nhận tệp thật đúng tên và địa chỉ cập nhật cùng host', () => {
    const tool = makeTool(expectedToolFileName('ytdlpPath'));
    expect(() =>
      assertGuardedSettingsChange(
        settingsWith({}),
        { ytdlpPath: tool, appFeedUrl: 'https://github.com/a/b/releases/latest/download/' },
        HOSTS
      )
    ).not.toThrow();
  });

  it('cho phép xóa về tự động và không chặn giá trị cũ không đổi', () => {
    const stale = settingsWith({ ytdlpPath: 'C:\\da-luu\\yt-dlp.exe' });
    expect(() => assertGuardedSettingsChange(stale, { ytdlpPath: '' }, HOSTS)).not.toThrow();
    // Trang Cài đặt gửi lại toàn bộ giá trị; giá trị chưa đổi không được làm hỏng việc lưu.
    expect(() => assertGuardedSettingsChange(stale, { ytdlpPath: 'C:\\da-luu\\yt-dlp.exe' }, HOSTS)).not.toThrow();
  });
});

describe('làm sạch cài đặt khi khôi phục backup', () => {
  it('bỏ trường sai schema, trường lạ và trường vi phạm chính sách', () => {
    const tool = makeTool(expectedToolFileName('ffprobePath'));
    const { value, dropped } = sanitizeRestoredAppSettings(
      {
        theme: 'dark',
        proxy: 'http://127.0.0.1:8080',
        appFeedUrl: 'https://evil.example/feed/',
        ytdlpPath: 'C:\\evil\\virus.exe',
        ffprobePath: tool,
        aria2cPath: join(tmpdir(), 'tubmedia-khong-ton-tai', 'aria2c.exe'),
        aria2Connections: 999,
        khongTonTai: true
      },
      HOSTS
    );
    expect(value).toEqual({ theme: 'dark', proxy: 'http://127.0.0.1:8080', ffprobePath: tool });
    expect(dropped.sort()).toEqual(['appFeedUrl', 'aria2Connections', 'aria2cPath', 'khongTonTai', 'ytdlpPath']);
  });

  it('coi dữ liệu không phải đối tượng là hỏng hoàn toàn', () => {
    expect(sanitizeRestoredAppSettings('rác', HOSTS)).toEqual({ value: {}, dropped: ['(toàn bộ)'] });
    expect(sanitizeRestoredAppSettings(null, HOSTS).value).toEqual({});
    expect(sanitizeRestoredAppSettings([1], HOSTS).value).toEqual({});
  });
});
