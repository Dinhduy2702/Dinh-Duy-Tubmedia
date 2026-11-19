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

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const baseSource: MediaInfo = {
  duration: 12,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'hevc',
  videoProfile: 'Main',
  videoLevel: '120',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
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
  videoCodec: 'hevc',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  sampleRate: 48000,
  channels: 2,
  videoBitrate: 8_000_000
};

const baseProfile: QualityProfile = {
  id: 'quality-source-size',
  name: 'Nguồn nguyên bản',
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
  bitrateMode: 'source_average',
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
  analyzeWorkers: 1,
  normalizeWorkers: 1,
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

const job: QueueJob = {
  id: 'job-v178',
  projectId: 'project-v178',
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

async function captureNormalizeArgs(options: {
  source?: Partial<MediaInfo>;
  target?: Partial<NormalizeTarget>;
  profile?: Partial<QualityProfile>;
  resource?: Partial<ResourceProfile>;
  capabilities?: string[];
  forceVideoTranscode?: boolean;
  forceAudioTranscode?: boolean;
}): Promise<{ args: string[]; outputPath: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v178-unit-'));
  folders.push(folder);
  const input = join(folder, 'clip.mp4');
  await writeFile(input, 'fixture-video-bytes');
  let capturedArgs: string[] = [];

  const tools = {
    get: () => ({
      available: true,
      executablePath: 'ffmpeg',
      version: 'n8.1.3',
      capabilities: options.capabilities ?? ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'zscale', 'tonemap']
    })
  } as unknown as ToolManager;

  const processes = {
    run: async (runOpts: ProcessRunOptions) => {
      capturedArgs = runOpts.args;
      await writeFile(runOpts.args.at(-1)!, 'encoded');
      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
    }
  } as unknown as ProcessManager;

  const verifier = {
    verify: (path: string) =>
      Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 12 }),
    decodeStreamFailure: () => Promise.resolve(null)
  } as unknown as FileVerifier;

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  } as unknown as Logger;

  const engine = new NormalizeEngine(
    tools,
    processes,
    {} as MediaAnalyzer,
    verifier,
    {} as QuarantineService,
    logger
  );

  const outputPath = await engine.normalizeToTarget(
    job,
    input,
    { ...baseSource, ...options.source },
    join(folder, 'cache'),
    { ...baseTarget, ...options.target },
    { ...baseResource, ...options.resource },
    new AbortController().signal,
    () => undefined,
    { ...baseProfile, ...options.profile },
    undefined,
    options.forceVideoTranscode ?? true,
    options.forceAudioTranscode ?? false
  );

  return { args: capturedArgs, outputPath };
}

function countScaleFilters(vf: string): number {
  return vf
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('scale=')).length;
}

