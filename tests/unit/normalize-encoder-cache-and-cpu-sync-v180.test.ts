import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import { MergeEngine } from '../../src/main/merge/merge-engine.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { MediaInfo, QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

type TimelineServiceParam = ConstructorParameters<typeof MergeEngine>[5];

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const baseSource: MediaInfo = {
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  nominalFps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  videoExtradataHash: 'src-hash',
  audioExtradataHash: 'aud-hash',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  colorRange: 'tv',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  sampleRate: 48000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 2048
};

const baseTarget: NormalizeTarget = {
  width: 1920,
  height: 1080,
  fps: 30,
  hdr: false,
  videoCodec: 'h264',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  sampleRate: 48000,
  channels: 2,
  videoBitrate: null
};

const baseProfile: QualityProfile = {
  id: 'quality-auto',
  name: 'Auto',
  description: '',
  mode: 'smart_merge',
  maxWidth: null,
  maxHeight: null,
  allowUpscale: false,
  fpsMode: 'source',
  customFps: null,
  videoCodec: 'copy',
  encoder: 'auto',
  crf: 18,
  cq: 20,
  bitrateMode: 'quality',
  preset: 'veryfast',
  pixelFormat: 'yuv420p',
  hdrMode: 'auto',
  audioMode: 'copy_if_compatible',
  sampleRate: 48000,
  forceStereo: false,
  builtIn: true
};

const baseResource: ResourceProfile = {
  id: 'resource',
  name: 'Resource',
  description: '',
  downloadWorkers: 1,
  analyzeWorkers: 2,
  normalizeWorkers: 2,
  remuxWorkers: 1,
  clipWorkers: 1,
  ffmpegThreads: 4,
  filterThreads: 2,
  filterComplexThreads: 2,
  processPriority: 'below_normal',
  cpuSoftLimitPercent: 85,
  memoryFreeMinimumBytes: 1,
  diskFreeMinimumBytes: 1,
  gpuJobs: 1,
  builtIn: true
};

