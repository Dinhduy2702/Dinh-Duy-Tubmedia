import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { ToolUpdateService } from '../../src/main/updates/tool-update-service.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { SettingsService } from '../../src/main/settings/settings-service.js';

/**
 * Hệ quả của việc chỉ tin bộ ffmpeg trong tools\current khi metadata có "ffmpeg-suite" (vụ khách 2026-10-15): trình cập
 * nhật trước đây chạy healthCheck TRƯỚC khi ghi metadata → ngay sau khi cài bản mới, app chọn bản đi kèm bộ cài và báo
 * "đã cập nhật" mà không dùng bản vừa cài. Metadata phải được ghi trước bước kiểm sau cập nhật, và khôi phục nếu rollback.
 */

let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;

function makeFile(directory: string, name: string, content = 'x'): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

interface Harness {
  tools: ToolManager;
  service: ToolUpdateService;
  current: string;
  metadataPath: string;
}

function setup(options: { failHealthCheckFor?: string } = {}): Harness {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolupdate-meta-'));
  const current = join(folder, 'userData', 'tools', 'current');
  // Máy khách: bộ ffmpeg chép tay, KHÔNG có metadata; bộ cài có ffmpeg riêng.
  for (const name of ['ffmpeg', 'ffprobe', 'ffplay']) {
    makeFile(current, exe(name), 'ban-8.0-chep-tay');
    makeFile(join(folder, 'resources', 'tool'), exe(name), 'ban-di-kem-bo-cai');
  }
  const downloaded = join(folder, 'tai-ve');
  for (const name of ['ffmpeg', 'ffprobe', 'ffplay']) makeFile(downloaded, exe(name), 'ban-moi-tu-trinh-cap-nhat');

  const processes = {
    isToolActive: () => false,
    run: (run: { jobId: string; executablePath: string; args: string[] }) => {
      // Hỏng ở bước kiểm SAU cập nhật (healthCheck), tức sau khi metadata đã được ghi.
      if (options.failHealthCheckFor && run.jobId.startsWith('health-' + options.failHealthCheckFor)) {
        return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: 'hong' });
      }
      const name = /(ffmpeg|ffprobe|ffplay)/.exec(run.executablePath)?.[1] ?? 'ffmpeg';
      return Promise.resolve({ code: 0, stdoutTail: `${name} version 9.9-test Copyright\n`, stderrTail: '' });
    }
  } as unknown as ProcessManager;
  const tools = new ToolManager(
    processes,
    silentLogger,
    () => ({ ...defaultAppSettings }),
    join(folder, 'resources'),
    join(folder, 'userData'),
    join(folder, 'cai-dat', 'resources', 'app.asar'),
    true
  );
  const service = new ToolUpdateService(tools, {} as SettingsService, join(folder, 'userData', 'tools'), silentLogger, processes);
  const internals = service as unknown as Record<string, unknown>;
  internals.sourceFor = () =>
    Promise.resolve({
      packageName: 'ffmpeg-suite',
      release: { id: 409684790, tag_name: 'latest', name: 'Latest Auto-Build (2026-10-11 13:04)', assets: [] },
      asset: { name: 'ffmpeg.package', browser_download_url: 'https://example.invalid/ffmpeg.zip', size: 1 },
      version: 'Latest Auto-Build (2026-10-11 13:04)',
      archive: 'none',
      executableNames: ['ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe']
    });
  internals.ensureAssetDigest = () => Promise.resolve();
  internals.download = (_asset: unknown, path: string) => {
    makeFile(join(path, '..'), path.split(/[\\/]/).pop()!, 'goi');
    return Promise.resolve();
  };
  internals.verifyDigest = () => Promise.resolve();
  internals.findFile = (_root: string, filename: string) => Promise.resolve(join(downloaded, filename));
  return { tools, service, current, metadataPath: join(current, '.vdmsp-tool-metadata.json') };
}

describe('Trình cập nhật bộ ffmpeg: ghi metadata trước khi kiểm, để app dùng ngay bản vừa cài', () => {
  it('cập nhật xong → app dùng ffmpeg trong tools\\current (bản vừa cài), metadata có ffmpeg-suite', async () => {
    const { tools, service, current, metadataPath } = setup();

    await service.update('ffmpeg');

    expect(readFileSync(join(current, exe('ffmpeg')), 'utf8')).toBe('ban-moi-tu-trinh-cap-nhat');
    expect(tools.get('ffmpeg').executablePath).toBe(join(current, exe('ffmpeg')));
    expect(tools.get('ffprobe').executablePath).toBe(join(current, exe('ffprobe')));
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as { packages: Record<string, { version: string }> };
    expect(metadata.packages['ffmpeg-suite']?.version).toBe('Latest Auto-Build (2026-10-11 13:04)');
  });

  it('cập nhật thất bại → khôi phục tệp cũ VÀ metadata cũ (không để bộ ffmpeg chép tay thành "đã được app cài")', async () => {
    const { tools, service, current, metadataPath } = setup({ failHealthCheckFor: 'ffprobe' });

    await expect(service.update('ffmpeg')).rejects.toThrow();

    expect(readFileSync(join(current, exe('ffmpeg')), 'utf8')).toBe('ban-8.0-chep-tay');
    expect(existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : '').not.toContain('ffmpeg-suite');
    expect(tools.get('ffmpeg').executablePath).toBe(join(folder, 'resources', 'tool', exe('ffmpeg')));
  });
});