describe('NormalizeEngine 1.7.8: 4 chốt an toàn đồng nhất extradata', () => {
  it('chốt 1: chỉ gắn -x265-params no-info=1 khi encoder === libx265, tuyệt đối KHÔNG gắn cho hevc_nvenc / h264_nvenc / libx264', async () => {
    const cpuHevc = await captureNormalizeArgs({
      target: { videoCodec: 'hevc' },
      profile: { encoder: 'cpu_auto' },
      resource: { gpuJobs: 0 }
    });
    expect(cpuHevc.args[cpuHevc.args.indexOf('-c:v') + 1]).toBe('libx265');
    const x265Idx = cpuHevc.args.indexOf('-x265-params');
    expect(x265Idx).toBeGreaterThan(-1);
    expect(cpuHevc.args[x265Idx + 1]).toBe('no-info=1');

    const gpuHevc = await captureNormalizeArgs({
      target: { videoCodec: 'hevc' },
      profile: { encoder: 'hevc_nvenc' },
      resource: { gpuJobs: 1 },
      capabilities: ['libx265', 'hevc_nvenc']
    });
    expect(gpuHevc.args[gpuHevc.args.indexOf('-c:v') + 1]).toBe('hevc_nvenc');
    expect(gpuHevc.args).not.toContain('-x265-params');

    const gpuH264 = await captureNormalizeArgs({
      target: { videoCodec: 'h264' },
      profile: { encoder: 'h264_nvenc' },
      resource: { gpuJobs: 1 },
      capabilities: ['libx264', 'h264_nvenc']
    });
    expect(gpuH264.args[gpuH264.args.indexOf('-c:v') + 1]).toBe('h264_nvenc');
    expect(gpuH264.args).not.toContain('-x265-params');

    const cpuH264 = await captureNormalizeArgs({
      target: { videoCodec: 'h264' },
      profile: { encoder: 'libx264' },
      resource: { gpuJobs: 0 }
    });
    expect(cpuH264.args[cpuH264.args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(cpuH264.args).not.toContain('-x265-params');
  });

  it('chốt 2: luồng HDR (target.hdr = true) KHÔNG bị ép bt709 mà giữ đúng bt2020 / bt2020nc / smpte2084 (hoặc arib-std-b67) / tv / left', async () => {
    const hdrPq = await captureNormalizeArgs({
      source: {
        hdr: true,
        hdrType: 'hdr10',
        pixelFormat: 'yuv420p10le',
        bitDepth: 10,
        colorPrimaries: 'bt2020',
        colorTransfer: 'smpte2084',
        colorSpace: 'bt2020nc'
      },
      target: {
        hdr: true,
        videoCodec: 'hevc',
        pixelFormat: 'yuv420p10le'
      },
      profile: { encoder: 'cpu_auto', hdrMode: 'keep' },
      resource: { gpuJobs: 0 }
    });
    const vfPq = hdrPq.args[hdrPq.args.indexOf('-vf') + 1] ?? '';
    expect(vfPq).not.toContain('bt709');
    expect(vfPq).toContain('out_color_matrix=bt2020:out_chroma_loc=left');
    expect(vfPq).toContain('setparams=range=tv:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc');
    expect(hdrPq.args).not.toContain('bt709');
    expect(hdrPq.args[hdrPq.args.indexOf('-color_primaries') + 1]).toBe('bt2020');
    expect(hdrPq.args[hdrPq.args.indexOf('-color_trc') + 1]).toBe('smpte2084');
    expect(hdrPq.args[hdrPq.args.indexOf('-colorspace') + 1]).toBe('bt2020nc');
    expect(hdrPq.args[hdrPq.args.indexOf('-color_range') + 1]).toBe('tv');
    expect(hdrPq.args[hdrPq.args.indexOf('-chroma_sample_location') + 1]).toBe('left');

    const hdrHlg = await captureNormalizeArgs({
      source: {
        hdr: true,
        hdrType: 'hlg',
        pixelFormat: 'yuv420p10le',
        bitDepth: 10,
        colorPrimaries: 'bt2020',
        colorTransfer: 'arib-std-b67',
        colorSpace: 'bt2020nc'
      },
      target: {
        hdr: true,
        videoCodec: 'hevc',
        pixelFormat: 'yuv420p10le'
      },
      profile: { encoder: 'cpu_auto', hdrMode: 'keep' },
      resource: { gpuJobs: 0 }
    });
    expect(hdrHlg.args[hdrHlg.args.indexOf('-color_trc') + 1]).toBe('arib-std-b67');
  });

  it('chốt 3 & 4: không chạy lọc scale 2 lần khi đổi kích thước, thêm scale chuẩn hóa màu 1 lần khi giữ nguyên kích thước và luôn ép fps cố định khi mã hóa lại hình', async () => {
    const resized = await captureNormalizeArgs({
      source: { width: 2560, height: 1440, fps: 30 },
      target: { width: 1920, height: 1080, fps: 30, hdr: false, videoCodec: 'hevc' },
      profile: { encoder: 'cpu_auto' },
      resource: { gpuJobs: 0 }
    });
    const vfResized = resized.args[resized.args.indexOf('-vf') + 1] ?? '';
    expect(countScaleFilters(vfResized)).toBe(1);
    expect(vfResized).toContain('in_range=auto:out_range=tv:out_color_matrix=bt709:out_chroma_loc=left');
    expect(vfResized).toContain('fps=30');
    expect(vfResized).toContain('setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709');

    const sameSize = await captureNormalizeArgs({
      source: { width: 1920, height: 1080, fps: 30, variableFrameRate: true },
      target: { width: 1920, height: 1080, fps: 30, hdr: false, videoCodec: 'hevc' },
      profile: { encoder: 'cpu_auto' },
      resource: { gpuJobs: 0 }
    });
    const vfSameSize = sameSize.args[sameSize.args.indexOf('-vf') + 1] ?? '';
    expect(countScaleFilters(vfSameSize)).toBe(1);
    expect(vfSameSize).toContain('scale=in_range=auto:out_range=tv:out_color_matrix=bt709:out_chroma_loc=left');
    expect(vfSameSize).toContain('fps=30');
    expect(sameSize.args[sameSize.args.indexOf('-color_range') + 1]).toBe('tv');
    expect(sameSize.args[sameSize.args.indexOf('-chroma_sample_location') + 1]).toBe('left');
  });
});
