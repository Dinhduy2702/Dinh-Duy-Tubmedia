import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { MediaInfo, QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

/**
 * Vụ khách 2026-10-15: bộ mã hóa AAC của ffmpeg 8.0 (gyan.dev) tạo gói tiếng hỏng khi chuẩn hóa NA361. Sau khi mã hóa,
 * NormalizeEngine giải mã toàn bộ luồng tiếng; hỏng → mã hóa lại CHỈ phần tiếng bằng -aac_coder fast (giữ phần hình);
 * vẫn hỏng → cách ly, báo lỗi nêu phiên bản ffmpeg. Bản chạy ffmpeg thật: tests/integration/normalize-audio-encoder-fallback.
 */

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const source: MediaInfo = {
  duration: 20, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', videoProfile: 'Main', videoLevel: '4.1',
  pixelFormat: 'yuv420p', bitDepth: 8, timeBase: '1/90000', colorPrimaries: 'bt709', colorTransfer: 'bt709',
  colorSpace: 'bt709', hdr: false, audioCodec: 'aac', videoBitrate: 8_000_000, audioBitrate: 192_000, sampleRate: 44100,
  channels: 2, channelLayout: 'stereo', formatName: 'mov,mp4', fileSize: 1000
};

const target: NormalizeTarget = {
  width: 1920, height: 1080, fps: 30, hdr: false, videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac',
  sampleRate: 48000, channels: 2
};

const profile: QualityProfile = {
  id: 'reference', name: 'Reference', description: '', mode: 'custom', maxWidth: 1920, maxHeight: 1080,
  allowUpscale: true, fpsMode: '30', customFps: null, videoCodec: 'h264', encoder: 'libx264', crf: 18, cq: 20,
  preset: 'veryfast', pixelFormat: 'yuv420p', hdrMode: 'tonemap_sdr', audioMode: 'aac_256', sampleRate: 48000,
  forceStereo: true, builtIn: true
};

const resource: ResourceProfile = {
  id: 'resource', name: 'Resource', description: '', downloadWorkers: 1, analyzeWorkers: 1, normalizeWorkers: 1,
  remuxWorkers: 1, clipWorkers: 1, ffmpegThreads: 4, filterThreads: 2, filterComplexThreads: 2,
  processPriority: 'below_normal', cpuSoftLimitPercent: 85, memoryFreeMinimumBytes: 1, diskFreeMinimumBytes: 1,
  gpuJobs: 0, builtIn: true
};

const job: QueueJob = {
  id: 'job', projectId: 'project', type: 'merge', status: 'merging', priority: 0, sourceId: null, itemId: null,
  input: {}, progress: 0, speed: null, etaSeconds: null, attempts: 0, maxAttempts: 1, errorCode: null,
  errorMessage: null, createdAt: '', updatedAt: '', startedAt: null, finishedAt: null
};

const ESC_OVERFLOW = '[aac @ 0x1] error in spectral data, ESC overflow';

async function harness(decodeResults: Array<string | null>, sourceInfo: MediaInfo = source) {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-aac-fallback-unit-'));
  folders.push(folder);
  const input = join(folder, 'NA361_TA.mp4');
  await writeFile(input, 'nguon');
  const runs: string[][] = [];
  const decodeChecks: string[] = [];
  const events: string[] = [];
  const quarantined: string[] = [];
  const tools = {
    get: () => ({ available: true, executablePath: 'ffmpeg', capabilities: ['libx264'], version: '8.0-essentials_build-www.gyan.dev' })
  } as unknown as ToolManager;
  const processes = {
    run: async (options: ProcessRunOptions) => {
      runs.push(options.args);
      await writeFile(options.args.at(-1)!, 'tep-ra-' + runs.length);
      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
    }
  } as unknown as ProcessManager;
  const verifier = {
    verify: (path: string) =>
      Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: sourceInfo.duration }),
    decodeStreamFailure: (path: string) => {
      decodeChecks.push(path);
      return Promise.resolve(decodeResults.shift() ?? null);
    }
  } as unknown as FileVerifier;
  const record = (_module: string, code: string) => void events.push(code);
  const logger = { info: record, warn: record, error: record } as unknown as Logger;
  const quarantine = {
    move: (path: string) => {
      quarantined.push(path);
      return Promise.resolve(join(folder, 'cach-ly', 'tep.mp4'));
    }
  } as unknown as QuarantineService;
  const engine = new NormalizeEngine(tools, processes, {} as MediaAnalyzer, verifier, quarantine, logger);
  const run = () =>
    engine.normalizeToTarget(job, input, sourceInfo, join(folder, 'cache'), target, resource, new AbortController().signal, () => undefined, profile);
  return { run, runs, decodeChecks, events, quarantined };
}

describe('NormalizeEngine: bộ mã hóa AAC tạo tiếng hỏng → mã hóa lại phần tiếng bằng cách dự phòng', () => {
  it('tiếng hỏng lần đầu → lượt 2 chỉ mã hóa lại tiếng từ nguồn (-aac_coder fast, giữ phần hình), kết quả dùng được', async () => {
    const { run, runs, events } = await harness([ESC_OVERFLOW, null]);

    const output = await run();

    expect(runs).toHaveLength(2);
    const fallback = runs[1]!;
    expect(fallback.slice(fallback.indexOf('-aac_coder'), fallback.indexOf('-aac_coder') + 2)).toEqual(['-aac_coder', 'fast']);
    expect(fallback[fallback.indexOf('-c:v') + 1]).toBe('copy');
    expect(fallback).toContain('1:a:0');
    expect(fallback[fallback.indexOf('-ar') + 1]).toBe('48000');
    expect(fallback[fallback.indexOf('-b:a') + 1]).toBe('256k');
    expect(fallback).not.toContain('-crf');
    expect(existsSync(output)).toBe(true);
    expect(events).toContain('NORMALIZE_AUDIO_ENCODE_CORRUPT');
    expect(events).toContain('NORMALIZE_AUDIO_ENCODE_REPAIRED');
  });

  it('mã hóa lại vẫn hỏng → cách ly, báo lỗi nêu phiên bản ffmpeg, không trả tệp hỏng', async () => {
    const { run, quarantined } = await harness([ESC_OVERFLOW, ESC_OVERFLOW]);

    await expect(run()).rejects.toThrow(/8\.0-essentials_build/);
    expect(quarantined).toHaveLength(1);
  });

  it('tiếng sạch → chỉ một lượt mã hóa, không cảnh báo', async () => {
    const { run, runs, events, decodeChecks } = await harness([null]);

    await run();

    expect(runs).toHaveLength(1);
    expect(decodeChecks).toHaveLength(1);
    expect(events).not.toContain('NORMALIZE_AUDIO_ENCODE_CORRUPT');
  });

  it('tiếng được chép nguyên (không mã hóa lại) → không giải mã kiểm tiếng ở bước này', async () => {
    const { run, decodeChecks } = await harness([ESC_OVERFLOW], { ...source, width: 1280, height: 720, sampleRate: 48000 });

    await run();

    expect(decodeChecks).toHaveLength(0);
  });
});
