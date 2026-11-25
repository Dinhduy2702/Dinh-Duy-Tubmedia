import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MergeEngine } from '../../src/main/merge/merge-engine.js';
import { ClipEngine } from '../../src/main/clips/clip-engine.js';
import { buildLocalCutArguments } from '../../src/main/media/local-cut-command.js';
import type { FileVerifier, VerificationOptions } from '../../src/main/media/file-verifier.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { MediaInfo, ProjectItem, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

const hdrSource: MediaInfo = {
  duration: 25,
  width: 3840,
  height: 2160,
  fps: 60,
  videoCodec: 'hevc',
  videoProfile: 'Main 10',
  videoLevel: '153',
  pixelFormat: 'yuv420p10le',
  bitDepth: 10,
  timeBase: '1/90000',
  colorPrimaries: 'bt2020',
  colorTransfer: 'smpte2084',
  colorSpace: 'bt2020nc',
  colorRange: 'tv',
  hdr: true,
  hdrType: 'hdr10',
  audioCodec: 'aac',
  videoBitrate: 20_000_000,
  audioBitrate: 256_000,
  sampleRate: 48000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 10_000_000
};

describe('Lỗi #19: kiểm tra thật khi tái sử dụng [9x16] và tonemap HDR->SDR trước libx264', () => {
  it('applyAspectRatio kiểm tra duration + audio + mtime nguồn trước khi tái sử dụng bản [9x16] có sẵn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-19-reuse-'));
    roots.push(root);
    const productFolder = join(root, 'Thanh-pham');
    await mkdir(productFolder, { recursive: true });
    const inputPath = join(productFolder, 'Thanh-pham.mp4');
    const existing9x16 = join(productFolder, 'Thanh-pham [9x16].mp4');

    // Bản [9x16] cũ hơn nguồn (mtime cũ hơn) -> KHÔNG được tái sử dụng
    await writeFile(existing9x16, 'ban-cu-bi-cut');
    await utimes(existing9x16, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    await writeFile(inputPath, 'nguon-moi-hon');

    const verifyCalls: Array<{ expectedDuration: number | undefined; options: VerificationOptions | undefined }> = [];
    const processes = {
      run: vi.fn(async (opts: ProcessRunOptions) => {
        await writeFile(opts.args.at(-1)!, 'moi-xuat');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      })
    } as unknown as ProcessManager;

    const tools = {
      get: () => ({ name: 'ffmpeg', available: true, executablePath: 'ffmpeg', capabilities: ['libx264', 'zscale', 'tonemap'] })
    } as unknown as ToolManager;

    const analyzer = {
      analyze: vi.fn(() => Promise.resolve({ duration: 25, audioCodec: 'aac', hdr: false, pixelFormat: 'yuv420p', width: 1920, height: 1080 }))
    } as unknown as MediaAnalyzer;

    const verifier = {
      verify: vi.fn((path: string, _level: string, expectedDuration?: number, options?: VerificationOptions) => {
        verifyCalls.push({ expectedDuration, options });
        return Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 25 });
      })
    } as unknown as FileVerifier;

    const engine = new MergeEngine(tools, processes, analyzer, verifier, {} as never, {} as never, {} as never);
    await engine.applyAspectRatio(
      'job-19',
      inputPath,
      '9:16',
      productFolder,
      'Thanh-pham',
      { processPriority: 'below_normal' } as ResourceProfile,
      new AbortController().signal,
      () => undefined
    );

    // Vì bản cũ có mtime nhỏ hơn nguồn nên phải chạy lại ffmpeg thay vì tái sử dụng
    expect(processes.run).toHaveBeenCalledTimes(1);
    expect(verifyCalls.every((c) => c.expectedDuration === 25 && c.options?.expectedStreams?.audio === true)).toBe(true);
  });

  it('applyAspectRatio tonemap HDR (yuv420p10le/bt2020) về SDR bt709 yuv420p trước libx264', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-19-hdr-aspect-'));
    roots.push(root);
    const productFolder = join(root, 'HDR');
    await mkdir(productFolder, { recursive: true });
    const inputPath = join(productFolder, 'HDR.mp4');
    await writeFile(inputPath, 'hdr-video');

    let capturedArgs: string[] = [];
    const processes = {
      run: vi.fn(async (opts: ProcessRunOptions) => {
        capturedArgs = opts.args;
        await writeFile(opts.args.at(-1)!, 'sdr-9x16');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      })
    } as unknown as ProcessManager;

    const tools = {
      get: () => ({ name: 'ffmpeg', available: true, executablePath: 'ffmpeg', capabilities: ['libx264', 'zscale', 'tonemap'] })
    } as unknown as ToolManager;

    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(hdrSource))
    } as unknown as MediaAnalyzer;

    const verifier = {
      verify: vi.fn((path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 25 }))
    } as unknown as FileVerifier;

    const engine = new MergeEngine(tools, processes, analyzer, verifier, {} as never, {} as never, {} as never);
    await engine.applyAspectRatio(
      'job-19-hdr',
      inputPath,
      '9:16',
      productFolder,
      'HDR',
      { processPriority: 'below_normal' } as ResourceProfile,
      new AbortController().signal,
      () => undefined
    );

    const fc = capturedArgs[capturedArgs.indexOf('-filter_complex') + 1] ?? '';
    expect(fc).toContain('tonemap=hable');
    expect(fc).toContain('zscale=p=bt709:t=bt709:m=bt709:r=tv');
    expect(capturedArgs[capturedArgs.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(capturedArgs[capturedArgs.indexOf('-color_primaries') + 1]).toBe('bt709');
  });

  it('buildLocalCutArguments tonemap HDR về SDR bt709 yuv420p khi hdrToSdr = true', () => {
    const accurateArgs = buildLocalCutArguments({
      filePath: 'hdr.mp4',
      startSeconds: 0,
      endSeconds: 10,
      accurateCut: true,
      aspectRatio: 'original',
      outputPath: 'out.mp4',
      hdrToSdr: true
    });
    const vf = accurateArgs[accurateArgs.indexOf('-vf') + 1] ?? '';
    expect(vf).toContain('tonemap=hable');
    expect(accurateArgs[accurateArgs.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(accurateArgs[accurateArgs.indexOf('-color_primaries') + 1]).toBe('bt709');

    const ratioArgs = buildLocalCutArguments({
      filePath: 'hdr.mp4',
      startSeconds: 0,
      endSeconds: 10,
      accurateCut: true,
      aspectRatio: '9:16',
      outputPath: 'out-9x16.mp4',
      hdrToSdr: true
    });
    const fc = ratioArgs[ratioArgs.indexOf('-filter_complex') + 1] ?? '';
    expect(fc).toContain('tonemap=hable');
    expect(ratioArgs[ratioArgs.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
  });

  it('ClipEngine tonemap HDR về SDR bt709 yuv420p trước libx264 khi cắt đoạn nguồn HDR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-19-clip-hdr-'));
    roots.push(root);
    const input = join(root, 'hdr.mp4');
    await writeFile(input, 'hdr-source');

    let capturedArgs: string[] = [];
    const processes = {
      run: async (opts: ProcessRunOptions) => {
        capturedArgs = opts.args;
        await writeFile(opts.args.at(-1)!, 'clipped-sdr');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    const verifier = {
      verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard' as const, reasons: [], duration: 5 })
    } as unknown as FileVerifier;

    const analyzer = {
      analyze: () => Promise.resolve(hdrSource)
    } as unknown as MediaAnalyzer;

    const engine = new ClipEngine(
      { get: () => ({ available: true, executablePath: 'ffmpeg', capabilities: ['libx264', 'zscale', 'tonemap'] }) } as unknown as ToolManager,
      processes,
      verifier,
      {} as QuarantineService,
      analyzer
    );

    const item = {
      id: 'item-19-hdr',
      position: 1,
      timestampStartSeconds: 2,
      timestampEndSeconds: 7,
      audioMode: 'keep'
    } as ProjectItem;

    await engine.create(
      { id: 'job-19-clip', projectId: 'proj-19' } as QueueJob,
      item,
      input,
      root,
      { ffmpegThreads: 4, filterThreads: 2, processPriority: 'below_normal' } as ResourceProfile,
      new AbortController().signal,
      () => undefined
    );

    const vf = capturedArgs[capturedArgs.indexOf('-vf') + 1] ?? '';
    expect(vf).toContain('tonemap=hable');
    expect(capturedArgs[capturedArgs.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(capturedArgs[capturedArgs.indexOf('-color_primaries') + 1]).toBe('bt709');
  });
});
