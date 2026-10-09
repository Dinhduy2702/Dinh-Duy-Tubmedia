import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';

// Phát hiện phụ Đợt 5 (2026-10-09), hệ quả của mục 15 (c743bcd): mở app từ mã nguồn bằng tệp main đã build
// (electron out/main/index.js — e2e, CI) thì app.getAppPath() là out\main, nên app không thấy thư mục tool\ của dự án và
// tự tải yt-dlp từ mạng vào out\main\tool sau mỗi lần build. Bản chạy từ mã nguồn phải dùng tool\ ở gốc dự án (thư mục gần
// nhất có package.json, tính từ appPath — không phụ thuộc thư mục đang đứng). Bản đóng gói giữ nguyên.

let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function makeFile(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, 'x');
  return path;
}

const executable = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

function createManager(appPath: string, packaged: boolean, attempted: string[]): ToolManager {
  const processes = {
    run: (options: { executablePath: string }) => {
      attempted.push(options.executablePath);
      return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: '' });
    }
  } as unknown as ProcessManager;
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;
  return new ToolManager(
    processes,
    logger,
    () => ({ ...defaultAppSettings }),
    join(folder, 'resources'),
    join(folder, 'userData'),
    appPath,
    packaged
  );
}

describe('ToolManager: bản chạy từ mã nguồn dùng thư mục tool\\ ở gốc dự án', () => {
  it('mở bằng out/main/index.js: thử <gốc dự án>\\tool trước, không thử out\\main\\tool; cập nhật ghi vào <gốc dự án>\\tool', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-root-'));
    const projectRoot = join(folder, 'du-an');
    makeFile(projectRoot, 'package.json');
    const projectTool = makeFile(join(projectRoot, 'tool'), executable);
    const staleDownload = makeFile(join(projectRoot, 'out', 'main', 'tool'), executable);
    const attempted: string[] = [];
    const manager = createManager(join(projectRoot, 'out', 'main'), false, attempted);

    await manager.healthCheck('yt-dlp');
    expect(attempted[0]).toBe(projectTool);
    expect(attempted).not.toContain(staleDownload);
    expect(manager.writableToolFolder()).toBe(join(projectRoot, 'tool'));
  });

  it('mở bằng "electron ." (appPath đã là gốc dự án): như trước', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-root-'));
    const projectRoot = join(folder, 'du-an');
    makeFile(projectRoot, 'package.json');
    const projectTool = makeFile(join(projectRoot, 'tool'), executable);
    const attempted: string[] = [];
    const manager = createManager(projectRoot, false, attempted);

    await manager.healthCheck('yt-dlp');
    expect(attempted[0]).toBe(projectTool);
    expect(manager.writableToolFolder()).toBe(join(projectRoot, 'tool'));
  });

  it('bản đóng gói: không đi lên thư mục cha của appPath để tìm tool\\', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-root-'));
    const install = join(folder, 'cai-dat');
    makeFile(install, 'package.json');
    const parentTool = makeFile(join(install, 'tool'), executable);
    const attempted: string[] = [];
    const manager = createManager(join(install, 'resources', 'app.asar'), true, attempted);

    await manager.healthCheck('yt-dlp');
    expect(attempted).not.toContain(parentTool);
    expect(manager.writableToolFolder()).toBe(join(folder, 'userData', 'tools', 'current'));
  });
});
