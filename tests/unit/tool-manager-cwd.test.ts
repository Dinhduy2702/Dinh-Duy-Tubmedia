import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';

// Đợt 4 mục 15 (rà soát bản cài 1.5.0): app tìm yt-dlp/aria2c/ffmpeg trong <thư mục đang đứng khi mở app>\tool trước cả
// công cụ đi kèm bộ cài. Thư mục đang đứng do cách mở app quyết định (lối tắt, dòng lệnh, mở từ thư mục tải về…) — ai đặt
// được tệp yt-dlp.exe vào đó là app chạy tệp đó. Công cụ chỉ được lấy từ nơi do chính ứng dụng/bộ cài/người dùng chỉ định.

let folder = '';

afterEach(() => {
  vi.restoreAllMocks();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function makeFile(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, 'x');
  return path;
}

async function attemptedPaths(packaged: boolean): Promise<string[]> {
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
    () => ({ ...defaultAppSettings }),
    join(folder, 'resources'),
    join(folder, 'userData'),
    join(folder, 'app'),
    packaged
  );
  await manager.healthCheck('yt-dlp');
  return attempted;
}

const executable = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

describe('ToolManager: không lấy công cụ từ thư mục đang đứng khi mở app', () => {
  it.each([true, false])('packaged=%s: không thử <cwd>\\tool, <cwd>\\tools; công cụ đi kèm được thử trước', async (packaged) => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-cwd-'));
    const cwd = join(folder, 'thu-muc-dang-dung');
    const planted = makeFile(join(cwd, 'tool'), executable);
    const plantedPlural = makeFile(join(cwd, 'tools'), executable);
    const bundled = makeFile(join(folder, 'resources', 'tool'), executable);
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    const attempted = await attemptedPaths(packaged);
    expect(attempted).not.toContain(planted);
    expect(attempted).not.toContain(plantedPlural);
    expect(attempted[0]).toBe(bundled);
  });

  it('thư mục tool của chính ứng dụng (bản chạy từ mã nguồn) vẫn được dùng', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-cwd-'));
    const own = makeFile(join(folder, 'app', 'tool'), executable);
    vi.spyOn(process, 'cwd').mockReturnValue(join(folder, 'noi-khac'));
    expect((await attemptedPaths(false))[0]).toBe(own);
  });

  it('mã nguồn tiến trình chính không còn dựng đường dẫn công cụ từ process.cwd()', () => {
    expect(readFileSync('src/main/tools/tool-manager.ts', 'utf8')).not.toMatch(/join\(process\.cwd\(\)/);
  });
});
