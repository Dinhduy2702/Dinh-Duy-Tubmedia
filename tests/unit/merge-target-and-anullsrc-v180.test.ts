import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAnullsrcInput,
  chooseMergeTarget,
  clampAacChannels
} from '../../src/shared/utils/merge-target.js';
import { NormalizeEngine } from '../../src/main/normalize/normalize-engine.js';
import { builtInQualityProfiles, builtInResourceProfiles } from '../../src/main/settings/defaults.js';
import type { MediaInfo, QualityProfile, QueueJob } from '../../src/shared/types/domain.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

const makeInfo = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  duration: 10,
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
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 1_000_000,
  ...overrides
});

const makeProfile = (mode: QualityProfile['mode']): QualityProfile => ({
  id: `prof-${mode}`,
  name: mode,
  description: '',
  mode,
  allowUpscale: false,
  maxWidth: null,
  maxHeight: null,
  fpsMode: 'source',
  customFps: null,
  videoCodec: 'copy',
  encoder: 'cpu_auto',
  crf: 18,
  cq: 20,
  preset: 'veryfast',
  pixelFormat: 'yuv420p',
  hdrMode: 'auto',
  audioMode: 'copy_if_compatible',
  sampleRate: 48_000,
  forceStereo: false,
  builtIn: false
});

describe('Lỗi #43: kẹp kênh AAC hợp lệ, giữ dominant cho highest_source và :d=${duration} cho anullsrc', () => {
  it('clampAacChannels kẹp về tập kênh AAC hợp lệ (1, 2, 6, 8)', () => {
    expect(clampAacChannels(1)).toBe(1);
    expect(clampAacChannels(2)).toBe(2);
    expect(clampAacChannels(3)).toBe(6);
    expect(clampAacChannels(4)).toBe(6);
    expect(clampAacChannels(5)).toBe(6);
    expect(clampAacChannels(6)).toBe(6);
    expect(clampAacChannels(7)).toBe(8);
    expect(clampAacChannels(10)).toBe(8);
    expect(clampAacChannels(0)).toBe(2);
    expect(clampAacChannels(null)).toBe(2);
  });

  it('chooseMergeTarget kẹp số kênh lẻ/vượt ngưỡng của dominant về kênh AAC hợp lệ', () => {
    const quadSource = makeInfo({ channels: 4, channelLayout: 'quad' });
    const target = chooseMergeTarget([quadSource], makeProfile('smart_merge'));
    expect(target.channels).toBe(6);
  });

  it('chooseMergeTarget giữ chuẩn dominant cho mode highest_source', () => {
    const dominantClip = makeInfo({
      duration: 120,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'hevc',
      sampleRate: 44_100,
      channels: 2
    });
    const outlierClip = makeInfo({
      duration: 5,
      width: 3840,
      height: 2160,
      fps: 60,
      videoCodec: 'h264',
      sampleRate: 48_000,
      channels: 2
    });

    const target = chooseMergeTarget([dominantClip, outlierClip], makeProfile('highest_source'));
    expect(target).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'hevc'
    });
  });

  it('buildAnullsrcInput và NormalizeEngine gắn :d=${duration} và đúng channel_layout cho anullsrc', async () => {
    expect(buildAnullsrcInput(6, 48_000, 12.5)).toBe('anullsrc=channel_layout=5.1:sample_rate=48000:d=12.5');
    expect(buildAnullsrcInput(1, 44_100, 7)).toBe('anullsrc=channel_layout=mono:sample_rate=44100:d=7');

    const root = await mkdtemp(join(tmpdir(), 'tubmedia-43-anullsrc-'));
    folders.push(root);
    const input = join(root, 'silent.mp4');
    await writeFile(input, 'video');

    let capturedArgs: string[] = [];
    const processes = {
      run: vi.fn(async (opts: { args: string[] }) => {
        capturedArgs = opts.args;
        await writeFile(opts.args.at(-1)!, 'norm');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      })
    };
    const tools = {
      get: () => ({
        name: 'ffmpeg',
        available: true,
        executablePath: 'ffmpeg.exe',
        version: '8.0',
        capabilities: ['libx264', 'aac']
      })
    };
    const verifier = {
      verify: () => Promise.resolve({ ok: true, reasons: [], duration: 12.5 }),
      decodeStreamFailure: () => Promise.resolve(null)
    };
    const engine = new NormalizeEngine(
      tools as never,
      processes as never,
      {} as never,
      verifier as never,
      { move: vi.fn() } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never
    );

    const now = new Date().toISOString();
    const job: QueueJob = {
      id: 'job-43',
      projectId: 'proj-43',
      type: 'normalize',
      status: 'normalizing',
      priority: 1,
      sourceId: 'src-43',
      itemId: 'item-43',
      input: {},
      progress: 0,
      speed: null,
      etaSeconds: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null
    };

    await engine.normalizeToTarget(
      job,
      input,
      makeInfo({ duration: 12.5, audioCodec: null, sampleRate: null, channels: null, channelLayout: null }),
      root,
      {
        width: 1920,
        height: 1080,
        fps: 30,
        hdr: false,
        videoCodec: 'h264',
        pixelFormat: 'yuv420p',
        audioCodec: 'aac',
        sampleRate: 48_000,
        channels: 6
      },
      builtInResourceProfiles[0]!,
      new AbortController().signal,
      () => undefined,
      builtInQualityProfiles[0]
    );

    const lavfiArg = capturedArgs.find((arg) => arg.startsWith('anullsrc='));
    expect(lavfiArg).toBe('anullsrc=channel_layout=5.1:sample_rate=48000:d=12.5');
  });
});
