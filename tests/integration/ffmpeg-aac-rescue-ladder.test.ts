import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../../src/main/processes/process-manager.js';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import { MergeEngine } from '../../src/main/merge/merge-engine.js';
import { TimelineService } from '../../src/main/merge/timeline-service.js';
import { DownloadEngine } from '../../src/main/downloader/download-engine.js';
import { ProcessStalledError } from '../../src/shared/errors/app-errors.js';
import { injectFastAacCoder } from '../../src/shared/utils/ffmpeg-progress.js';
import { defaultAppSettings, builtInQualityProfiles, builtInResourceProfiles } from '../../src/main/settings/defaults.js';
import type { MediaInfo, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const tempDirs: string[] = [];
const activeManagers: ProcessManager[] = [];

afterEach(async () => {
  await Promise.all(activeManagers.splice(0).map((m) => m.shutdown()));
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeSourceMediaInfo(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    duration: 487.48,
    width: 2560,
    height: 1440,
    fps: 30,
    videoCodec: 'hevc',
    videoProfile: 'Main',
    videoLevel: '150',
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    timeBase: '1/30',
    videoExtradataHash: 'SHA256:aaa',
    audioExtradataHash: 'SHA256:bbb',
    videoStreamDuration: 487.48,
    audioStreamDuration: 487.48,
    nominalFps: 30,
    variableFrameRate: false,
    sampleAspectRatio: '1:1',
    displayAspectRatio: '16:9',
    rotation: 0,
    streamStartTime: 0,
    timestampCondition: 'normal',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorSpace: 'bt709',
    colorRange: 'tv',
    hdr: false,
    hdrType: null,
    masteringDisplayMetadata: false,
    audioCodec: 'aac',
    videoBitrate: 9_500_000,
    audioBitrate: 192_000,
    sampleRate: 44_100,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    fileSize: 1_024_000,
    ...overrides
  };
}

const RESOURCE_4_THREADS: ResourceProfile = {
  ...builtInResourceProfiles[0]!,
  normalizeWorkers: 1,
  ffmpegThreads: 4,
  filterThreads: 2,
  filterComplexThreads: 2
};

// Ngưỡng giả lập cho máy CI 4 nhân (GitHub Actions Windows + Defender):
// Khởi tạo lạnh node.exe ESM + ghi tệp 16 KB + đóng pipe dưới tải 4 worker mất tối đa ~150–650 ms,
// nên 1.500 ms chừa biên an toàn > 2,3× cho lượt cứu bình thường; ca treo giữ đứng im 5.000 ms (> 3,3× ngưỡng).
const SIMULATED_STALL_TIMEOUT_MS = 1_500;
const SIMULATED_HANG_HOLD_MS = 5_000;
const INTEGRATION_CASE_TIMEOUT_MS = 60_000;

describe('VIỆC 1 — Thang cứu Bậc 1 (-aac_coder fast) + Bậc 3 khi FFmpeg treo ở bộ mã hóa AAC', () => {
  it('ghép danh sách: lượt thường KHÔNG có -aac_coder bị treo → tự cứu đúng 1 lần bằng -aac_coder fast (giữ nguyên số luồng) → ghép về đích completed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-aac-rescue-merge-'));
    tempDirs.push(root);
    const source1 = join(root, 'Video1_1080p.mp4');
    const source2 = join(root, 'TT131 TA.mp4');
    const tempFolder = join(root, 'temp');
    const outFolder = join(root, 'out');
    const fakeFfmpeg = join(root, 'fake-ffmpeg-aac.mjs');

    await writeFile(source1, 'source-1-clean');
    await writeFile(source2, 'source-2-triggers-twoloop');
    await writeFile(
      fakeFfmpeg,
      `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args.at(-1);
const inputIdx = args.indexOf('-i');
const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : '';
const cAIdx = args.indexOf('-c:a');
const isAacEncode = cAIdx >= 0 && args[cAIdx + 1] === 'aac';
const hasFastCoder = cAIdx >= 0 && args[cAIdx + 2] === '-aac_coder' && args[cAIdx + 3] === 'fast';

// Tái hiện đúng lỗi TT131: mã hóa AAC trên TT131 mà thiếu -aac_coder fast thì kẹt lặp out_time_ms=460940227 (> 3× ngưỡng)
if (inputPath.includes('TT131') && isAacEncode && !hasFastCoder) {
  if (outPath && !outPath.startsWith('-')) writeFileSync(outPath, 'partial-stalled');
  process.stdout.write('out_time_ms=460940227\\nprogress=continue\\n');
  const repeat = setInterval(() => {
    process.stdout.write('out_time_ms=460940227\\nspeed=0.00x\\nprogress=continue\\n');
  }, 100);
  setTimeout(() => {
    clearInterval(repeat);
  }, ${SIMULATED_HANG_HOLD_MS});
} else {
  if (outPath && !outPath.startsWith('-')) writeFileSync(outPath, Buffer.alloc(16384, 9));
  process.stdout.write('out_time_ms=487480000\\nprogress=end\\n');
}
`,
      'utf8'
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const processes = new ProcessManager(logger as never);
    activeManagers.push(processes);
    vi.spyOn(processes, 'setPriority').mockResolvedValue();

    const recordedFfmpegArgs: string[][] = [];
    const realRun = processes.run.bind(processes);
    vi.spyOn(processes, 'run').mockImplementation((opts) => {
      recordedFfmpegArgs.push([...opts.args]);
      return realRun({
        ...opts,
        executablePath: process.execPath,
        args: [fakeFfmpeg, ...opts.args],
        stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS
      });
    });

    const tools = {
      get: vi.fn(() => ({
        name: 'ffmpeg',
        available: true,
        executablePath: process.execPath,
        version: 'N-128433-gdb8537d8cc-20261105',
        source: 'bundled',
        capabilities: ['libx264', 'aac']
      }))
    };
    const info1080 = makeSourceMediaInfo({
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      timeBase: '1/90000',
      duration: 500,
      videoStreamDuration: 500,
      audioStreamDuration: 500
    });
    const info1440 = makeSourceMediaInfo({
      width: 2560,
      height: 1440,
      videoCodec: 'hevc',
      timeBase: '1/30',
      duration: 487.48
    });
    const normalized1440: MediaInfo = {
      ...info1080,
      duration: 487.48,
      videoStreamDuration: 487.48,
      audioStreamDuration: 487.48
    };
    const mergedInfo: MediaInfo = {
      ...info1080,
      duration: 987.48,
      videoStreamDuration: 987.48,
      audioStreamDuration: 987.48,
      fileSize: 2_000_000
    };

    const analyzer = {
      analyze: vi.fn((filePath: string) => {
        if (filePath === source1) return Promise.resolve(info1080);
        if (filePath === source2) return Promise.resolve(info1440);
        if (filePath.includes('_normalized-cache')) {
          return Promise.resolve(filePath.includes('TT131') ? normalized1440 : info1080);
        }
        return Promise.resolve(mergedInfo);
      })
    };
    const verifier = {
      verify: vi.fn((filePath: string) =>
        Promise.resolve({
          ok: true,
          path: filePath,
          level: 'standard',
          reasons: [],
          duration: filePath.includes('_normalized-cache') ? 487.48 : 987.48
        })
      ),
      decodeStreamFailure: vi.fn(() => Promise.resolve(null)),
      verifyVisualIntegrity: vi.fn(() => Promise.resolve({ ok: true, reasons: [], issues: [] }))
    };
    const quarantine = { move: vi.fn(() => Promise.resolve('')) };
    const normalizer = new NormalizeEngine(
      tools as never,
      processes,
      analyzer as never,
      verifier as never,
      quarantine as never,
      logger as never
    );
    const timeline = new TimelineService(analyzer as never);
    const merger = new MergeEngine(
      tools as never,
      processes,
      analyzer as never,
      verifier as never,
      normalizer,
      timeline,
      quarantine as never
    );

    const job = { id: 'merge-rescue-ok', projectId: 'proj-rescue', type: 'merge', input: {} } as QueueJob;
    const mergeResult = await merger.merge(
      job,
      [
        { path: source1, label: 'Video 1', note: '' },
        { path: source2, label: 'TT131 TA.mp4', note: '' }
      ],
      outFolder,
      tempFolder,
      'Duy_Rescue_Test',
      builtInQualityProfiles[0]!,
      RESOURCE_4_THREADS,
      new AbortController().signal,
      true,
      () => undefined
    );

    expect(existsSync(mergeResult.video)).toBe(true);

    // Lượt đầu trên TT131 KHÔNG có -aac_coder; lượt cứu thứ 2 có '-c:a', 'aac', '-aac_coder', 'fast' và GIỮ NGUYÊN -threads 4
    const tt131Calls = recordedFfmpegArgs.filter((a) => a.some((x) => x.includes('TT131 TA.mp4')));
    expect(tt131Calls).toHaveLength(2);
    expect(tt131Calls[0]).not.toContain('-aac_coder');
    const cAIndex = tt131Calls[1]!.indexOf('-c:a');
    expect(tt131Calls[1]!.slice(cAIndex, cAIndex + 4)).toEqual(['-c:a', 'aac', '-aac_coder', 'fast']);
    const threadsIndex = tt131Calls[1]!.indexOf('-threads');
    expect(tt131Calls[1]![threadsIndex + 1]).toBe('4');

    // Nhật ký ghi rõ đã cứu bằng bộ mã hóa tiếng nhanh
    const allLogMessages = [
      ...logger.info.mock.calls.map((c) => String(c[2] ?? '')),
      ...logger.warn.mock.calls.map((c) => String(c[2] ?? ''))
    ].join('\n');
    expect(allLogMessages.toLowerCase()).toContain('đã cứu bằng bộ mã hoá tiếng nhanh');
  }, INTEGRATION_CASE_TIMEOUT_MS);

  it('cả 2 lượt (thường + cứu) đều treo → dừng ở Bậc 3 (tối đa 1 lần cứu, không lặp vô hạn), báo rõ tên video + thay video khác và giữ nguyên bản chuẩn hóa trước đó', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-aac-rescue-both-hang-'));
    tempDirs.push(root);
    const cacheFolder = join(root, '_normalized-cache');
    const source1 = join(root, 'Video1_OK.mp4');
    const source2 = join(root, 'TT131_HongNang.mp4');
    const fakeAlwaysHang = join(root, 'fake-always-hang.mjs');

    await writeFile(source1, 'ok-1');
    await writeFile(source2, 'always-hang');
    await writeFile(
      fakeAlwaysHang,
      `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args.at(-1);
const inIdx = args.indexOf('-i');
const inPath = inIdx >= 0 ? args[inIdx + 1] : '';
if (inPath.includes('TT131_HongNang')) {
  if (outPath && !outPath.startsWith('-')) writeFileSync(outPath, 'partial');
  process.stdout.write('out_time_ms=460940227\\nprogress=continue\\n');
  const repeat = setInterval(() => process.stdout.write('out_time_ms=460940227\\nprogress=continue\\n'), 100);
  setTimeout(() => {
    clearInterval(repeat);
  }, ${SIMULATED_HANG_HOLD_MS});
} else {
  if (outPath && !outPath.startsWith('-')) writeFileSync(outPath, 'ok-normalized');
  process.stdout.write('out_time_ms=120000000\\nprogress=end\\n');
}
`,
      'utf8'
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const processes = new ProcessManager(logger as never);
    activeManagers.push(processes);
    vi.spyOn(processes, 'setPriority').mockResolvedValue();

    let spawnCountOnSource2 = 0;
    const realRun = processes.run.bind(processes);
    vi.spyOn(processes, 'run').mockImplementation((opts) => {
      if (opts.args.some((x) => x.includes('TT131_HongNang'))) spawnCountOnSource2 += 1;
      return realRun({
        ...opts,
        executablePath: process.execPath,
        args: [fakeAlwaysHang, ...opts.args],
        stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS
      });
    });

    const tools = {
      get: vi.fn(() => ({
        name: 'ffmpeg',
        available: true,
        executablePath: process.execPath,
        version: 'N-128433',
        source: 'bundled',
        capabilities: ['libx264', 'aac']
      }))
    };
    const normInfo: MediaInfo = {
      ...makeSourceMediaInfo(),
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      timeBase: '1/90000'
    };
    const analyzer = {
      analyze: vi.fn((p: string) =>
        Promise.resolve(p.includes('_normalized-cache') ? normInfo : makeSourceMediaInfo())
      )
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 487.48 })),
      decodeStreamFailure: vi.fn(() => Promise.resolve(null))
    };
    const quarantine = { move: vi.fn(() => Promise.resolve('')) };
    const normalizer = new NormalizeEngine(
      tools as never,
      processes,
      analyzer as never,
      verifier as never,
      quarantine as never,
      logger as never
    );

    const target: NormalizeTarget = {
      width: 1920,
      height: 1080,
      fps: 30,
      hdr: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      sampleRate: 44_100,
      channels: 2,
      videoBitrate: 9_500_000
    };
    const job = { id: 'job-b3', projectId: 'proj-b3', type: 'merge' } as QueueJob;

    // Video #1 chuẩn hóa xong trước
    const cached1 = await normalizer.normalizeToTarget(
      job,
      source1,
      makeSourceMediaInfo(),
      cacheFolder,
      target,
      RESOURCE_4_THREADS,
      new AbortController().signal,
      () => undefined,
      builtInQualityProfiles[0],
      undefined,
      true,
      true,
      { sourceIndex: 1, sourceLabel: 'Video1_OK.mp4' }
    );
    expect(existsSync(cached1)).toBe(true);

    // Video #2 treo cả 2 lượt → Bậc 3 dừng ngay sau đúng 2 lần gọi (1 thường + 1 cứu)
    let caught: unknown = null;
    try {
      await normalizer.normalizeToTarget(
        job,
        source2,
        makeSourceMediaInfo(),
        cacheFolder,
        target,
        RESOURCE_4_THREADS,
        new AbortController().signal,
        () => undefined,
        builtInQualityProfiles[0],
        undefined,
        true,
        true,
        { sourceIndex: 2, sourceLabel: 'TT131_HongNang.mp4' }
      );
    } catch (error) {
      caught = error;
    }

    expect(spawnCountOnSource2).toBe(2);
    expect(caught).toBeInstanceOf(ProcessStalledError);
    const err = caught as ProcessStalledError;
    expect(err.message).toContain('Video nguồn #2');
    expect(err.message).toContain('TT131_HongNang.mp4');
    expect(err.message).toContain('07:40');
    expect(err.message.toLowerCase()).toContain('thay video');
    expect(existsSync(cached1)).toBe(true);
    const leftoverPending = (await readdir(cacheFolder)).filter((f) => f.includes('.pending'));
    expect(leftoverPending).toEqual([]);
  }, INTEGRATION_CASE_TIMEOUT_MS);

  it('bước tạo bản dựng CapCut (makeCapCutCompatible): treo khi thiếu -aac_coder fast → tự cứu 1 lần thành công; treo cả 2 lượt → dừng sau đúng 2 lần gọi', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-aac-rescue-capcut-'));
    tempDirs.push(root);
    const masterFile = join(root, 'MasterVideo [id1] [LINK_111122223333].mp4');
    const fakeCapCutFfmpeg = join(root, 'fake-capcut-ffmpeg.mjs');
    await writeFile(masterFile, Buffer.alloc(32768, 3));

    let hangBoth = false;
    const modeFile = join(root, 'mode.txt');
    await writeFile(modeFile, 'rescue-works', 'utf8');
    await writeFile(
      fakeCapCutFfmpeg,
      `
import { readFileSync, writeFileSync } from 'node:fs';
const mode = readFileSync(${JSON.stringify(modeFile)}, 'utf8').trim();
const args = process.argv.slice(2);
const outPath = args.at(-1);
const cAIdx = args.indexOf('-c:a');
const hasFast = cAIdx >= 0 && args[cAIdx + 2] === '-aac_coder' && args[cAIdx + 3] === 'fast';
if (mode === 'always-hang' || !hasFast) {
  if (outPath && !outPath.startsWith('-')) writeFileSync(outPath, 'partial');
  process.stdout.write('out_time_ms=15000000\\nprogress=continue\\n');
  const repeat = setInterval(() => process.stdout.write('out_time_ms=15000000\\nprogress=continue\\n'), 100);
  setTimeout(() => {
    clearInterval(repeat);
  }, ${SIMULATED_HANG_HOLD_MS});
} else {
  if (outPath && !outPath.startsWith('-')) writeFileSync(outPath, Buffer.alloc(16384, 5));
  process.stdout.write('out_time_ms=60000000\\nprogress=end\\n');
}
`,
      'utf8'
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const processes = new ProcessManager(logger as never);
    activeManagers.push(processes);
    vi.spyOn(processes, 'setPriority').mockResolvedValue();

    const capcutCalls: string[][] = [];
    const realRun = processes.run.bind(processes);
    vi.spyOn(processes, 'run').mockImplementation((opts) => {
      capcutCalls.push([...opts.args]);
      return realRun({
        ...opts,
        executablePath: process.execPath,
        args: [fakeCapCutFfmpeg, ...opts.args],
        stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS
      });
    });

    const tools = {
      get: vi.fn(() => ({
        name: 'ffmpeg',
        available: true,
        executablePath: process.execPath,
        version: 'N-128433',
        source: 'bundled',
        capabilities: ['h264_nvenc', 'libx264', 'aac']
      }))
    };
    const settingsService = {
      get: () => ({
        ...defaultAppSettings,
        downloadCompatibilityMode: 'capcut_sdr_1080p' as const,
        downloadKeepMasterCopy: true
      })
    };
    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(makeSourceMediaInfo({ duration: 60 })))
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 60 }))
    };
    const quarantine = { move: vi.fn(() => Promise.resolve('')) };
    const downloader = new DownloadEngine(
      processes,
      tools as never,
      {} as never,
      {} as never,
      settingsService as never,
      analyzer as never,
      verifier as never,
      quarantine as never,
      logger as never
    );

    const makeCapCut = (
      downloader as unknown as {
        makeCapCutCompatible: (
          job: QueueJob,
          input: string,
          appSettings: typeof defaultAppSettings,
          resource: ResourceProfile,
          signal: AbortSignal,
          onProgress: () => void,
          forceFaststart: boolean,
          freshDownload?: boolean
        ) => Promise<string>;
      }
    ).makeCapCutCompatible.bind(downloader);

    const dlJob = { id: 'dl-capcut-1', projectId: 'proj-dl', type: 'download', input: {} } as QueueJob;
    const savedPath = await makeCapCut(
      dlJob,
      masterFile,
      {
        ...defaultAppSettings,
        downloadCompatibilityMode: 'capcut_sdr_1080p',
        downloadEditCopyMode: 'capcut_sdr_1080p'
      },
      RESOURCE_4_THREADS,
      new AbortController().signal,
      () => undefined,
      true,
      true
    );
    expect(existsSync(savedPath)).toBe(true);
    expect(capcutCalls).toHaveLength(2);
    expect(capcutCalls[0]).not.toContain('-aac_coder');
    expect(capcutCalls[1]).toContain('-aac_coder');

    // Khi cả 2 lượt đều treo → dừng ngay sau đúng 2 lần gọi (không thử tiếp encoder thứ 2 gây lặp)
    hangBoth = true;
    if (hangBoth) await writeFile(modeFile, 'always-hang', 'utf8');
    capcutCalls.length = 0;
    const masterFile2 = join(root, 'MasterVideo2 [id2] [LINK_444455556666].mp4');
    await writeFile(masterFile2, Buffer.alloc(32768, 4));
    await expect(
      makeCapCut(
        dlJob,
        masterFile2,
        {
          ...defaultAppSettings,
          downloadCompatibilityMode: 'capcut_sdr_1080p',
          downloadEditCopyMode: 'capcut_sdr_1080p'
        },
        RESOURCE_4_THREADS,
        new AbortController().signal,
        () => undefined,
        true,
        true
      )
    ).rejects.toBeInstanceOf(ProcessStalledError);
    expect(capcutCalls).toHaveLength(2);
  }, INTEGRATION_CASE_TIMEOUT_MS);

  it('injectFastAacCoder chèn đúng sau -c:a aac và toàn bộ các điểm mã hóa AAC trong src/main đều được nối thang cứu', async () => {
    expect(injectFastAacCoder(['-c:v', 'libx264', '-c:a', 'aac', '-b:a', '256k'])).toEqual([
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-aac_coder',
      'fast',
      '-b:a',
      '256k'
    ]);
    expect(injectFastAacCoder(['-c:v', 'libx264', '-an'])).toBeNull();
    expect(injectFastAacCoder(['-c:a', 'copy'])).toBeNull();
    expect(injectFastAacCoder(['-c:a', 'aac', '-aac_coder', 'fast', '-b:a', '256k'])).toBeNull();

    const [normSrc, clipSrc, dlSrc, mergeSrc, localCutSrc] = await Promise.all([
      readFile('src/main/normalize/normalize-engine.ts', 'utf8'),
      readFile('src/main/clips/clip-engine.ts', 'utf8'),
      readFile('src/main/downloader/download-engine.ts', 'utf8'),
      readFile('src/main/merge/merge-engine.ts', 'utf8'),
      readFile('src/main/media/local-cut-service.ts', 'utf8')
    ]);
    expect(normSrc).toContain('runFfmpegWithFastAacRescue');
    expect(clipSrc).toContain('runFfmpegWithFastAacRescue');
    expect(dlSrc.match(/runFfmpegWithFastAacRescue/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(mergeSrc).toContain('runFfmpegWithFastAacRescue');
    expect(localCutSrc).toContain('runFfmpegWithFastAacRescue');
  });
});
