import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { expectedToolFileName } from '../../src/main/security/settings-policy.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { AppSettings } from '../../src/shared/types/domain.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';

let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

async function attemptedPaths(patch: Partial<AppSettings>): Promise<string[]> {
  const attempted: string[] = [];
  const processes = {
    run: (options: { executablePath: string }) => {
      attempted.push(options.executablePath);
      return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: '' });
    }
  } as unknown as ProcessManager;
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;
  const manager = new ToolManager(
    processes,
    logger,
    () => ({ ...defaultAppSettings, ...patch }),
    join(folder, 'resources'),
    join(folder, 'userData'),
    join(folder, 'app'),
    true
  );
  await manager.healthCheck('yt-dlp');
  return attempted;
}

function makeFile(name: string, directory = folder): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, 'x');
  return path;
}

describe('ToolManager: đường dẫn công cụ do người dùng cấu hình', () => {
  it('ưu tiên tệp đúng tên yt-dlp.exe đã cấu hình', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-'));
    const tool = makeFile(expectedToolFileName('ytdlpPath'));
    const attempted = await attemptedPaths({ ytdlpPath: tool });
    expect(attempted[0]).toBe(tool);
  });

  it('không bao giờ chạy tệp sai tên, dù tệp đó tồn tại', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-'));
    const impostor = makeFile('virus.exe');
    const attempted = await attemptedPaths({ ytdlpPath: impostor });
    expect(attempted).not.toContain(impostor);
  });

  it('không chạy đường dẫn UNC hoặc đường dẫn tương đối', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-'));
    const attempted = await attemptedPaths({ ytdlpPath: '\\\\server\\share\\yt-dlp.exe' });
    expect(attempted.some((path) => path.startsWith('\\\\'))).toBe(false);
    const relative = await attemptedPaths({ ytdlpPath: 'tool\\yt-dlp.exe' });
    expect(relative).not.toContain('tool\\yt-dlp.exe');
  });

  it('bỏ qua đường dẫn cấu hình là thư mục', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-'));
    const directory = join(folder, expectedToolFileName('ytdlpPath'));
    mkdirSync(directory);
    const attempted = await attemptedPaths({ ytdlpPath: directory });
    expect(attempted).not.toContain(directory);
  });
});
