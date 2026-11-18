import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { builtInResourceProfiles } from '../../src/main/settings/defaults.js';
import {
  effectiveMergeWorkflowCap,
  withMachineMergeWorkers,
  withMachineThreads
} from '../../src/shared/utils/machine-threads.js';
import { buildLocalCutArguments } from '../../src/main/media/local-cut-command.js';
import { buildSceneDetectArguments, buildSilenceDetectArguments } from '../../src/main/media/cut-suggestion.js';
import { FileVerifier } from '../../src/main/media/file-verifier.js';
import { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import { MergeEngine } from '../../src/main/merge/merge-engine.js';
import type { ProcessRunOptions } from '../../src/main/processes/process-manager.js';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

function expectSingleThreadFlags(args: readonly string[]): void {
  const idxT = args.indexOf('-threads');
  const idxFt = args.indexOf('-filter_threads');
  const idxFct = args.indexOf('-filter_complex_threads');
  expect(idxT).toBeGreaterThanOrEqual(0);
  expect(args[idxT + 1]).toBe('1');
  expect(idxFt).toBeGreaterThanOrEqual(0);
  expect(args[idxFt + 1]).toBe('1');
  expect(idxFct).toBeGreaterThanOrEqual(0);
  expect(args[idxFct + 1]).toBe('1');
}

describe('V4 — Co worker Ghép/Chuẩn hoá theo máy yếu + HDD & truyền đủ -threads cho Kiểm tệp / Đổi tỉ lệ / Cắt lẻ', () => {
  it('máy <= 4 luồng hoặc ổ HDD tự co mergeWorkflowCap = 1 và normalize/remux/analyze/clip workers = 1; máy 8 luồng SSD giữ analyzeWorkers <= 2', () => {
    const interactive = builtInResourceProfiles.find((p) => p.id === 'resource-interactive')!;

    expect(effectiveMergeWorkflowCap(2, 2, false)).toBe(1);
    expect(effectiveMergeWorkflowCap(2, 4, false)).toBe(1);
    expect(effectiveMergeWorkflowCap(3, 16, true)).toBe(1);
    expect(effectiveMergeWorkflowCap(2, 16, false)).toBe(2);

    for (const [cpus, hdd] of [
      [2, false],
      [4, false],
      [16, true]
    ] as const) {
      const clamped = withMachineMergeWorkers(interactive, cpus, hdd);
      expect(clamped.normalizeWorkers).toBe(1);
      expect(clamped.remuxWorkers).toBe(1);
      expect(clamped.analyzeWorkers).toBe(1);
      expect(clamped.clipWorkers).toBe(1);
    }

    const mid8 = withMachineMergeWorkers(interactive, 8, false);
    expect(mid8.analyzeWorkers).toBeLessThanOrEqual(2);

    const strong16 = withMachineMergeWorkers(interactive, 16, false);
    expect(strong16.normalizeWorkers).toBe(interactive.normalizeWorkers);
    expect(strong16.analyzeWorkers).toBe(interactive.analyzeWorkers);
  });

  it('applyAspectRatio, verifyVisualIntegrity, verify("deep"), buildLocalCutArguments, cut-suggestion trên máy 2 luồng đều có -threads 1 -filter_threads 1 -filter_complex_threads 1 và MediaAnalyzer chạy below_normal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-v4-threads-'));
    folders.push(root);
    const outDir = join(root, 'out');
    await mkdir(outDir, { recursive: true });
    const samplePath = join(root, 'in.mp4');
    await writeFile(samplePath, 'fake-mp4-bytes', 'utf8');

    // 1) buildLocalCutArguments & cut-suggestion trên máy 2 luồng
    const cut916 = buildLocalCutArguments({
      filePath: samplePath,
      startSeconds: 0,
      endSeconds: 5,
      accurateCut: false,
      aspectRatio: '9:16',
      outputPath: join(outDir, 'cut.mp4'),
      logicalCpus: 2
    });
    expectSingleThreadFlags(cut916);
    expectSingleThreadFlags(buildSceneDetectArguments(samplePath, 2));
    expectSingleThreadFlags(buildSilenceDetectArguments(samplePath, 2));

    // 2) MediaAnalyzer.analyze đặt priority = 'below_normal'
    const capturedAnalyzerOpts: ProcessRunOptions[] = [];
    const analyzer = new MediaAnalyzer(
      {
        run: (opts: ProcessRunOptions) => {
          capturedAnalyzerOpts.push(opts);
          return Promise.resolve({
            code: 0,
            stdoutTail: JSON.stringify({
              streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', avg_frame_rate: '30/1', time_base: '1/90000', pix_fmt: 'yuv420p' }],
              format: { duration: '5.0', size: '10240', format_name: 'mov,mp4' }
            }),
            stderrTail: '',
            durationMs: 1
          });
        }
      } as never,
      { get: () => ({ available: true, executablePath: join(root, 'ffprobe.exe') }) } as never
    );
    await analyzer.analyze(samplePath, 'job-an');
    expect(capturedAnalyzerOpts[0]?.priority).toBe('below_normal');

    // 3) FileVerifier verifyVisualIntegrity & verify('deep') trên máy 2 luồng
    const capturedVerifierOpts: ProcessRunOptions[] = [];
    const verifier = new FileVerifier(
      analyzer,
      {
        run: (opts: ProcessRunOptions) => {
          capturedVerifierOpts.push(opts);
          opts.onStdoutLine?.('out_time_ms=5000000');
          return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 });
        }
      } as never,
      { get: () => ({ available: true, executablePath: join(root, 'ffmpeg.exe') }) } as never
    );

    await verifier.verifyVisualIntegrity(samplePath, 5, [], { jobId: 'jv', logicalCpus: 2 });
    expectSingleThreadFlags(capturedVerifierOpts[0]!.args);
    expect(capturedVerifierOpts[0]!.priority).toBe('below_normal');

    capturedVerifierOpts.length = 0;
    await verifier.verify(samplePath, 'deep', 5, { jobId: 'jd', logicalCpus: 2 });
    expectSingleThreadFlags(capturedVerifierOpts[0]!.args);
    expect(capturedVerifierOpts[0]!.priority).toBe('below_normal');

    // 4) MergeEngine.applyAspectRatio trên máy 2 luồng
    const capturedMergeOpts: ProcessRunOptions[] = [];
    const mergeEngine = new MergeEngine(
      { get: () => ({ available: true, executablePath: join(root, 'ffmpeg.exe') }) } as never,
      {
        run: async (opts: ProcessRunOptions) => {
          capturedMergeOpts.push(opts);
          await writeFile(opts.args.at(-1)!, 'aspect-bytes', 'utf8');
          opts.onStdoutLine?.('out_time_ms=5000000');
          return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
        }
      } as never,
      analyzer,
      {
        verify: (() => {
          let n = 0;
          return () => {
            n += 1;
            return Promise.resolve({ ok: n > 1, reasons: [], duration: 5 });
          };
        })()
      } as never,
      {} as never,
      {} as never,
      {} as never
    );
    const twoThreadResource = withMachineThreads(
      builtInResourceProfiles.find((p) => p.id === 'resource-interactive')!,
      2
    );
    await mergeEngine.applyAspectRatio(
      'jm',
      samplePath,
      '9:16',
      outDir,
      'Thanh-pham',
      twoThreadResource,
      new AbortController().signal,
      () => undefined
    );
    expectSingleThreadFlags(capturedMergeOpts[0]!.args);
  });
});
