import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';
import { makeClip, realMediaStack, resolveRealFfmpegDirectory, strictDecodeStatus } from './helpers/real-ffmpeg.js';

/**
 * Vụ khách 2026-10-15 (job 03002b08): ffmpeg 8.0 essentials (gyan.dev) mã hóa tiếng NA361_TA.mp4 với
 * `-c:a aac -b:a 256k -ar 48000 -ac 2` ra gói AAC hỏng ("error in spectral data, ESC overflow") — lỗi của bộ mã hóa,
 * phụ thuộc nội dung (170 giây tiếng đầu tiên là đủ tái hiện; chỉ đoạn quanh 2:41 thì không). Bước chuẩn hóa phải tự
 * phát hiện ngay (giải mã toàn bộ luồng tiếng vừa tạo) và mã hóa lại phần tiếng bằng cách dự phòng (-aac_coder fast).
 *
 * Cần đúng bản ffmpeg 8.0 essentials (thư mục bin có ffmpeg.exe + ffprobe.exe) qua TUBMEDIA_TEST_FFMPEG_AAC_BUG_DIR và
 * tệp NA361 thật qua TUBMEDIA_TEST_NA361_SOURCE — thiếu thì bài tự bỏ qua.
 */
const buggyDirectory = process.env.TUBMEDIA_TEST_FFMPEG_AAC_BUG_DIR ?? '';
const na361 = process.env.TUBMEDIA_TEST_NA361_SOURCE ?? '';
const goodDirectory = resolveRealFfmpegDirectory();
const available =
  Boolean(goodDirectory) &&
  existsSync(join(buggyDirectory, 'ffmpeg.exe')) &&
  existsSync(join(buggyDirectory, 'ffprobe.exe')) &&
  existsSync(na361);
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const target: NormalizeTarget = {
  width: 320,
  height: 180,
  fps: 30,
  hdr: false,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  sampleRate: 48000,
  channels: 2
};

const profile: QualityProfile = {
  id: 'reference',
  name: 'Reference',
  description: '',
  mode: 'custom',
  maxWidth: 320,
  maxHeight: 180,
  allowUpscale: false,
  fpsMode: '30',
  customFps: null,
  videoCodec: 'h264',
  encoder: 'libx264',
  crf: 23,
  cq: 20,
  preset: 'ultrafast',
  pixelFormat: 'yuv420p',
  hdrMode: 'tonemap_sdr',
  audioMode: 'aac_256',
  sampleRate: 48000,
  forceStereo: true,
  builtIn: true
};

const resource: ResourceProfile = {
  id: 'resource',
  name: 'Resource',
  description: '',
  downloadWorkers: 1,
  analyzeWorkers: 1,
  normalizeWorkers: 1,
  remuxWorkers: 1,
  clipWorkers: 1,
  ffmpegThreads: 2,
  filterThreads: 1,
  filterComplexThreads: 1,
  processPriority: 'below_normal',
  cpuSoftLimitPercent: 85,
  memoryFreeMinimumBytes: 1,
  diskFreeMinimumBytes: 1,
  gpuJobs: 0,
  builtIn: true
};

const job: QueueJob = {
  id: 'merge-na361',
  projectId: 'project',
  type: 'merge',
  status: 'merging',
  priority: 0,
  sourceId: null,
  itemId: null,
  input: {},
  progress: 0,
  speed: null,
  etaSeconds: null,
  attempts: 0,
  maxAttempts: 1,
  errorCode: null,
  errorMessage: null,
  createdAt: '',
  updatedAt: '',
  startedAt: null,
  finishedAt: null
};