const baseJob: QueueJob = {
  id: 'job-16',
  projectId: 'proj-16',
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

describe('Lỗi #16: cache key theo resolvedEncoder, semaphore gpuJobs và đồng bộ CPU khi fallback', () => {
  it('tách cache chuẩn hóa theo resolvedEncoder dù profile.encoder đều là auto', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-16-cache-'));
    folders.push(folder);
    const input = join(folder, 'clip.mp4');
    const cacheFolder = join(folder, 'cache');
    await writeFile(input, 'source-bytes');

    const usedEncoders: string[] = [];
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        version: 'n8.1.3',
        capabilities: ['libx264', 'h264_nvenc']
      })
    } as unknown as ToolManager;

    const processes = {
      run: async (opts: ProcessRunOptions) => {
        const enc = opts.args[opts.args.indexOf('-c:v') + 1]!;
        usedEncoders.push(enc);
        await writeFile(opts.args.at(-1)!, `encoded-${enc}`);
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    const analyzer = {
      analyze: () => Promise.resolve({ ...baseSource })
    } as unknown as MediaAnalyzer;

    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 10 }),
      decodeStreamFailure: () => Promise.resolve(null)
    } as unknown as FileVerifier;

    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;
    const engine = new NormalizeEngine(tools, processes, analyzer, verifier, {} as QuarantineService, logger);

    const nvencOut = await engine.normalizeToTarget(
      baseJob,
      input,
      baseSource,
      cacheFolder,
      baseTarget,
      { ...baseResource, gpuJobs: 1 },
      new AbortController().signal,
      () => undefined,
      { ...baseProfile, encoder: 'auto' },
      undefined,
      true
    );

    const cpuOut = await engine.normalizeToTarget(
      baseJob,
      input,
      baseSource,
      cacheFolder,
      baseTarget,
      { ...baseResource, gpuJobs: 0 },
      new AbortController().signal,
      () => undefined,
      { ...baseProfile, encoder: 'auto' },
      undefined,
      true
    );

    expect(usedEncoders).toEqual(['h264_nvenc', 'libx264']);
    expect(cpuOut).not.toBe(nvencOut);
  });

  it('giới hạn số phiên NVENC đồng thời theo semaphore resource.gpuJobs', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-16-gpu-sem-'));
    folders.push(folder);
    const inputA = join(folder, 'a.mp4');
    const inputB = join(folder, 'b.mp4');
    const cacheFolder = join(folder, 'cache');
    await writeFile(inputA, 'bytes-a');
    await writeFile(inputB, 'bytes-b');

    let activeNvenc = 0;
    let maxActiveNvenc = 0;

    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        version: 'n8.1.3',
        capabilities: ['libx264', 'h264_nvenc']
      })
    } as unknown as ToolManager;

    const processes = {
      run: async (opts: ProcessRunOptions) => {
        const enc = opts.args[opts.args.indexOf('-c:v') + 1]!;
        if (enc === 'h264_nvenc') {
          activeNvenc += 1;
          maxActiveNvenc = Math.max(maxActiveNvenc, activeNvenc);
          await new Promise((resolve) => setTimeout(resolve, 40));
          activeNvenc -= 1;
        }
        await writeFile(opts.args.at(-1)!, `encoded-${enc}`);
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 40 };
      }
    } as unknown as ProcessManager;

    const analyzer = {
      analyze: () => Promise.resolve({ ...baseSource })
    } as unknown as MediaAnalyzer;

    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 10 }),
      decodeStreamFailure: () => Promise.resolve(null)
    } as unknown as FileVerifier;

    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;
    const engine = new NormalizeEngine(tools, processes, analyzer, verifier, {} as QuarantineService, logger);

    await Promise.all([
      engine.normalizeToTarget(
        baseJob,
        inputA,
        baseSource,
        cacheFolder,
        baseTarget,
        { ...baseResource, gpuJobs: 1 },
        new AbortController().signal,
        () => undefined,
        { ...baseProfile, encoder: 'h264_nvenc' },
        undefined,
        true
      ),
      engine.normalizeToTarget(
        baseJob,
        inputB,
        baseSource,
        cacheFolder,
        baseTarget,
        { ...baseResource, gpuJobs: 1 },
        new AbortController().signal,
        () => undefined,
        { ...baseProfile, encoder: 'h264_nvenc' },
        undefined,
        true
      )
    ]);

    expect(maxActiveNvenc).toBe(1);
  });

  it('MergeEngine đồng bộ toàn mẻ về cùng bộ mã hóa CPU nếu một clip bị fallback từ NVENC xuống CPU', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-16-cpu-sync-'));
    folders.push(folder);
    const input1 = join(folder, 'clip1.mp4');
    const input2 = join(folder, 'clip2.mp4');
    const outputFolder = join(folder, 'out');
    const workFolder = join(folder, 'work');
    await writeFile(input1, 'clip-1-bytes');
    await writeFile(input2, 'clip-2-bytes');

    const encoderByOutput = new Map<string, string>();
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        version: 'n8.1.3',
        capabilities: ['libx264', 'h264_nvenc']
      })
    } as unknown as ToolManager;

    const processes = {
      run: async (opts: ProcessRunOptions) => {
        const outPath = opts.args.at(-1)!;
        // Concat copy step
        if (opts.args.includes('concat')) {
          await writeFile(outPath, 'merged-output-bytes');
          return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
        }
        const enc = opts.args[opts.args.indexOf('-c:v') + 1]!;
        const inPath = opts.args[opts.args.indexOf('-i') + 1]!;
        // Clip 2 fails on h264_nvenc and must fall back to libx264
        if (inPath === input2 && enc === 'h264_nvenc') {
          return { code: 1, stdoutTail: '', stderrTail: 'Cannot load nvcuda.dll', durationMs: 1 };
        }
        await writeFile(outPath, `encoded-${enc}`);
        encoderByOutput.set(outPath, enc);
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    // Track committed cache paths by inspecting file content or matching prefix
    const analyzer = {
      analyze: async (path: string): Promise<MediaInfo> => {
        if (path === input1) {
          return { ...baseSource, width: 1280, height: 720, videoExtradataHash: 'src-1' };
        }
        if (path === input2) {
          return { ...baseSource, width: 1920, height: 1080, videoExtradataHash: 'src-2' };
        }
        const { readFile } = await import('node:fs/promises');
        const content = await readFile(path, 'utf8');
        if (content.includes('merged-output-bytes')) {
          return {
            ...baseSource,
            duration: 20,
            videoStreamDuration: 20,
            audioStreamDuration: 20,
            videoExtradataHash: 'cpu-extradata',
            audioExtradataHash: 'aac-extradata'
          };
        }
        const isCpu = content.includes('libx264');
        return {
          ...baseSource,
          videoStreamDuration: 10,
          audioStreamDuration: 10,
          videoExtradataHash: isCpu ? 'cpu-extradata' : 'nvenc-extradata',
          audioExtradataHash: 'aac-extradata'
        };
      }
    } as unknown as MediaAnalyzer;

    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 20 }),
      decodeStreamFailure: () => Promise.resolve(null),
      verifyVisualIntegrity: () => Promise.resolve({ ok: true, reasons: [], issues: [] })
    } as unknown as FileVerifier;

    const timeline = {
      write: async (_items: unknown, outFolder: string, stem: string) => {
        const txtPath = join(outFolder, `${stem}.timeline.txt`);
        await writeFile(txtPath, '00:00:00 Clip 1\n');
        return { rows: [], totalDuration: 20, txt: txtPath };
      }
    } as unknown as TimelineServiceParam;

    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;
    const normalizer = new NormalizeEngine(tools, processes, analyzer, verifier, {} as QuarantineService, logger);
    const mergeEngine = new MergeEngine(tools, processes, analyzer, verifier, normalizer, timeline, {} as QuarantineService);

    const result = await mergeEngine.merge(
      baseJob,
      [
        { path: input1, label: 'Clip 1', note: '' },
        { path: input2, label: 'Clip 2', note: '' }
      ],
      outputFolder,
      workFolder,
      'Merged16',
      { ...baseProfile, encoder: 'h264_nvenc' },
      { ...baseResource, gpuJobs: 1, normalizeWorkers: 1 },
      new AbortController().signal,
      true,
      () => undefined
    );

    expect(result.video).toContain('Merged16.mp4');
  });
});
