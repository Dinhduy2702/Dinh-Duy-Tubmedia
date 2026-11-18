import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { ToolUpdateService } from '../../src/main/updates/tool-update-service.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { SettingsService } from '../../src/main/settings/settings-service.js';

let tempRoot = '';
afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger;

describe('V16 — chỉ dùng bản FFmpeg phát hành ổn định chính thức, không dùng nhánh dựng thử nightly master', () => {
  it('ToolUpdateService chọn gói phát hành ổn định (ffmpeg-n8.1-latest-win64-gpl-8.1.zip / nX.Y), tuyệt đối không chọn ffmpeg-master-latest', async () => {
    const tools = {} as ToolManager;
    const settings = { get: () => ({ ...defaultAppSettings }) } as unknown as SettingsService;
    const service = new ToolUpdateService(tools, settings, tmpdir(), silentLogger, {} as ProcessManager);
    const internals = service as unknown as {
      githubLatest: (repo: string) => Promise<unknown>;
      sourceForViaApi: (pkg: string) => Promise<{ asset: { name: string } }>;
      directFallbackSource: (pkg: string) => { asset: { name: string; browser_download_url: string } } | null;
    };

    internals.githubLatest = () =>
      Promise.resolve({
        id: 1,
        tag_name: 'latest',
        name: 'Latest Builds',
        published_at: '2026-11-18T00:00:00Z',
        assets: [
          { name: 'ffmpeg-master-latest-win64-gpl.zip', browser_download_url: 'https://x/master.zip', size: 10 },
          { name: 'ffmpeg-n8.1-latest-win64-gpl-8.1.zip', browser_download_url: 'https://x/n81.zip', size: 10 },
          { name: 'ffmpeg-n9.0-latest-win64-gpl-9.0.zip', browser_download_url: 'https://x/n90.zip', size: 10 }
        ]
      });

    const chosen = await internals.sourceForViaApi('ffmpeg-suite');
    expect(chosen.asset.name).toBe('ffmpeg-n8.1-latest-win64-gpl-8.1.zip');

    // Nếu tương lai nhánh 8.1 rút khỏi release và chỉ còn nhánh ổn định mới hơn (vd n9.2) kèm master, vẫn chọn nhánh ổn định chứ không rơi về master
    internals.githubLatest = () =>
      Promise.resolve({
        id: 2,
        tag_name: 'latest',
        name: 'Future Builds',
        published_at: '2027-06-01T00:00:00Z',
        assets: [
          { name: 'ffmpeg-master-latest-win64-gpl.zip', browser_download_url: 'https://x/master.zip', size: 10 },
          { name: 'ffmpeg-n9.0-latest-win64-gpl-9.0.zip', browser_download_url: 'https://x/n90.zip', size: 10 },
          { name: 'ffmpeg-n9.2-latest-win64-gpl-9.2.zip', browser_download_url: 'https://x/n92.zip', size: 10 }
        ]
      });
    const futureChosen = await internals.sourceForViaApi('ffmpeg-suite');
    expect(futureChosen.asset.name).toBe('ffmpeg-n9.2-latest-win64-gpl-9.2.zip');

    const fallback = internals.directFallbackSource('ffmpeg-suite');
    expect(fallback?.asset.name).toBe('ffmpeg-n8.1-latest-win64-gpl-8.1.zip');
    expect(fallback?.asset.browser_download_url).toContain('ffmpeg-n8.1-latest-win64-gpl-8.1.zip');
    expect(fallback?.asset.browser_download_url).not.toContain('ffmpeg-master-latest');
  });

  it('scripts/tools-windows.ps1 tải gói ổn định n8.1 và từ chối dùng lại bản nightly N-* khi đóng gói', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/tools-windows.ps1'), 'utf8');
    expect(script).toContain('ffmpeg-n8.1-latest-win64-gpl-8.1.zip');
    expect(script).not.toContain('ffmpeg-master-latest-win64-gpl.zip');
    expect(script).toContain('version\\s+N-');
  });

  it('người dùng nâng cấp từ 1.7.5/1.7.6 còn giữ bản nightly ffmpeg-master trong userData\\tools\\current sẽ tự ưu tiên bản ổn định đi kèm 1.7.7', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tubmedia-v16-upgrade-'));
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const managedDir = join(tempRoot, 'userData', 'tools', 'current');
    const bundledDir = join(tempRoot, 'resources', 'tool');
    mkdirSync(managedDir, { recursive: true });
    mkdirSync(bundledDir, { recursive: true });

    const managedExe = join(managedDir, exeName);
    const bundledExe = join(bundledDir, exeName);
    writeFileSync(managedExe, 'old-nightly');
    writeFileSync(bundledExe, 'new-stable-bundled');
    writeFileSync(
      join(managedDir, '.vdmsp-tool-metadata.json'),
      JSON.stringify({
        packages: {
          'ffmpeg-suite': {
            releaseId: 100,
            version: 'Latest Auto-Build',
            installedAt: '2026-11-05T00:00:00Z',
            sourceUrl: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
          }
        }
      })
    );

    const processes = {
      run: (opts: { executablePath: string }) =>
        Promise.resolve({
          code: 0,
          stdoutTail:
            opts.executablePath === bundledExe
              ? 'ffmpeg version n8.1.3 Copyright\n'
              : 'ffmpeg version N-128433-gdb8537d8cc-20261105 Copyright\n',
          stderrTail: ''
        })
    } as unknown as ProcessManager;

    const manager = new ToolManager(
      processes,
      silentLogger,
      () => ({ ...defaultAppSettings }),
      join(tempRoot, 'resources'),
      join(tempRoot, 'userData'),
      join(tempRoot, 'app', 'resources', 'app.asar'),
      true
    );
    (manager as unknown as { toolCapabilities: () => Promise<{ capabilities: string[]; gpuEncoderIssue: null }> }).toolCapabilities =
      () => Promise.resolve({ capabilities: ['libx264', 'aac'], gpuEncoderIssue: null });

    await manager.healthCheck('ffmpeg');
    expect(manager.get('ffmpeg').executablePath).toBe(bundledExe);
    expect(manager.get('ffmpeg').source).toBe('bundled');
  });
});
