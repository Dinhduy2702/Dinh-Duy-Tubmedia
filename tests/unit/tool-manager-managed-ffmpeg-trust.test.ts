import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager, type ToolName } from '../../src/main/tools/tool-manager.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';

/**
 * Vụ khách 2026-10-15 (job 03002b08): %APPDATA%\…\tools\current\ffmpeg.exe là bản gyan.dev 8.0 essentials được chép tay
 * vào ngày 25/07 (không có .vdmsp-tool-metadata.json — trình cập nhật chưa từng ghi nhận). Bộ mã hóa AAC của bản đó tạo
 * gói tiếng hỏng; cài đè 1.3.0 → 1.6.3 không đụng tới userData nên app vẫn ưu tiên nó hơn ffmpeg đi kèm bộ cài.
 * Bộ ffmpeg trong tools\current chỉ được ưu tiên hơn bản đi kèm bộ cài khi trình cập nhật của app đã cài nó (có mục
 * "ffmpeg-suite" trong metadata). yt-dlp/aria2c giữ nguyên thứ tự.
 */

let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

function makeFile(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, 'x');
  return path;
}

function writeMetadata(packages: Record<string, unknown>): void {
  const current = join(folder, 'userData', 'tools', 'current');
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, '.vdmsp-tool-metadata.json'), JSON.stringify({ packages }, null, 2));
}

function createManager(attempted: string[]): ToolManager {
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
    join(folder, 'cai-dat', 'resources', 'app.asar'),
    true
  );
}

function setup(tool: ToolName): { managed: string; bundled: string } {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-toolmgr-trust-'));
  return {
    managed: makeFile(join(folder, 'userData', 'tools', 'current'), exe(tool)),
    bundled: makeFile(join(folder, 'resources', 'tool'), exe(tool))
  };
}

async function attemptedFor(tool: ToolName): Promise<string[]> {
  const attempted: string[] = [];
  await createManager(attempted).healthCheck(tool);
  return attempted;
}

describe('ToolManager: bộ ffmpeg trong tools\\current không do trình cập nhật cài thì không được ưu tiên hơn bản đi kèm bộ cài', () => {
  it('ffmpeg trong tools\\current, KHÔNG có metadata (máy khách) → thử bản đi kèm bộ cài trước, bản kia chỉ để dự phòng', async () => {
    const { managed, bundled } = setup('ffmpeg');
    const attempted = await attemptedFor('ffmpeg');
    expect(attempted[0]).toBe(bundled);
    expect(attempted).toContain(managed);
    expect(attempted.indexOf(managed)).toBeGreaterThan(attempted.indexOf(bundled));
  });

  it('metadata chỉ có aria2c (không có ffmpeg-suite) → vẫn coi bộ ffmpeg là không do app cài', async () => {
    const { bundled } = setup('ffmpeg');
    writeMetadata({ aria2c: { version: 'aria2 1.37.0' } });
    expect((await attemptedFor('ffmpeg'))[0]).toBe(bundled);
  });

  it('ffprobe và ffplay cùng quy tắc với ffmpeg', async () => {
    const probe = setup('ffprobe');
    expect((await attemptedFor('ffprobe'))[0]).toBe(probe.bundled);
    rmSync(folder, { recursive: true, force: true });
    const play = setup('ffplay');
    expect((await attemptedFor('ffplay'))[0]).toBe(play.bundled);
  });

  it('metadata có ffmpeg-suite (trình cập nhật đã cài) → bản trong tools\\current vẫn được ưu tiên như trước', async () => {
    const { managed } = setup('ffmpeg');
    writeMetadata({ 'ffmpeg-suite': { version: 'Latest Auto-Build (2026-10-11 13:04)' } });
    expect((await attemptedFor('ffmpeg'))[0]).toBe(managed);
  });

  it('metadata hỏng (không đọc được JSON) → coi như không do app cài', async () => {
    const { bundled } = setup('ffmpeg');
    makeFile(join(folder, 'userData', 'tools', 'current'), '.vdmsp-tool-metadata.json');
    expect((await attemptedFor('ffmpeg'))[0]).toBe(bundled);
  });

  it('không có bản đi kèm bộ cài → vẫn dùng bản trong tools\\current (không làm mất công cụ)', async () => {
    const { managed, bundled } = setup('ffmpeg');
    rmSync(bundled);
    expect((await attemptedFor('ffmpeg'))[0]).toBe(managed);
  });

  it('yt-dlp và aria2c giữ nguyên thứ tự: bản trong tools\\current trước, dù không có metadata', async () => {
    const ytdlp = setup('yt-dlp');
    expect((await attemptedFor('yt-dlp'))[0]).toBe(ytdlp.managed);
    rmSync(folder, { recursive: true, force: true });
    const aria = setup('aria2c');
    expect((await attemptedFor('aria2c'))[0]).toBe(aria.managed);
  });
});
