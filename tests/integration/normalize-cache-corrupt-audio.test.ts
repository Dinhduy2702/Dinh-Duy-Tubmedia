import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';
import {
  corruptMiddleAudioPackets,
  makeClip,
  realMediaStack,
  resolveRealFfmpegDirectory,
  strictDecodeStatus
} from './helpers/real-ffmpeg.js';

/**
 * Vụ khách 2026-10-15 (job 03002b08): cả 8 nguồn của lần ghép đều lấy từ bộ nhớ đệm chuẩn hóa (NORMALIZE_CACHE_HIT).
 * Bản đệm của NA361 có gói AAC hỏng ở giây 161,9 (nguồn gốc giải mã sạch, cùng SHA256 với bản trên máy dev). Kiểm tra
 * bản đệm chỉ thử 3 khung hình (mức standard) nên bản hỏng được coi là hợp lệ, dùng lại mãi, và mọi lần ghép lại đều bị
 * hậu kiểm chặn ở 11:05. Bản đệm phải được giải mã toàn bộ (hình + tiếng) trước khi dùng lại; hỏng thì làm lại từ nguồn.
 */
const toolsDirectory = resolveRealFfmpegDirectory();
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const target: NormalizeTarget = {
  width: 640,
  height: 360,
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
  maxWidth: 640,
  maxHeight: 360,
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

function job(id: string): QueueJob {
  return {
    id,
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
}

async function setup(): Promise<{
  engine: NormalizeEngine;
  events: string[];
  input: string;
  cacheFolder: string;
  stack: ReturnType<typeof realMediaStack>;
}> {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-normalize-cache-'));
  folders.push(folder);
  const input = join(folder, 'NA361_TA.mp4');
  makeClip(toolsDirectory!, input, { width: 640, height: 360, fps: 15, seconds: 6, sampleRate: 44100 });
  const stack = realMediaStack(toolsDirectory!);
  const events: string[] = [];
  const logger = {
    info: (_module: string, code: string) => void events.push(code),
    warn: (_module: string, code: string) => void events.push(code),
    error: (_module: string, code: string) => void events.push(code),
    debug: () => undefined
  } as unknown as Logger;
  const quarantine = {
    move: (path: string) => Promise.resolve(path)
  } as unknown as QuarantineService;
  const engine = new NormalizeEngine(stack.tools, stack.processes, stack.analyzer, stack.verifier, quarantine, logger);
  return { engine, events, input, cacheFolder: join(folder, '_normalized-cache'), stack };
}

describe.skipIf(!toolsDirectory)('Bộ nhớ đệm chuẩn hóa: bản đệm hỏng không được dùng lại (ffmpeg thật)', () => {
  it('bản đệm có luồng tiếng hỏng → không CACHE_HIT, chuẩn hóa lại từ nguồn, tệp trả về giải mã sạch', async () => {
    const { engine, events, input, cacheFolder, stack } = await setup();
    const source = await stack.analyzer.analyze(input, 'cache-source');
    const signal = new AbortController().signal;

    const first = await engine.normalizeToTarget(job('merge-1'), input, source, cacheFolder, target, resource, signal, () => undefined, profile);
    expect(first).not.toBe(input);
    expect(strictDecodeStatus(toolsDirectory!, first, '0:a:0'), 'bản đệm vừa tạo phải sạch').toBe(0);

    corruptMiddleAudioPackets(toolsDirectory!, first);
    expect(strictDecodeStatus(toolsDirectory!, first, '0:a:0'), 'tệp mẫu: tiếng của bản đệm phải hỏng').not.toBe(0);
    expect(strictDecodeStatus(toolsDirectory!, first, '0:v:0'), 'tệp mẫu: hình của bản đệm vẫn sạch').toBe(0);

    events.length = 0;
    const second = await engine.normalizeToTarget(job('merge-2'), input, source, cacheFolder, target, resource, signal, () => undefined, profile);

    expect(events).not.toContain('NORMALIZE_CACHE_HIT');
    expect(strictDecodeStatus(toolsDirectory!, second, '0:a:0'), 'tệp dùng để ghép phải giải mã tiếng sạch').toBe(0);
    expect(strictDecodeStatus(toolsDirectory!, second, '0:v:0')).toBe(0);
  }, 180_000);

  it('bản đệm remux có luồng tiếng hỏng → không REMUX_CACHE_HIT, remux lại từ nguồn, tệp trả về giải mã sạch', async () => {
    const { engine, events, input, cacheFolder } = await setup();
    const signal = new AbortController().signal;
    const remuxFolder = join(cacheFolder, '..', '_remux-cache');

    const first = await engine.remuxForConcat(job('merge-1'), input, remuxFolder, resource, signal, () => undefined);
    expect(first).not.toBe(input);
    corruptMiddleAudioPackets(toolsDirectory!, first);
    expect(strictDecodeStatus(toolsDirectory!, first, '0:a:0'), 'tệp mẫu: tiếng của bản remux phải hỏng').not.toBe(0);

    events.length = 0;
    const second = await engine.remuxForConcat(job('merge-2'), input, remuxFolder, resource, signal, () => undefined);

    expect(events).not.toContain('REMUX_CACHE_HIT');
    expect(strictDecodeStatus(toolsDirectory!, second, '0:a:0'), 'tệp dùng để ghép phải giải mã tiếng sạch').toBe(0);
  }, 180_000);

  it('tạm dừng/hủy đúng lúc đang kiểm bản đệm → dừng, KHÔNG xóa bản đệm (chưa chứng minh là hỏng)', async () => {
    const { engine, events, input, cacheFolder, stack } = await setup();
    const source = await stack.analyzer.analyze(input, 'cache-source');

    const first = await engine.normalizeToTarget(job('merge-1'), input, source, cacheFolder, target, resource, new AbortController().signal, () => undefined, profile);
    const aborted = new AbortController();
    aborted.abort(new Error('Người dùng tạm dừng.'));
    events.length = 0;

    await expect(
      engine.normalizeToTarget(job('merge-2'), input, source, cacheFolder, target, resource, aborted.signal, () => undefined, profile)
    ).rejects.toThrow();
    expect(existsSync(first), 'bản đệm phải còn nguyên').toBe(true);
    expect(events).not.toContain('NORMALIZE_CACHE_REJECTED');
    expect(events).not.toContain('ENCODER_SELECTED');
  }, 180_000);

  it('bản đệm sạch → vẫn dùng lại (CACHE_HIT), không chuẩn hóa lại', async () => {
    const { engine, events, input, cacheFolder, stack } = await setup();
    const source = await stack.analyzer.analyze(input, 'cache-source');
    const signal = new AbortController().signal;

    const first = await engine.normalizeToTarget(job('merge-1'), input, source, cacheFolder, target, resource, signal, () => undefined, profile);
    events.length = 0;
    const second = await engine.normalizeToTarget(job('merge-2'), input, source, cacheFolder, target, resource, signal, () => undefined, profile);

    expect(second).toBe(first);
    expect(events).toContain('NORMALIZE_CACHE_HIT');
    expect(events).not.toContain('ENCODER_SELECTED');
  }, 180_000);
});
