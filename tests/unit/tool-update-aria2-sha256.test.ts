import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolUpdateService } from '../../src/main/updates/tool-update-service.js';
import type { ToolManager, ToolName } from '../../src/main/tools/tool-manager.js';
import type { SettingsService } from '../../src/main/settings/settings-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { ToolStatus } from '../../src/shared/types/domain.js';

let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger;

function makeStatus(name: ToolName, version: string | null, available = true): ToolStatus {
  return {
    name,
    available,
    executablePath: available ? `C:\\tools\\${name}.exe` : null,
    version,
    source: available ? 'bundled' : null,
    health: available ? 'healthy' : 'broken',
    capabilities: [],
    error: null,
    lastCheckedAt: null
  };
}

function createService(statuses: ToolStatus[]): ToolUpdateService {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-aria2-sha-'));
  const tools = {
    healthCheck: () => Promise.resolve(statuses),
    ensureWritableToolFolder: () => Promise.resolve(folder),
    list: () => statuses
  } as unknown as ToolManager;
  const processes = { isToolActive: () => false } as unknown as ProcessManager;
  return new ToolUpdateService(tools, {} as SettingsService, folder, silentLogger, processes);
}

describe('ToolUpdateService — ghim SHA-256 cho aria2 1.37.0 và không báo bản mới giả (#1)', () => {
  it('tự ghim SHA-256 chuẩn cho aria2-1.37.0-win-64bit-build1.zip khi digest === null', async () => {
    const service = createService([makeStatus('aria2c', '1.37.0')]);
    const source = {
      packageName: 'aria2c',
      release: { id: 123, tag_name: 'release-1.37.0', name: 'aria2 1.37.0', published_at: null, assets: [] },
      asset: {
        name: 'aria2-1.37.0-win-64bit-build1.zip',
        browser_download_url:
          'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
        size: 2_000_000,
        digest: null
      },
      version: 'aria2 1.37.0',
      archive: 'zip',
      executableNames: ['aria2c.exe']
    };

    const ensureAssetDigest = (
      service as unknown as { ensureAssetDigest: (s: typeof source) => Promise<void> }
    ).ensureAssetDigest.bind(service);

    await ensureAssetDigest(source);

    expect(source.asset.digest).toBe(
      'sha256:67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288'
    );
  });

  it('vẫn từ chối gói aria2 lạ không có digest để bảo vệ chuỗi cung ứng', async () => {
    const service = createService([makeStatus('aria2c', '1.37.0')]);
    const source = {
      packageName: 'aria2c',
      release: { id: 999, tag_name: 'release-1.99.0', name: 'aria2 1.99.0', published_at: null, assets: [] },
      asset: {
        name: 'aria2-1.99.0-win-64bit-build1.zip',
        browser_download_url:
          'https://github.com/aria2/aria2/releases/download/release-1.99.0/aria2-1.99.0-win-64bit-build1.zip',
        size: 2_000_000,
        digest: null
      },
      version: 'aria2 1.99.0',
      archive: 'zip',
      executableNames: ['aria2c.exe']
    };

    const ensureAssetDigest = (
      service as unknown as { ensureAssetDigest: (s: typeof source) => Promise<void> }
    ).ensureAssetDigest.bind(service);

    await expect(ensureAssetDigest(source)).rejects.toThrow(/SHA-256/);
  });

  it('check() trả available=false khi aria2c bundled đã là 1.37.0 khớp bản mới nhất (dù chưa có metadata)', async () => {
    const service = createService([
      makeStatus('yt-dlp', '2026.01.01'),
      makeStatus('ffmpeg', '8.1'),
      makeStatus('ffprobe', '8.1'),
      makeStatus('ffplay', '8.1'),
      makeStatus('aria2c', '1.37.0')
    ]);
    const internals = service as unknown as Record<string, unknown>;
    internals.sourceFor = (pkg: string) =>
      Promise.resolve({
        packageName: pkg,
        release: {
          id: pkg === 'aria2c' ? 13700 : 1,
          tag_name: pkg === 'aria2c' ? 'release-1.37.0' : 'latest',
          name: pkg === 'aria2c' ? 'aria2 1.37.0' : 'latest',
          published_at: null,
          assets: []
        },
        asset: { name: `${pkg}.zip`, browser_download_url: `https://example.invalid/${pkg}`, size: 1 },
        version: pkg === 'aria2c' ? 'aria2 1.37.0' : 'latest',
        archive: 'zip',
        executableNames: []
      });

    const checks = await service.check();
    const aria2Check = checks.find((item) => item.name === 'aria2c');

    expect(aria2Check?.available).toBe(false);
    expect(aria2Check?.currentVersion).toBe('1.37.0');
  });

  it('check() vẫn trả available=true khi aria2c cũ hơn bản remote 1.37.0', async () => {
    const service = createService([
      makeStatus('yt-dlp', '2026.01.01'),
      makeStatus('ffmpeg', '8.1'),
      makeStatus('ffprobe', '8.1'),
      makeStatus('ffplay', '8.1'),
      makeStatus('aria2c', '1.36.0')
    ]);
    const internals = service as unknown as Record<string, unknown>;
    internals.sourceFor = (pkg: string) =>
      Promise.resolve({
        packageName: pkg,
        release: {
          id: pkg === 'aria2c' ? 13700 : 1,
          tag_name: pkg === 'aria2c' ? 'release-1.37.0' : 'latest',
          name: pkg === 'aria2c' ? 'aria2 1.37.0' : 'latest',
          published_at: null,
          assets: []
        },
        asset: { name: `${pkg}.zip`, browser_download_url: `https://example.invalid/${pkg}`, size: 1 },
        version: pkg === 'aria2c' ? 'aria2 1.37.0' : 'latest',
        archive: 'zip',
        executableNames: []
      });

    const checks = await service.check();
    const aria2Check = checks.find((item) => item.name === 'aria2c');

    expect(aria2Check?.available).toBe(true);
  });
});
