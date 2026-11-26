import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundledDenoPath,
  registerBundledDenoFolders,
  ytDlpJsRuntimeArguments,
  ytDlpJsRuntimeStartupMessage,
  ytDlpSupportsJsRuntimes
} from '../../src/main/downloader/ytdlp-js-runtime.js';
import { verifiedCapabilities } from '../../src/main/tools/tool-manager.js';
import { buildPreviewFrameDownloadArguments } from '../../src/main/download/preview-frame-command.js';
import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';

const modern = { version: '2026.10.26', capabilities: ['ytdlp_download'] };
const old = { version: '2025.09.26', capabilities: ['ytdlp_download'] };

describe('1.8.0 việc A: bộ chạy JavaScript Deno kèm sẵn cho yt-dlp', () => {
  const folders: string[] = [];
  afterEach(() => {
    registerBundledDenoFolders([]);
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function folderWithDeno(): string {
    const folder = mkdtempSync(join(tmpdir(), 'tubmedia-deno-'));
    folders.push(folder);
    writeFileSync(join(folder, 'deno.exe'), '');
    return folder;
  }

  it('có deno.exe kèm sẵn → --js-runtimes deno:<đường dẫn đầy đủ>; chỗ đầu tiên có tệp được ưu tiên', () => {
    const empty = mkdtempSync(join(tmpdir(), 'tubmedia-nodeno-'));
    folders.push(empty);
    const withDeno = folderWithDeno();
    registerBundledDenoFolders([empty, withDeno]);
    expect(bundledDenoPath()).toBe(join(withDeno, 'deno.exe'));
    expect(ytDlpJsRuntimeArguments(modern)).toEqual([
      '--js-runtimes',
      `deno:${join(withDeno, 'deno.exe')}`,
      '--remote-components',
      'ejs:github'
    ]);
  });

  it('không có tệp → không thêm tham số nào (yt-dlp tự dùng deno trong PATH nếu máy có)', () => {
    registerBundledDenoFolders([join(tmpdir(), 'khong-ton-tai-tubmedia')]);
    expect(bundledDenoPath()).toBeNull();
    expect(ytDlpJsRuntimeArguments(modern)).toEqual([]);
  });

  it('yt-dlp cũ chưa có --js-runtimes → không thêm tham số (tránh lỗi "no such option" làm hỏng mọi lượt tải)', () => {
    expect(ytDlpSupportsJsRuntimes(old)).toBe(false);
    expect(ytDlpJsRuntimeArguments(old, 'C:\\tool\\deno.exe')).toEqual([]);
    expect(ytDlpSupportsJsRuntimes({ version: '2025.11.12', capabilities: [] })).toBe(true);
    expect(ytDlpSupportsJsRuntimes({ version: null, capabilities: ['ytdlp_js_runtimes'] })).toBe(true);
    expect(ytDlpSupportsJsRuntimes({ version: null, capabilities: [] })).toBe(false);
    expect(verifiedCapabilities('yt-dlp', '  --js-runtimes RUNTIME[:PATH]')).toContain('ytdlp_js_runtimes');
  });

  it('đường dẫn có dấu cách/Unicode vẫn là MỘT đối số', () => {
    const path = 'C:\\Program Files\\Tubmedia Việt\\resources\\tool\\deno.exe';
    expect(ytDlpJsRuntimeArguments(modern, path)).toEqual([
      '--js-runtimes',
      `deno:${path}`,
      '--remote-components',
      'ejs:github'
    ]);
  });

  it('Tải nhanh và khung xem trước truyền tham số trước dấu "--"', () => {
    const js = ytDlpJsRuntimeArguments(modern, 'C:\\tool\\deno.exe');
    const preview = buildPreviewFrameDownloadArguments(
      'https://example.invalid/x',
      0,
      { ffmpegDirectory: 'C:\\tool', workDirectory: 'C:\\temp\\preview' },
      undefined,
      js
    );
    expect(preview.slice(-(js.length + 2))).toEqual([...js, '--', 'https://example.invalid/x']);

    const request = validateQuickDownloadRequest({
      url: 'https://example.com/video',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'full',
      accurateCut: false
    });
    const quick = buildQuickDownloadArguments(
      request,
      { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\quick', runToken: 'tok' },
      undefined,
      { jsRuntimeArgs: js }
    );
    const separator = quick.lastIndexOf('--');
    expect(quick.indexOf('--js-runtimes')).toBeGreaterThan(-1);
    expect(quick.indexOf('--js-runtimes')).toBeLessThan(separator);
    expect(quick[quick.indexOf('--js-runtimes') + 1]).toBe('deno:C:\\tool\\deno.exe');
    expect(buildQuickDownloadArguments(request, { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\T', runToken: 't' })).not.toContain('--js-runtimes');
  });

  it('câu nhật ký khởi động nói rõ có/không bộ chạy JS và phiên bản yt-dlp', () => {
    expect(ytDlpJsRuntimeStartupMessage('2026.10.26', 'C:\\tool\\deno.exe')).toContain('yt-dlp 2026.10.26; có bộ chạy JavaScript Deno');
    expect(ytDlpJsRuntimeStartupMessage('2026.10.26', null)).toContain('KHÔNG có bộ chạy JavaScript');
  });
});
