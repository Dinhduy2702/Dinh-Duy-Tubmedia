import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareYtDlpVersions, ToolManager, verifiedCapabilities } from '../../src/main/tools/tool-manager.js';
import { ytDlpJsRuntimeArguments } from '../../src/main/downloader/ytdlp-js-runtime.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('v1.8.1 — fix triệt để yt-dlp-ejs: ưu tiên bản bundled mới hơn managed cũ + bật --remote-components ejs:github', () => {
  it('compareYtDlpVersions so sánh đúng phiên bản YYYY.MM.DD[.patch]', () => {
    expect(compareYtDlpVersions('2026.11.23', '2026.08.19')).toBeGreaterThan(0);
    expect(compareYtDlpVersions('2026.11.23.1', '2026.11.23')).toBeGreaterThan(0);
    expect(compareYtDlpVersions('2026.08.19', '2026.11.23')).toBeLessThan(0);
    expect(compareYtDlpVersions('2026.11.23', '2026.11.23')).toBe(0);
  });

  it('verifiedCapabilities nhận diện --remote-components cho yt-dlp và ytDlpJsRuntimeArguments bật --remote-components ejs:github', () => {
    const caps = verifiedCapabilities('yt-dlp', '--dump-json --js-runtimes --remote-components');
    expect(caps).toContain('ytdlp_js_runtimes');
    expect(caps).toContain('ytdlp_remote_components');

    const args = ytDlpJsRuntimeArguments({ version: '2026.11.23', capabilities: caps }, 'C:\\tool\\deno.exe');
    expect(args).toEqual(['--js-runtimes', 'deno:C:\\tool\\deno.exe', '--remote-components', 'ejs:github']);
  });

  it('ToolManager chọn bản yt-dlp đi kèm bộ cài (bundled) khi nó MỚI HƠN bản tự cập nhật cũ (managed) trong Roaming', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tubmedia-ytdlp-newer-'));
    tempDirs.push(root);
    const managedDir = join(root, 'userData', 'tools', 'current');
    const bundledDir = join(root, 'resources', 'tool');
    mkdirSync(managedDir, { recursive: true });
    mkdirSync(bundledDir, { recursive: true });
    const managedExe = join(managedDir, 'yt-dlp.exe');
    const bundledExe = join(bundledDir, 'yt-dlp.exe');
    writeFileSync(managedExe, 'old-managed');
    writeFileSync(bundledExe, 'new-bundled');

    const processes = {
      run: vi.fn((opts: { executablePath: string; args: string[] }) => {
        if (opts.args.includes('-h')) {
          return Promise.resolve({ code: 0, stdoutTail: '--dump-json --js-runtimes --remote-components', stderrTail: '' });
        }
        const version = opts.executablePath === bundledExe ? '2026.11.23' : '2026.08.19';
        return Promise.resolve({ code: 0, stdoutTail: `${version}\n`, stderrTail: '' });
      })
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const manager = new ToolManager(
      processes as never,
      logger as never,
      () => defaultAppSettings,
      join(root, 'resources'),
      join(root, 'userData'),
      join(root, 'app'),
      true
    );

    const statuses = await manager.healthCheck('yt-dlp');
    const ytdlp = statuses.find((item) => item.name === 'yt-dlp');
    expect(ytdlp?.available).toBe(true);
    expect(ytdlp?.source).toBe('bundled');
    expect(ytdlp?.executablePath).toBe(bundledExe);
    expect(ytdlp?.version).toBe('2026.11.23');
  });

  it('ToolManager vẫn giữ bản managed nếu bản managed mới hơn hoặc bằng bản bundled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tubmedia-ytdlp-managed-newer-'));
    tempDirs.push(root);
    const managedDir = join(root, 'userData', 'tools', 'current');
    const bundledDir = join(root, 'resources', 'tool');
    mkdirSync(managedDir, { recursive: true });
    mkdirSync(bundledDir, { recursive: true });
    const managedExe = join(managedDir, 'yt-dlp.exe');
    const bundledExe = join(bundledDir, 'yt-dlp.exe');
    writeFileSync(managedExe, 'new-managed');
    writeFileSync(bundledExe, 'old-bundled');

    const processes = {
      run: vi.fn((opts: { executablePath: string; args: string[] }) => {
        if (opts.args.includes('-h')) {
          return Promise.resolve({ code: 0, stdoutTail: '--dump-json --js-runtimes --remote-components', stderrTail: '' });
        }
        const version = opts.executablePath === managedExe ? '2026.12.01' : '2026.11.23';
        return Promise.resolve({ code: 0, stdoutTail: `${version}\n`, stderrTail: '' });
      })
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const manager = new ToolManager(
      processes as never,
      logger as never,
      () => defaultAppSettings,
      join(root, 'resources'),
      join(root, 'userData'),
      join(root, 'app'),
      true
    );

    const statuses = await manager.healthCheck('yt-dlp');
    const ytdlp = statuses.find((item) => item.name === 'yt-dlp');
    expect(ytdlp?.available).toBe(true);
    expect(ytdlp?.source).toBe('managed');
    expect(ytdlp?.executablePath).toBe(managedExe);
    expect(ytdlp?.version).toBe('2026.12.01');
  });
});