describe.skipIf(!goodDirectory)('Chuẩn hóa với ffmpeg tốt: tiếng sạch → không cảnh báo, không mã hóa lại', () => {
  it('clip thử 44,1 kHz → 48 kHz: không NORMALIZE_AUDIO_ENCODE_CORRUPT, chỉ một lượt mã hóa', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-aac-fallback-'));
    folders.push(folder);
    const input = join(folder, 'clip.mp4');
    makeClip(goodDirectory!, input, { width: 320, height: 180, fps: 30, seconds: 6, sampleRate: 44100 });
    const stack = realMediaStack(goodDirectory!);
    const codes: string[] = [];
    const record = (_module: string, code: string) => void codes.push(code);
    const logger = { info: record, warn: record, error: record, debug: () => undefined } as unknown as Logger;
    const quarantine = { move: (path: string) => Promise.resolve(path) } as unknown as QuarantineService;
    const engine = new NormalizeEngine(stack.tools, stack.processes, stack.analyzer, stack.verifier, quarantine, logger);
    const source = await stack.analyzer.analyze(input, job.id);

    const output = await engine.normalizeToTarget(
      job, input, source, join(folder, '_normalized-cache'), target, resource, new AbortController().signal, () => undefined, profile
    );

    expect(strictDecodeStatus(goodDirectory!, output, '0:a:0')).toBe(0);
    expect(codes).not.toContain('NORMALIZE_AUDIO_ENCODE_CORRUPT');
    expect(codes.filter((code) => code === 'ENCODER_SELECTED')).toHaveLength(1);
  }, 120_000);
});

describe.skipIf(!available)('Chuẩn hóa: bộ mã hóa AAC của ffmpeg tạo tiếng hỏng → tự phát hiện và mã hóa lại tiếng (ffmpeg 8.0 thật + NA361)', () => {
  it('NA361 (170 giây tiếng đầu, hình testsrc) với ffmpeg 8.0 → tệp chuẩn hóa giải mã tiếng sạch, có log cảnh báo', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-aac-fallback-'));
    folders.push(folder);
    const input = join(folder, 'NA361_TA.mp4');
    const fixture = spawnSync(
      join(goodDirectory!, 'ffmpeg.exe'),
      [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=165',
        '-i', na361,
        '-map', '0:v:0', '-map', '1:a:0', '-t', '165',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        input
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 120_000 }
    );
    expect(fixture.status, fixture.stderr).toBe(0);

    const stack = realMediaStack(buggyDirectory);
    const events: Array<{ code: string; metadata?: Record<string, unknown> }> = [];
    const record = (_module: string, code: string, _message: string, context?: { metadata?: Record<string, unknown> }) =>
      void events.push({ code, ...(context?.metadata ? { metadata: context.metadata } : {}) });
    const logger = { info: record, warn: record, error: record, debug: () => undefined } as unknown as Logger;
    const quarantine = { move: (path: string) => Promise.resolve(path) } as unknown as QuarantineService;
    const engine = new NormalizeEngine(stack.tools, stack.processes, stack.analyzer, stack.verifier, quarantine, logger);
    const source = await stack.analyzer.analyze(input, job.id);

    const output = await engine.normalizeToTarget(
      job, input, source, join(folder, '_normalized-cache'), target, resource, new AbortController().signal, () => undefined, profile
    );

    // Giải mã bằng ffmpeg MỚI (bộ giải mã đúng) — không tin chính bản 8.0.
    expect(strictDecodeStatus(goodDirectory!, output, '0:a:0'), 'tiếng của tệp chuẩn hóa phải giải mã sạch').toBe(0);
    expect(strictDecodeStatus(goodDirectory!, output, '0:v:0')).toBe(0);
    const info = await realMediaStack(goodDirectory!).analyzer.analyze(output, 'check-sync');
    expect(info.audioStreamDuration, 'tiếng và hình không được lệch sau khi mã hóa lại tiếng').toBeDefined();
    expect(Math.abs((info.videoStreamDuration ?? info.duration) - info.audioStreamDuration!)).toBeLessThan(0.1);
    const warning = events.find((event) => event.code === 'NORMALIZE_AUDIO_ENCODE_CORRUPT');
    expect(warning, JSON.stringify(events.map((event) => event.code))).toBeDefined();
    expect(String(warning!.metadata?.ffmpegError)).toMatch(/aac/i);
  }, 300_000);
});
