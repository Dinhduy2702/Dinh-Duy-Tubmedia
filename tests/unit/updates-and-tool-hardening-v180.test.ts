import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { ToolUpdateService } from '../../src/main/updates/tool-update-service.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { SettingsService } from '../../src/main/settings/settings-service.js';

const tempRoots: string[] = [];
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createHarness(options: { isToolActive?: (name: string) => boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'tubmedia-tool-hardening-'));
  tempRoots.push(folder);
  const current = join(folder, 'userData', 'tools', 'current');
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, 'yt-dlp.exe'), 'old-yt-dlp');
  const downloaded = join(folder, 'downloaded');
  mkdirSync(downloaded, { recursive: true });
  writeFileSync(join(downloaded, 'yt-dlp.exe'), 'new-yt-dlp');

  const processes = {
    isToolActive: options.isToolActive ?? (() => false),
    run: () => Promise.resolve({ code: 0, stdoutTail: '2026.11.25\n', stderrTail: '' })
  } as unknown as ProcessManager;

  const tools = new ToolManager(
    processes,
    silentLogger,
    () => ({ ...defaultAppSettings }),
    join(folder, 'resources'),
    join(folder, 'userData'),
    join(folder, 'install', 'resources', 'app.asar'),
    true
  );

  const service = new ToolUpdateService(
    tools,
    { get: () => ({ ...defaultAppSettings }) } as unknown as SettingsService,
    join(folder, 'userData', 'tools'),
    silentLogger,
    processes
  );

  const internals = service as unknown as Record<string, unknown>;
  internals.sourceFor = () =>
    Promise.resolve({
      packageName: 'yt-dlp',
      release: { id: 9999, tag_name: '2026.11.25', name: '2026.11.25', published_at: null, assets: [] },
      asset: { name: 'yt-dlp.exe', browser_download_url: 'https://example.invalid/yt-dlp.exe', size: 10 },
      version: '2026.11.25',
      archive: 'none',
      executableNames: ['yt-dlp.exe']
    });
  internals.ensureAssetDigest = () => Promise.resolve();
  internals.download = (_asset: unknown, path: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'new-yt-dlp');
    return Promise.resolve();
  };
  internals.verifyDigest = () => Promise.resolve();
  internals.findFile = () => Promise.resolve(join(downloaded, 'yt-dlp.exe'));

  return { folder, current, service };
}

describe('#29–#40: UpdatesPage, ToolUpdateService và tools-windows.ps1', () => {
  it('UpdatesPage xóa cache localStorage khi lastKnownRelease <= currentVersion và không dùng bản cũ làm latestInfo', () => {
    const src = readFileSync(join(process.cwd(), 'src/renderer/src/pages/UpdatesPage.tsx'), 'utf8');
    expect(src).toContain('removeItem(LAST_KNOWN_RELEASE_KEY)');
    expect(src).toMatch(/compareAppVersions\(lastKnownRelease\.version,\s*current\)/);
    expect(src).toMatch(/relation\s*!==\s*null\s*&&\s*relation\s*<=\s*0/);
  });

  it('ToolUpdateService khóa không cho cập nhật yt-dlp khi yt-dlp đang chạy (kể cả khi bắt đầu chạy giữa lúc tải)', async () => {
    let active = false;
    const { service } = createHarness({ isToolActive: (name) => name === 'yt-dlp' && active });
    const internals = service as unknown as {
      download: (_asset: unknown, path: string) => Promise<void>;
    };
    const origDownload = internals.download;
    internals.download = async (asset, path) => {
      active = true; // yt-dlp bắt đầu chạy trong lúc đang tải bản mới
      return origDownload(asset, path);
    };

    await expect(service.update('yt-dlp')).rejects.toThrow(/đang được sử dụng/i);
  });

  it('ToolUpdateService dọn tệp .new thừa và tỉa .backups giữ tối đa 2 bản gần nhất cho mỗi gói', async () => {
    const { current, service } = createHarness();
    writeFileSync(join(current, 'yt-dlp.exe.new'), 'stale-new');
    writeFileSync(join(current, 'yt-dlp.exe.new-deadbeef'), 'stale-new-uuid');

    const backupRoot = join(current, '.backups');
    for (const ts of ['1000', '2000', '3000']) {
      mkdirSync(join(backupRoot, `yt-dlp-${ts}`), { recursive: true });
      writeFileSync(join(backupRoot, `yt-dlp-${ts}`, 'yt-dlp.exe'), `old-${ts}`);
    }
    mkdirSync(join(backupRoot, 'ffmpeg-suite-1000'), { recursive: true });

    await service.update('yt-dlp');

    expect(existsSync(join(current, 'yt-dlp.exe.new'))).toBe(false);
    expect(existsSync(join(current, 'yt-dlp.exe.new-deadbeef'))).toBe(false);

    const remainingYtBackups = readdirSync(backupRoot)
      .filter((name) => name.startsWith('yt-dlp-'))
      .sort();
    expect(remainingYtBackups).toHaveLength(2);
    expect(remainingYtBackups).not.toContain('yt-dlp-1000');
    expect(remainingYtBackups).not.toContain('yt-dlp-2000');
    expect(existsSync(join(backupRoot, 'ffmpeg-suite-1000'))).toBe(true);
  });

  it('ToolUpdateService HTML fallback gắn id hợp lệ để githubLatest() không từ chối khi API bị 403/429', async () => {
    const { service } = createHarness();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith('https://api.github.com/')) {
          return Promise.resolve(new Response('rate limited', { status: 403, headers: { 'retry-after': '60' } }));
        }
        if (url === 'https://github.com/yt-dlp/yt-dlp/releases/latest') {
          return Promise.resolve({
            ok: true,
            url: 'https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.25'
          } as unknown as Response);
        }
        if (url.includes('/releases/expanded_assets/2026.11.25')) {
          return Promise.resolve(
            new Response('<a href="/yt-dlp/yt-dlp/releases/download/2026.11.25/yt-dlp.exe">yt-dlp.exe</a>', {
              status: 200
            })
          );
        }
        return Promise.resolve(new Response('', { status: 404 }));
      })
    );

    const githubLatest = (
      service as unknown as { githubLatest: (repo: string) => Promise<{ id: number; tag_name: string }> }
    ).githubLatest.bind(service);

    const release = await githubLatest('yt-dlp/yt-dlp');
    expect(release.tag_name).toBe('2026.11.25');
    expect(typeof release.id).toBe('number');
    expect(release.id).toBeGreaterThan(0);
  });

  it('scripts/tools-windows.ps1 ở -Mode update không bỏ qua bằng Import-ExistingTool / Import-ExistingFfmpegSuite', () => {
    const ps1 = readFileSync(join(process.cwd(), 'scripts/tools-windows.ps1'), 'utf8');
    const ytBlock = ps1.slice(ps1.indexOf('function Update-YtDlp'), ps1.indexOf('function Update-FfmpegSuite'));
    const ffBlock = ps1.slice(ps1.indexOf('function Update-FfmpegSuite'), ps1.indexOf('function Update-Aria2'));
    const ariaBlock = ps1.slice(ps1.indexOf('function Update-Aria2'), ps1.indexOf('function Run-Main'));

    expect(ytBlock).toMatch(/\$Mode\s*-ne\s*'update'/);
    expect(ffBlock).toMatch(/\$Mode\s*-ne\s*'update'/);
    expect(ariaBlock).toMatch(/\$Mode\s*-ne\s*'update'/);
  });
});
