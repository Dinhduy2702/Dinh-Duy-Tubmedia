import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { matchNormalizationTarget } from '../../src/shared/utils/normalization-match.js';
import { chooseMergeTarget } from '../../src/shared/utils/merge-target.js';
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
  duration: 12,
  width: 1920,
  height: 1080,
  fps: 30,
  nominalFps: 30,
  variableFrameRate: false,
  sampleAspectRatio: '1:1',
  displayAspectRatio: '16:9',
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  videoExtradataHash: 'orig-v-hash',
  audioExtradataHash: 'orig-a-hash',
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

const baseProfile: QualityProfile = {
  id: 'quality-smart',
  name: 'Smart',
  description: '',
  mode: 'smart_merge',
  maxWidth: null,
  maxHeight: null,
  allowUpscale: false,
  fpsMode: 'source',
  customFps: null,
  videoCodec: 'copy',
  encoder: 'cpu_auto',
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
  gpuJobs: 0,
  builtIn: true
};

const baseJob: QueueJob = {
  id: 'job-17',
  projectId: 'proj-17',
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

describe('Lỗi #17: normalization-match VFR/SAR/DAR/HDR transfer và forceUniform trong MergeEngine', () => {
  it('matchNormalizationTarget từ chối stream-copy khi nguồn là VFR hoặc lệch DAR/HDR colorTransfer', () => {
    const target: NormalizeTarget = {
      width: 1920,
      height: 1080,
      fps: 30,
      hdr: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      sampleRate: 48000,
      channels: 2
    };

    expect(matchNormalizationTarget({ ...baseSource, variableFrameRate: true }, target).videoMatches).toBe(false);
    expect(matchNormalizationTarget({ ...baseSource, displayAspectRatio: '4:3' }, target).videoMatches).toBe(false);

    const hdrTarget: NormalizeTarget = {
      ...target,
      hdr: true,
      videoCodec: 'hevc',
      pixelFormat: 'yuv420p10le',
      colorTransfer: 'smpte2084'
    };
    const hlgSource: MediaInfo = {
      ...baseSource,
      hdr: true,
      hdrType: 'hlg',
      videoCodec: 'hevc',
      pixelFormat: 'yuv420p10le',
      bitDepth: 10,
      colorPrimaries: 'bt2020',
      colorTransfer: 'arib-std-b67',
      colorSpace: 'bt2020nc'
    };
    expect(matchNormalizationTarget(hlgSource, hdrTarget).videoMatches).toBe(false);
  });

  it('chooseMergeTarget + NormalizeEngine đồng nhất hdrColorTransfer theo target thay vì giữ riêng từng nguồn', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-17-hdr-trc-'));
    folders.push(folder);
    const input = join(folder, 'hlg.mp4');
    await writeFile(input, 'hlg-bytes');

    const pqSource: MediaInfo = {
      ...baseSource,
      duration: 60,
      hdr: true,
      hdrType: 'hdr10',
      videoCodec: 'hevc',
      pixelFormat: 'yuv420p10le',
      bitDepth: 10,
      colorPrimaries: 'bt2020',
      colorTransfer: 'smpte2084',
      colorSpace: 'bt2020nc'
    };
    const hlgSource: MediaInfo = {
      ...pqSource,
      duration: 10,
      hdrType: 'hlg',
      colorTransfer: 'arib-std-b67'
    };

    const mergeTarget = chooseMergeTarget([pqSource, hlgSource], baseProfile);
    expect(mergeTarget.colorTransfer).toBe('smpte2084');

    let capturedArgs: string[] = [];
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        version: 'n8.1.3',
        capabilities: ['libx265', 'zscale', 'tonemap']
      })
    } as unknown as ToolManager;
    const processes = {
      run: async (opts: ProcessRunOptions) => {
        capturedArgs = opts.args;
        await writeFile(opts.args.at(-1)!, 'hdr-encoded');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;
    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 10 }),
      decodeStreamFailure: () => Promise.resolve(null)
    } as unknown as FileVerifier;
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

    const engine = new NormalizeEngine(tools, processes, {} as MediaAnalyzer, verifier, {} as QuarantineService, logger);
    await engine.normalizeToTarget(
      baseJob,
      input,
      hlgSource,
      join(folder, 'cache'),
      mergeTarget,
      baseResource,
      new AbortController().signal,
      () => undefined,
      baseProfile,
      undefined,
      true
    );

    const trcIdx = capturedArgs.indexOf('-color_trc');
    expect(trcIdx).toBeGreaterThan(-1);
    expect(capturedArgs[trcIdx + 1]).toBe('smpte2084');
    const vf = capturedArgs[capturedArgs.indexOf('-vf') + 1] ?? '';
    expect(vf).toContain('color_trc=smpte2084');
  });

  it('MergeEngine bật forceUniformVideo khi có bất kỳ clip nào phải mã hóa lại video để tránh lỗi lệch extradata ở 65%', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-17-uniform-'));
    folders.push(folder);
    const input1 = join(folder, 'clip1.mp4');
    const input2 = join(folder, 'clip2.mp4');
    await writeFile(input1, 'clip1-bytes');
    await writeFile(input2, 'clip2-bytes');

    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        version: 'n8.1.3',
        capabilities: ['libx264']
      })
    } as unknown as ToolManager;

    const processes = {
      run: async (opts: ProcessRunOptions) => {
        const outPath = opts.args.at(-1)!;
        if (opts.args.includes('concat')) {
          await writeFile(outPath, 'merged-output');
          return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
        }
        await writeFile(outPath, 'reencoded-video');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    // Cả 2 clip có cùng bitstream metadata ban đầu (hasVideoBitstreamMismatch === false),
    // nhưng clip 2 có độ phân giải 720p nên bắt buộc phải mã hóa lại -> sinh ra extradata mới.
    const analyzer = {
      analyze: async (path: string): Promise<MediaInfo> => {
        if (path === input1) {
          return { ...baseSource, duration: 20, width: 1920, height: 1080, videoExtradataHash: 'orig-v-hash' };
        }
        if (path === input2) {
          return { ...baseSource, duration: 10, width: 1280, height: 720, videoExtradataHash: 'orig-v-hash' };
        }
        const content = await readFile(path, 'utf8');
        if (content.includes('merged-output')) {
          return {
            ...baseSource,
            duration: 30,
            videoStreamDuration: 30,
            audioStreamDuration: 30,
            videoExtradataHash: 'reencoded-v-hash'
          };
        }
        return {
          ...baseSource,
          duration: 15,
          videoStreamDuration: 15,
          audioStreamDuration: 15,
          videoExtradataHash: 'reencoded-v-hash'
        };
      }
    } as unknown as MediaAnalyzer;

    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 30 }),
      decodeStreamFailure: () => Promise.resolve(null),
      verifyVisualIntegrity: () => Promise.resolve({ ok: true, reasons: [], issues: [] })
    } as unknown as FileVerifier;

    const timeline = {
      write: async (_items: unknown, outFolder: string, stem: string) => {
        const txtPath = join(outFolder, `${stem}.timeline.txt`);
        await writeFile(txtPath, '00:00:00 Clip 1\n');
        return { rows: [], totalDuration: 30, txt: txtPath };
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
      join(folder, 'out'),
      join(folder, 'work'),
      'Merged17',
      baseProfile,
      baseResource,
      new AbortController().signal,
      true,
      () => undefined
    );

    expect(result.video).toContain('Merged17.mp4');
  });
});
