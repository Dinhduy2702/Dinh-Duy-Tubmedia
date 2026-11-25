import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClipEngine } from '../../src/main/clips/clip-engine.js';
import { buildLocalCutArguments } from '../../src/main/media/local-cut-command.js';
import { decideQuality, even } from '../../src/shared/utils/quality-decision.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { MediaInfo, ProjectItem, QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

const oddSource: MediaInfo = {
  duration: 10,
  width: 853,
  height: 481,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '3.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 2_000_000,
  audioBitrate: 128_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mp4',
  fileSize: 1024
};

const compatibleProfile: QualityProfile = {
  id: 'compat',
  name: 'Compat',
  description: '',
  mode: 'compatible_1080p',
  allowUpscale: false,
  maxWidth: 1920,
  maxHeight: 1080,
  fpsMode: 'source',
  customFps: null,
  videoCodec: 'h264',
  encoder: 'cpu_auto',
  crf: 18,
  cq: 20,
  preset: 'veryfast',
  pixelFormat: 'yuv420p',
  hdrMode: 'tonemap_sdr',
  audioMode: 'aac_256',
  sampleRate: 48_000,
  forceStereo: true,
  builtIn: true
};

describe('Lỗi #41: chẵn hóa even() kích thước lẻ cho quality-decision, ClipEngine và local-cut-command', () => {
  it('even() chẵn hóa số lẻ và giữ sàn tối thiểu 2', () => {
    expect(even(853)).toBe(852);
    expect(even(481)).toBe(480);
    expect(even(1080)).toBe(1080);
    expect(even(1)).toBe(2);
  });

  it('decideQuality chẵn hóa kích thước lẻ và buộc transcode video thay vì COPY', () => {
    const decision = decideQuality(oddSource, compatibleProfile);
    expect(decision.target.width % 2).toBe(0);
    expect(decision.target.height % 2).toBe(0);
    expect(decision.target.width).toBe(852);
    expect(decision.target.height).toBe(480);
    expect(decision.action).toBe('VIDEO_TRANSCODE_ONLY');
  });

  it('buildLocalCutArguments (accurateCut=true) thêm scale chẵn hóa khi nguồn có kích thước lẻ', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\odd.mp4',
      startSeconds: 0,
      endSeconds: 5,
      accurateCut: true,
      aspectRatio: 'original',
      outputPath: 'C:\\out.mp4',
      sourceWidth: 853,
      sourceHeight: 481
    });
    const vfIndex = args.indexOf('-vf');
    expect(vfIndex).toBeGreaterThanOrEqual(0);
    expect(args[vfIndex + 1]).toContain('scale=852:480');
  });

  it('ClipEngine thêm scale chẵn hóa vào -vf khi nguồn có kích thước lẻ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-41-clip-'));
    folders.push(root);
    const input = join(root, 'odd.mp4');
    await writeFile(input, 'odd');

    let capturedArgs: string[] = [];
    const processes = {
      run: async (opts: ProcessRunOptions) => {
        capturedArgs = opts.args;
        await writeFile(opts.args.at(-1)!, 'clipped');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 5 })
    } as unknown as FileVerifier;

    const analyzer = {
      analyze: () => Promise.resolve(oddSource)
    } as unknown as MediaAnalyzer;

    const engine = new ClipEngine(
      { get: () => ({ available: true, executablePath: 'ffmpeg', capabilities: ['libx264'] }) } as unknown as ToolManager,
      processes,
      verifier,
      {} as QuarantineService,
      analyzer
    );

    await engine.create(
      { id: 'job-41', projectId: 'proj-41' } as QueueJob,
      { id: 'item-41', position: 1, timestampStartSeconds: 0, timestampEndSeconds: 5, audioMode: 'keep' } as ProjectItem,
      input,
      root,
      { ffmpegThreads: 4, filterThreads: 2, processPriority: 'below_normal' } as ResourceProfile,
      new AbortController().signal,
      () => undefined
    );

    const vfIndex = capturedArgs.indexOf('-vf');
    expect(vfIndex).toBeGreaterThanOrEqual(0);
    expect(capturedArgs[vfIndex + 1]).toContain('scale=852:480');
  });
});
