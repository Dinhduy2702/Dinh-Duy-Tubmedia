import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
 * Hai quy trình ghép dùng chung một nguồn cùng chuẩn hóa vào một bản đệm: trước đây cả hai ghi vào CÙNG một tệp tạm
 * "<bản đệm>.pending.mp4" (đè dở lên nhau) và chốt bằng rm(bản đệm) + rename. Giờ mỗi lần chạy một tệp tạm riêng
 * "<bản đệm>.<mã>.pending.mp4" (giữ đuôi .pending.mp4 cho bộ dọn rác).
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

async function harness() {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-pending-per-job-'));
  folders.push(folder);
  const input = join(folder, 'NA361_TA.mp4');
  await writeFile(input, 'nguon');
  const outputs: string[] = [];
  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));
  const tools = {
    get: () => ({ available: true, executablePath: 'ffmpeg', capabilities: ['libx264'], version: 'test' })
  } as unknown as ToolManager;
  const processes = {
    run: async (options: ProcessRunOptions) => {
      const output = options.args.at(-1)!;
      outputs.push(output);
      // Lượt đầu chờ tới khi lượt hai cũng đã bắt đầu ghi → hai lần chuẩn hóa chạy chồng lên nhau thật.
      if (outputs.length === 1) await firstMayFinish;
      else releaseFirst();
      await writeFile(output, 'ban-ma-hoa-' + outputs.length);
      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
    }
  } as unknown as ProcessManager;
  const verifier = {
    verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: source.duration }),
    decodeStreamFailure: () => Promise.resolve(null)
  } as unknown as FileVerifier;
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;
  const engine = new NormalizeEngine(tools, processes, {} as MediaAnalyzer, verifier, {} as QuarantineService, logger);
  const cache = join(folder, 'cache');
  const run = (id: string) =>
    engine.normalizeToTarget({ ...job, id }, input, source, cache, target, resource, new AbortController().signal, () => undefined, profile);
  return { run, outputs, cache };
}

describe('Bản đệm chuẩn hóa: mỗi lần chạy một tệp tạm riêng', () => {
  it('hai quy trình chuẩn hóa cùng nguồn cùng lúc → hai tệp tạm KHÁC nhau, đều đuôi .pending.mp4; xong không sót tệp tạm', async () => {
    const { run, outputs, cache } = await harness();

    const [first, second] = await Promise.all([run('merge-a'), run('merge-b')]);

    expect(outputs).toHaveLength(2);
    expect(outputs[0]).not.toBe(outputs[1]);
    for (const output of outputs) expect(output).toMatch(/\.pending\.mp4$/);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
    expect((await readdir(cache)).filter((name) => name.includes('.pending'))).toEqual([]);
  });
});
