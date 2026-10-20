import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine } from '../../src/main/normalize/normalize-engine.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { QueueJob, ResourceProfile, VerificationLevel } from '../../src/shared/types/domain.js';
import {
  corruptMiddleAudioPackets,
  makeClip,
  realMediaStack,
  resolveRealFfmpegDirectory,
  strictDecodeStatus
} from './helpers/real-ffmpeg.js';

/**
 * Còn lại sau FIX18: bản đệm remux LẤY LẠI thì được giải mã toàn bộ, nhưng tệp VỪA remux chỉ được kiểm "standard" (3 khung
 * hình, không giải mã tiếng). Remux là chép luồng nên gói tiếng hỏng của nguồn đi thẳng sang; ở bước chuẩn hóa timestamp
 * của MergeEngine, tệp remux thay chỗ nguồn nên nguồn cũng không qua "kiểm tra toàn bộ nguồn stream-copy" → tiếng hỏng
 * lọt tới tận hậu kiểm thành phẩm (cùng kiểu với vụ MERGE_FAILED 2026-10-15).
 */
const toolsDirectory = resolveRealFfmpegDirectory();
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

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

async function setup(options: { corruptSourceAudio: boolean }): Promise<{
  engine: NormalizeEngine;
  events: string[];
  quarantined: string[];
  levels: VerificationLevel[];
  input: string;
  remuxFolder: string;
  stack: ReturnType<typeof realMediaStack>;
}> {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-remux-fresh-'));
  folders.push(folder);
  const input = join(folder, 'NA361_TA.mp4');
  makeClip(toolsDirectory!, input, { width: 640, height: 360, fps: 15, seconds: 6, sampleRate: 44100 });
  if (options.corruptSourceAudio) corruptMiddleAudioPackets(toolsDirectory!, input);
  const stack = realMediaStack(toolsDirectory!);
  const levels: VerificationLevel[] = [];
  const verify = stack.verifier.verify.bind(stack.verifier);
  stack.verifier.verify = (path, level, ...rest) => {
    levels.push(level);
    return verify(path, level, ...rest);
  };
  const events: string[] = [];
  const logger = {
    info: (_module: string, code: string) => void events.push(code),
    warn: (_module: string, code: string) => void events.push(code),
    error: (_module: string, code: string) => void events.push(code),
    debug: () => undefined
  } as unknown as Logger;
  const quarantined: string[] = [];
  const quarantine = {
    move: (path: string) => {
      quarantined.push(path);
      return rm(path, { force: true }).then(() => path + '.quarantined');
    }
  } as unknown as QuarantineService;
  const engine = new NormalizeEngine(stack.tools, stack.processes, stack.analyzer, stack.verifier, quarantine, logger);
  return { engine, events, quarantined, levels, input, remuxFolder: join(folder, '_remux-cache'), stack };
}

function remuxFiles(folder: string): string[] {
  try {
    return readdirSync(folder).filter((name) => name.includes('.remux.'));
  } catch {
    return [];
  }
}

describe.skipIf(!toolsDirectory)('Tệp vừa remux phải giải mã toàn bộ hình + tiếng (ffmpeg thật)', () => {
  it('nguồn có gói tiếng hỏng → remux bị chặn, cách ly, KHÔNG thành bản đệm', async () => {
    const { engine, quarantined, input, remuxFolder } = await setup({ corruptSourceAudio: true });
    expect(strictDecodeStatus(toolsDirectory!, input, '0:a:0'), 'tệp mẫu: tiếng của nguồn phải hỏng').not.toBe(0);
    expect(strictDecodeStatus(toolsDirectory!, input, '0:v:0'), 'tệp mẫu: hình của nguồn vẫn sạch').toBe(0);

    await expect(
      engine.remuxForConcat(job('merge-1'), input, remuxFolder, resource, new AbortController().signal, () => undefined)
    ).rejects.toThrow(/giải mã/i);
    expect(quarantined, 'tệp remux hỏng phải vào khu cách ly').toHaveLength(1);
    expect(remuxFiles(remuxFolder), 'không được để lại bản đệm remux').toEqual([]);
  }, 180_000);

  it('nguồn sạch → remux kiểm mức deep, thành bản đệm, lần sau REMUX_CACHE_HIT', async () => {
    const { engine, events, levels, quarantined, input, remuxFolder } = await setup({ corruptSourceAudio: false });
    const signal = new AbortController().signal;

    const first = await engine.remuxForConcat(job('merge-1'), input, remuxFolder, resource, signal, () => undefined);
    expect(levels).toEqual(['deep']);
    expect(quarantined).toEqual([]);
    expect(strictDecodeStatus(toolsDirectory!, first, '0:a:0')).toBe(0);

    events.length = 0;
    const second = await engine.remuxForConcat(job('merge-2'), input, remuxFolder, resource, signal, () => undefined);
    expect(second).toBe(first);
    expect(events).toContain('REMUX_CACHE_HIT');
  }, 180_000);

  it('nguồn đã được giải mã toàn bộ trước đó (sourceDecodeVerified) → chỉ kiểm standard, không giải mã lần hai', async () => {
    const { engine, levels, input, remuxFolder } = await setup({ corruptSourceAudio: false });

    await engine.remuxForConcat(job('merge-1'), input, remuxFolder, resource, new AbortController().signal, () => undefined, {
      sourceDecodeVerified: true
    });
    expect(levels).toEqual(['standard']);
  }, 180_000);

  it('tạm dừng/hủy đúng lúc đang kiểm tệp vừa remux → dừng, KHÔNG cách ly (chưa chứng minh là hỏng), không để lại tệp tạm', async () => {
    const { engine, events, quarantined, input, remuxFolder, stack } = await setup({ corruptSourceAudio: false });
    const controller = new AbortController();
    const verify = stack.verifier.verify;
    stack.verifier.verify = (path, level, ...rest) => {
      if (level === 'deep') controller.abort(new Error('Người dùng tạm dừng.'));
      return verify(path, level, ...rest);
    };

    await expect(
      engine.remuxForConcat(job('merge-1'), input, remuxFolder, resource, controller.signal, () => undefined)
    ).rejects.toThrow(/tạm dừng/);
    expect(quarantined).toEqual([]);
    expect(events).not.toContain('REMUX_FRESH_REJECTED');
    expect(
      readdirSync(remuxFolder).filter((name) => name.endsWith('.mp4')),
      'không để lại tệp tạm/bản đệm'
    ).toEqual([]);
  }, 180_000);
});
