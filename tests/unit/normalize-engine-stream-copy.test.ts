import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type {
  ProcessManager,
  ProcessRunOptions
} from '../../src/main/processes/process-manager.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type {
  MediaInfo,
  QualityProfile,
  QueueJob,
  ResourceProfile
} from '../../src/shared/types/domain.js';

const folders: string[] = [];

async function createSourceFixture(folder: string, name: string): Promise<string> {
  const path = join(folder, name);
  await writeFile(path, 'source-fixture');
  return path;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const source: MediaInfo = {
  duration: 20,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  sampleRate: 44100,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 1000
};

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

const profile: QualityProfile = {
  id: 'reference',
  name: 'Reference',
  description: '',
  mode: 'custom',
  maxWidth: 1920,
  maxHeight: 1080,
  allowUpscale: true,
  fpsMode: '30',
  customFps: null,
  videoCodec: 'h264',
  encoder: 'libx264',
  crf: 18,
  cq: 20,
  preset: 'veryfast',
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

const job: QueueJob = {
  id: 'job',
  projectId: 'project',
  type: 'normalize',
  status: 'normalizing',
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

describe('NormalizeEngine stream-copy command', () => {
  it('uses -c:v copy when only audio needs normalization', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-normalize-'));
    folders.push(folder);
    const input = await createSourceFixture(folder, 'source.mp4');
    let capturedArgs: string[] = [];
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        capabilities: ['libx264']
      })
    } as unknown as ToolManager;
    const processes = {
      run: async (options: ProcessRunOptions) => {
        capturedArgs = options.args;
        await writeFile(options.args.at(-1)!, 'pending');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;
    const verifier = {
      verify: (path: string) => Promise.resolve({
        ok: true,
        path,
        level: 'standard' as const,
        reasons: [],
        duration: source.duration
      })
    } as unknown as FileVerifier;
    const logger = {
      info: () => undefined,
      warn: () => undefined
    } as unknown as Logger;
    const engine = new NormalizeEngine(
      tools,
      processes,
      {} as MediaAnalyzer,
      verifier,
      {} as QuarantineService,
      logger
    );

    await engine.normalizeToTarget(
      job,
      input,
      source,
      folder,
      target,
      resource,
      new AbortController().signal,
      () => undefined,
      profile
    );

    const videoCodecIndex = capturedArgs.indexOf('-c:v');
    const audioCodecIndex = capturedArgs.indexOf('-c:a');
    expect(capturedArgs[videoCodecIndex + 1]).toBe('copy');
    expect(capturedArgs[audioCodecIndex + 1]).toBe('aac');
    expect(capturedArgs).not.toContain('-crf');
    expect(capturedArgs).not.toContain('-vf');
  });

  it('uses source-average bitrate instead of CRF when the keep-size profile must encode video', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-normalize-'));
    folders.push(folder);
    const input = await createSourceFixture(folder, 'source.mp4');
    let capturedArgs: string[] = [];
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        capabilities: ['libx264']
      })
    } as unknown as ToolManager;
    const processes = {
      run: async (options: ProcessRunOptions) => {
        capturedArgs = options.args;
        await writeFile(options.args.at(-1)!, 'pending');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;
    const verifier = {
      verify: (path: string) => Promise.resolve({
        ok: true,
        path,
        level: 'standard' as const,
        reasons: [],
        duration: source.duration
      })
    } as unknown as FileVerifier;
    const logger = {
      info: () => undefined,
      warn: () => undefined
    } as unknown as Logger;
    const engine = new NormalizeEngine(
      tools,
      processes,
      {} as MediaAnalyzer,
      verifier,
      {} as QuarantineService,
      logger
    );

    await engine.normalizeToTarget(
      job,
      input,
      source,
      folder,
      { ...target, width: 1280, height: 720, videoBitrate: 14_000_000 },
      resource,
      new AbortController().signal,
      () => undefined,
      { ...profile, bitrateMode: 'source_average', preset: 'slow' }
    );

    const bitrateIndex = capturedArgs.indexOf('-b:v');
    expect(capturedArgs[bitrateIndex + 1]).toBe('14000000');
    expect(capturedArgs).toContain('-minrate');
    expect(capturedArgs).toContain('-maxrate');
    expect(capturedArgs).toContain('-bufsize');
    expect(capturedArgs).not.toContain('-crf');
  });

  it('does not upscale a smaller same-ratio source when allowUpscale is false', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-normalize-'));
    folders.push(folder);
    const input = await createSourceFixture(folder, 'source-720p.mp4');
    let capturedArgs: string[] = [];
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        capabilities: ['libx264']
      })
    } as unknown as ToolManager;
    const processes = {
      run: async (options: ProcessRunOptions) => {
        capturedArgs = options.args;
        await writeFile(options.args.at(-1)!, 'pending');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;
    const verifier = {
      verify: (path: string) => Promise.resolve({
        ok: true,
        path,
        level: 'standard' as const,
        reasons: [],
        duration: source.duration
      })
    } as unknown as FileVerifier;
    const logger = {
      info: () => undefined,
      warn: () => undefined
    } as unknown as Logger;
    const engine = new NormalizeEngine(
      tools,
      processes,
      {} as MediaAnalyzer,
      verifier,
      {} as QuarantineService,
      logger
    );

    await engine.normalizeToTarget(
      job,
      input,
      { ...source, width: 1280, height: 720 },
      folder,
      target,
      resource,
      new AbortController().signal,
      () => undefined,
      { ...profile, allowUpscale: false }
    );

    const filterIndex = capturedArgs.indexOf('-vf');
    const filter = capturedArgs[filterIndex + 1] ?? '';
    expect(filter).toContain("min(iw\\,1920)");
    expect(filter).toContain("min(ih\\,1080)");
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=1920:1080');
    expect(filter).not.toContain('force_original_aspect_ratio=increase');
    expect(filter).not.toContain('crop=');
    expect(filter).toContain('setsar=1');
  });

  it('preserves a different aspect ratio with padding instead of cropping content', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-normalize-'));
    folders.push(folder);
    const input = await createSourceFixture(folder, 'source-4x3.mp4');
    let capturedArgs: string[] = [];
    const tools = {
      get: () => ({
        available: true,
        executablePath: 'ffmpeg',
        capabilities: ['libx264']
      })
    } as unknown as ToolManager;
    const processes = {
      run: async (options: ProcessRunOptions) => {
        capturedArgs = options.args;
        await writeFile(options.args.at(-1)!, 'pending');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;
    const verifier = {
      verify: (path: string) => Promise.resolve({
        ok: true,
        path,
        level: 'standard' as const,
        reasons: [],
        duration: source.duration
      })
    } as unknown as FileVerifier;
    const logger = {
      info: () => undefined,
      warn: () => undefined
    } as unknown as Logger;
    const engine = new NormalizeEngine(
      tools,
      processes,
      {} as MediaAnalyzer,
      verifier,
      {} as QuarantineService,
      logger
    );

    await engine.normalizeToTarget(
      job,
      input,
      { ...source, width: 1440, height: 1080 },
      folder,
      target,
      resource,
      new AbortController().signal,
      () => undefined,
      { ...profile, allowUpscale: false }
    );

    const filterIndex = capturedArgs.indexOf('-vf');
    const filter = capturedArgs[filterIndex + 1] ?? '';
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=1920:1080');
    expect(filter).not.toContain('force_original_aspect_ratio=increase');
    expect(filter).not.toContain('crop=');
    expect(filter).toContain('setsar=1');
  });

});
