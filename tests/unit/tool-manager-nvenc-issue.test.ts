import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { expectedToolFileName } from '../../src/main/security/settings-policy.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';

// #4 (khám phá bản cài 2026-10-05): bước kiểm tra NVENC phải GIỮ LẠI lý do thất bại (trước đây chỉ còn cờ
// "h264_nvenc_unavailable"), và ghi nhật ký mức Cảnh báo với mã thoát có dấu (-40, không phải 4294967256).
const REAL_STDERR =
  '[h264_nvenc @ 000002406ecb3d80] Driver does not support the required nvenc API version. Required: 13.1 Found: 12.2\n' +
  '[h264_nvenc @ 000002406ecb3d80] The minimum required Nvidia driver for nvenc is 610.00 or newer';

let folder = '';
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

describe('#4 — ToolManager giữ lý do NVENC không dùng được', () => {
  it('driver quá cũ → gpuEncoderIssue có lý do, vẫn đánh dấu _unavailable, nhật ký Cảnh báo với mã -40', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-nvenc-'));
    mkdirSync(folder, { recursive: true });
    const ffmpegPath = join(folder, expectedToolFileName('ffmpegPath'));
    writeFileSync(ffmpegPath, 'x');

    const processes = {
      run: vi.fn((options: { args: string[]; jobId: string }) => {
        if (options.args.includes('-version')) {
          return Promise.resolve({ code: 0, stdoutTail: 'ffmpeg version N-126856-ged27b2c498-20260925 Copyright', stderrTail: '' });
        }
        if (options.args.includes('-encoders')) {
          return Promise.resolve({ code: 0, stdoutTail: ' V..... libx264\n V..... h264_nvenc\n V..... hevc_nvenc\n A..... aac', stderrTail: '' });
        }
        if (options.jobId.endsWith('-encode')) {
          return Promise.resolve({ code: 4294967256, stdoutTail: '', stderrTail: REAL_STDERR.replaceAll('h264_nvenc', options.args[options.args.indexOf('-c:v') + 1]!) });
        }
        return Promise.resolve({ code: 0, stdoutTail: 'concat mp4 zscale tonemap', stderrTail: '' });
      })
    } as unknown as ProcessManager;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const manager = new ToolManager(
      processes,
      logger as unknown as Logger,
      () => ({ ...defaultAppSettings, ffmpegPath }),
      join(folder, 'resources'),
      join(folder, 'userData'),
      join(folder, 'app'),
      true
    );

    const status = (await manager.healthCheck('ffmpeg')).find((tool) => tool.name === 'ffmpeg');

    expect(status?.available).toBe(true);
    expect(status?.capabilities).toEqual(expect.arrayContaining(['h264_nvenc_unavailable', 'hevc_nvenc_unavailable', 'cpu_auto']));
    expect(status?.gpuEncoderIssue).toEqual(
      expect.objectContaining({ kind: 'driver-too-old', requiredApi: '13.1', foundApi: '12.2', minimumDriver: '610.00', exitCode: -40 })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'tools',
      'NVENC_UNAVAILABLE',
      expect.stringMatching(/mã -40.*610\.00|610\.00.*mã -40/),
      expect.anything()
    );
  });
});
