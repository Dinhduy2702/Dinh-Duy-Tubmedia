import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { buildLocalCutArguments } from '../../src/main/media/local-cut-command.js';
import { LocalCutService } from '../../src/main/media/local-cut-service.js';
import { FileVerifier } from '../../src/main/media/file-verifier.js';
import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import type { MediaInfo } from '../../src/shared/types/domain.js';

const roots: string[] = [];

function fakeMediaInfo(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    duration: 30,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    videoProfile: 'High',
    videoLevel: '4.1',
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    timeBase: '1/15360',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorSpace: 'bt709',
    hdr: false,
    audioCodec: 'aac',
    videoBitrate: 4_000_000,
    audioBitrate: 128_000,
    sampleRate: 48_000,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mp4',
    fileSize: 1024,
    ...overrides
  };
}

async function waitForLocalCutTerminal(service: LocalCutService, taskId: string) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const status = service.status(taskId);
    if (status && ['completed', 'cancelled', 'failed'].includes(status.phase)) return status;
    if (Date.now() > deadline) throw new Error('Quá thời gian chờ LocalCutService.');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('Lỗi #20: local-cut, quick-download range và cut-suggestion nguồn không tiếng', () => {
  it('buildLocalCutArguments (sao chép nhanh): dùng -map 0:v:0 -map 0:a:0? -avoid_negative_ts make_zero thay cho -map 0', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 5,
      endSeconds: 15,
      accurateCut: false,
      aspectRatio: 'original',
      outputPath: 'C:\\out.mp4'
    });

    const mapIndices = args
      .map((arg, index) => (arg === '-map' ? args[index + 1] : null))
      .filter((value): value is string => value !== null);
    expect(mapIndices).toEqual(['0:v:0', '0:a:0?']);
    expect(args).toContain('-avoid_negative_ts');
    expect(args[args.indexOf('-avoid_negative_ts') + 1]).toBe('make_zero');
  });

  it('FileVerifier.verify: nới dung sai thời lượng +15s khi có durationToleranceExtraSeconds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-fv-tol-'));
    roots.push(root);
    const file = join(root, 'clip.mp4');
    await writeFile(file, 'fake');

    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(fakeMediaInfo({ duration: 22 })))
    };
    const processes = {
      run: vi.fn(() => Promise.resolve({ code: 0, stdoutTail: '1.0,100\n', stderrTail: '', durationMs: 1 }))
    };
    const tools = {
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };
    const verifier = new FileVerifier(analyzer as never, processes as never, tools as never);

    const strictResult = await verifier.verify(file, 'standard', 10, {
      expectedStreams: { video: true, audio: true }
    });
    expect(strictResult.ok).toBe(false);

    const relaxedResult = await verifier.verify(file, 'standard', 10, {
      expectedStreams: { video: true, audio: true },
      durationToleranceExtraSeconds: 15
    });
    expect(relaxedResult.ok).toBe(true);
  });

  it('LocalCutService.run: cắt nhanh kiểm audio theo sourceInfo và nới dung sai +15s; nguồn không tiếng không đòi audio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-lc-20-'));
    roots.push(root);
    const outDir = join(root, 'out');
    await mkdir(outDir, { recursive: true });
    const src = join(root, 'src.mp4');
    await writeFile(src, 'video');

    const processes = {
      run: vi.fn(async (opts: { args: string[] }) => {
        await writeFile(opts.args.at(-1)!, 'cut');
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }),
      hasJob: vi.fn(() => false)
    };
    const tools = {
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };
    const verifyMock = vi.fn<
      (
        path: string,
        level: string,
        duration?: number,
        options?: { expectedStreams?: { video: boolean; audio: boolean }; durationToleranceExtraSeconds?: number }
      ) => Promise<{ ok: boolean; reasons: string[]; duration: number }>
    >(() => Promise.resolve({ ok: true, reasons: [], duration: 10 }));
    const verifier = { verify: verifyMock };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const serviceWithAudio = new LocalCutService(
      processes as never,
      tools as never,
      verifier as never,
      logger as never,
      () => Promise.resolve(30),
      () => Promise.resolve(fakeMediaInfo({ audioCodec: 'aac' }))
    );
    const fast = await serviceWithAudio.start({
      filePath: src,
      outputDirectory: outDir,
      startTime: '0',
      endTime: '10',
      accurateCut: false
    });
    await waitForLocalCutTerminal(serviceWithAudio, fast.taskId);
    expect(verifyMock).toHaveBeenLastCalledWith(
      expect.any(String),
      'standard',
      10,
      expect.objectContaining({
        expectedStreams: { video: true, audio: true },
        durationToleranceExtraSeconds: 15
      })
    );

    const serviceSilent = new LocalCutService(
      processes as never,
      tools as never,
      verifier as never,
      logger as never,
      () => Promise.resolve(30),
      () => Promise.resolve(fakeMediaInfo({ audioCodec: null, channels: null, sampleRate: null, channelLayout: null }))
    );
    const accurate = await serviceSilent.start({
      filePath: src,
      outputDirectory: outDir,
      startTime: '0',
      endTime: '10',
      accurateCut: true
    });
    await waitForLocalCutTerminal(serviceSilent, accurate.taskId);
    const lastOpts = verifyMock.mock.calls.at(-1)?.[3];
    expect(lastOpts?.expectedStreams).toEqual({ video: true, audio: false });
    expect(lastOpts?.durationToleranceExtraSeconds).toBeUndefined();
  });

  it('QuickDownloadService (range, accurateCut=false): nới dung sai +15s khi kiểm tra file đầu ra', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-qd-range-20-'));
    roots.push(root);
    const outDir = join(root, 'out');
    await mkdir(outDir, { recursive: true });

    const processes = {
      run: vi.fn(async (opts: { onStdoutLine?: (line: string) => void }) => {
        const file = join(outDir, 'Clip [id] [00-10-00-20] [QD-test].mp4');
        await writeFile(file, 'clip');
        opts.onStdoutLine?.(`TUBMEDIA_FILE|${file}`);
        return { code: 0, stdoutTail: '', stderrTail: '' };
      }),
      hasJob: vi.fn(() => false),
      pauseByJob: vi.fn(() => Promise.resolve()),
      resumeByJob: vi.fn(() => Promise.resolve()),
      killByJob: vi.fn(() => Promise.resolve())
    };
    const tools = {
      ensureRequiredReady: vi.fn(() => Promise.resolve([])),
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 15 }))
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = new QuickDownloadService(
      processes as never,
      tools as never,
      verifier as never,
      logger as never,
      join(root, 'state')
    );

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      outputDirectory: outDir,
      quality: 'best',
      mediaMode: 'video-audio',
      mode: 'range',
      startTime: '00:10',
      endTime: '00:20',
      accurateCut: false,
      embedCredit: false
    });
    await vi.waitFor(() => {
      expect(['completed', 'failed']).toContain(service.status(started.taskId)?.phase);
    }, { timeout: 5000 });

    expect(service.status(started.taskId)?.phase).toBe('completed');
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.any(String),
      'standard',
      10,
      expect.objectContaining({ durationToleranceExtraSeconds: 15 })
    );
  });

  it('LocalCutService.suggestCutPoints: bỏ qua silencedetect sang scdet khi nguồn không có âm thanh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-suggest-silent-'));
    roots.push(root);
    const src = join(root, 'silent.mp4');
    await writeFile(src, 'video');

    const calledJobs: string[] = [];
    const processes = {
      run: vi.fn((opts: { jobId: string; onStderrLine?: (line: string) => void }) => {
        calledJobs.push(opts.jobId);
        if (opts.jobId.startsWith('cut-suggest-silence-')) {
          return Promise.resolve({
            code: 1,
            stdoutTail: '',
            stderrTail: 'Output file #0 does not contain any stream',
            durationMs: 1
          });
        }
        opts.onStderrLine?.('  Duration: 00:00:20.00, start: 0.000000, bitrate: 100 kb/s');
        opts.onStderrLine?.('[Parsed_showinfo_1 @ 0000] n: 0 pts_time:8.5 fmt:yuv420p');
        return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 });
      }),
      hasJob: vi.fn(() => false)
    };
    const tools = {
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };
    const verifier = { verify: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new LocalCutService(
      processes as never,
      tools as never,
      verifier as never,
      logger as never,
      undefined,
      () => Promise.resolve(fakeMediaInfo({ duration: 20, audioCodec: null, channels: null, sampleRate: null, channelLayout: null }))
    );

    const suggestions = await service.suggestCutPoints(src);
    expect(calledJobs.some((id) => id.startsWith('cut-suggest-silence-'))).toBe(false);
    expect(calledJobs.some((id) => id.startsWith('cut-suggest-scene-'))).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]).toMatchObject({ startSeconds: 8.5, endSeconds: 20, startReason: 'scene', endReason: 'edge' });
  });
});
