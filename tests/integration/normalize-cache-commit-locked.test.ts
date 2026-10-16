import { spawn } from 'node:child_process';
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
 * Hai quy trình ghép dùng chung bản đệm chuẩn hóa: quy trình A đang ĐỌC bản đệm (ghép) thì quy trình B phải làm lại bản
 * đệm (bản cũ không qua kiểm tra). Trước đây B chốt bằng rm(bản đệm) + rename → Windows từ chối xóa tệp đang mở (EBUSY/EPERM)
 * → B hỏng. Giờ: không ghi đè được thì B dùng tệp vừa làm dưới tên riêng, không bao giờ dùng bản đệm chưa qua kiểm tra.
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

describe.skipIf(!toolsDirectory)('Bản đệm chuẩn hóa đang bị quy trình khác mở (ffmpeg thật)', () => {
  it('bản đệm cũ hỏng và đang bị ffmpeg khác đọc → làm lại không hỏng job, trả tệp mới sạch, không đụng bản đang mở', async () => {
    const { engine, input, cacheFolder, stack } = await setup();
    const source = await stack.analyzer.analyze(input, 'cache-source');
    const signal = new AbortController().signal;
    const cached = await engine.normalizeToTarget(job('merge-a'), input, source, cacheFolder, target, resource, signal, () => undefined, profile);
    corruptMiddleAudioPackets(toolsDirectory!, cached);

    // Quy trình A đang đọc bản đệm (giữ tệp mở ~6 s, như lúc ghép).
    const reader = spawn(join(toolsDirectory!, 'ffmpeg.exe'), ['-v', 'quiet', '-re', '-i', cached, '-map', '0:v:0', '-f', 'null', '-'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));

      const fresh = await engine.normalizeToTarget(job('merge-b'), input, source, cacheFolder, target, resource, signal, () => undefined, profile);

      expect(existsSync(fresh)).toBe(true);
      expect(strictDecodeStatus(toolsDirectory!, fresh, '0:a:0'), 'tệp B nhận phải giải mã tiếng sạch').toBe(0);
      expect(fresh.endsWith('.pending.mp4'), 'không trả tệp tạm').toBe(false);
      expect(existsSync(cached), 'bản đệm đang bị đọc vẫn còn').toBe(true);
    } finally {
      reader.kill();
      await new Promise((resolve) => reader.once('close', resolve));
    }
  }, 180_000);
});
