import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../../src/main/processes/process-manager.js';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import { ProcessStalledError } from '../../src/shared/errors/app-errors.js';
import {
  FFMPEG_FASTSTART_FINALIZE_STALL_TIMEOUT_MS,
  FFMPEG_PROGRESS_STALL_TIMEOUT_MS,
  parseFfmpegOutTimeSeconds
} from '../../src/shared/utils/ffmpeg-progress.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { failureReasonLabel } from '../../src/shared/utils/failure-reason.js';
import type { MediaInfo, QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const tempDirs: string[] = [];
const managedManagers: ProcessManager[] = [];
const activeSignalGates: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(activeSignalGates.splice(0).map((close) => close()));
  await Promise.all(managedManagers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Dùng cổng TCP loopback 127.0.0.1 thay vì fs.watch + watcher.close() + process.exit(0):
// Trên Node 24 Windows Server CI, gọi watcher.close() rồi process.exit(0) ngay trong callback fs.watch
// làm nổ libuv UV_HANDLE_CLOSING (__fastfail 0xC0000409 = 3221226505). Đóng socket tự nhiên tránh hoàn toàn lỗi này.
async function createLoopbackSignalGate(): Promise<{ port: number; release: () => void }> {
  const sockets = new Set<Socket>();
  let released = false;
  const server = createServer((socket) => {
    if (released) {
      socket.end('go\n');
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  activeSignalGates.push(
    () =>
      new Promise<void>((resolveClose) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        if (!server.listening) {
          resolveClose();
          return;
        }
        server.close(() => resolveClose());
      })
  );
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    release: () => {
      if (released) return;
      released = true;
      for (const socket of sockets) socket.end('go\n');
      sockets.clear();
      server.close();
    }
  };
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeFakeMediaInfo(duration = 487.48, fileSize = 1_000_000): MediaInfo {
  return {
    duration,
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
    videoStreamDuration: duration,
    audioStreamDuration: duration,
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
    fileSize
  };
}

const TARGET_1080P: NormalizeTarget = {
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

const RESOURCE_PROFILE: ResourceProfile = {
  id: 'resource-test',
  name: 'Test',
  description: '',
  downloadWorkers: 2,
  analyzeWorkers: 1,
  normalizeWorkers: 1,
  remuxWorkers: 1,
  clipWorkers: 1,
  ffmpegThreads: 2,
  filterThreads: 1,
  filterComplexThreads: 1,
  processPriority: 'below_normal',
  cpuSoftLimitPercent: 85,
  memoryFreeMinimumBytes: 512 * 1024 * 1024,
  diskFreeMinimumBytes: 1024 * 1024 * 1024,
  gpuJobs: 0,
  builtIn: false
};

const QUALITY_PROFILE: QualityProfile = {
  id: 'quality-source-size',
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
  bitrateMode: 'source_average',
  preset: 'veryfast',
  pixelFormat: 'yuv420p',
  hdrMode: 'auto',
  audioMode: 'copy_if_compatible',
  sampleRate: 48_000,
  forceStereo: false,
  builtIn: true
};

// Ngưỡng giả lập cho máy CI 4 nhân (GitHub Actions Windows + Defender):
// Khởi tạo lạnh node.exe ESM + ghi tệp tạm + đóng pipe dưới tải 4 worker mất tối đa ~150–650 ms,
// nên 1.500 ms chừa biên an toàn > 2,3× cho luồng bình thường; ca treo giữ đứng im 5.000 ms (> 3,3× ngưỡng).
const SIMULATED_STALL_TIMEOUT_MS = 1_500;
const SIMULATED_HANG_HOLD_MS = 5_000;
const SIMULATED_FINALIZE_STALL_TIMEOUT_MS = 6_000;
const INTEGRATION_CASE_TIMEOUT_MS = 60_000;

describe('V6 — Bộ canh tiến độ thật (out_time_ms / out_time) cho ffmpeg', () => {
  it('ffmpeg giả in out_time_ms lặp liên tục nhưng KHÔNG tăng → bị dừng ngay sau ngưỡng, xoá .pending dở và báo rõ tiếng Việt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-v6-stall-'));
    tempDirs.push(root);
    const cacheFolder = join(root, '_normalized-cache');
    const sourcePath = join(root, 'TT131 TA.mp4');
    const pidRecordFile = join(root, 'spawned-pid.txt');
    const fakeScript = join(root, 'fake-stalled-ffmpeg.mjs');

    await writeFile(sourcePath, Buffer.alloc(4096, 1));
    await writeFile(
      fakeScript,
      `
import { writeFileSync } from 'node:fs';
const outPath = process.argv.at(-1);
writeFileSync(${JSON.stringify(pidRecordFile)}, String(process.pid), 'utf8');
if (outPath && !outPath.startsWith('-')) {
  writeFileSync(outPath, Buffer.alloc(8192, 7));
}
process.stdout.write('out_time_ms=460940227\\nprogress=continue\\n');
const repeat = setInterval(() => {
  process.stdout.write('frame=13828\\nout_time_ms=460940227\\nspeed=0.00x\\nprogress=continue\\n');
}, 100);
// Giữ đứng im > 3× ngưỡng (${SIMULATED_HANG_HOLD_MS} ms vs ${SIMULATED_STALL_TIMEOUT_MS} ms); nếu bộ canh tắt sẽ thoát 0 làm bài kiểm ĐỎ
setTimeout(() => {
  clearInterval(repeat);
}, ${SIMULATED_HANG_HOLD_MS});
`,
      'utf8'
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const processes = new ProcessManager(logger as never);
    managedManagers.push(processes);
    // Bỏ qua gọi powershell setPriority trong bài kiểm tốc độ cao để đo đúng thời gian canh đứng im
    vi.spyOn(processes, 'setPriority').mockResolvedValue();

    const realRun = processes.run.bind(processes);
    vi.spyOn(processes, 'run').mockImplementation((opts) =>
      realRun({
        ...opts,
        executablePath: process.execPath,
        args: [fakeScript, ...opts.args],
        stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS
      })
    );

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
    const analyzer = { analyze: vi.fn(() => Promise.resolve(makeFakeMediaInfo())) };
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

    const job = { id: 'job-merge-v6', projectId: 'proj-v6', type: 'merge' } as QueueJob;
    const startedAt = Date.now();
    let caught: unknown = null;
    try {
      await normalizer.normalizeToTarget(
        job,
        sourcePath,
        makeFakeMediaInfo(),
        cacheFolder,
        TARGET_1080P,
        RESOURCE_PROFILE,
        new AbortController().signal,
        () => undefined,
        QUALITY_PROFILE,
        undefined,
        true,
        true,
        { sourceIndex: 3 }
      );
    } catch (error) {
      caught = error;
    }
    const elapsedMs = Date.now() - startedAt;

    expect(caught).toBeInstanceOf(ProcessStalledError);
    expect(elapsedMs).toBeLessThan(SIMULATED_HANG_HOLD_MS);

    const stalledError = caught as ProcessStalledError;
    expect(stalledError.code).toBe('PROCESS_STALLED');
    expect(stalledError.message).toContain('Video nguồn #3');
    expect(stalledError.message).toContain('TT131 TA.mp4');
    expect(stalledError.message).toContain('chuẩn hóa video');
    expect(stalledError.message).toContain('07:40');
    expect(stalledError.details).toMatchObject({
      step: 'normalize',
      sourceIndex: 3,
      sourcePath
    });

    // Tiến trình con bị treo đã bị tắt sạch theo PID (chờ theo điều kiện tiến trình thoát thay vì sleep cố định)
    const spawnedPid = Number((await readFile(pidRecordFile, 'utf8')).trim());
    expect(spawnedPid).toBeGreaterThan(0);
    await expect.poll(() => isProcessAlive(spawnedPid), { timeout: 3_000, interval: 25 }).toBe(false);

    // Tệp .pending.mp4 dở của lượt bị dừng đã được xoá sạch, không để rác trong _normalized-cache
    const remainingFiles = await readdir(cacheFolder);
    expect(remainingFiles.filter((name) => name.endsWith('.pending.mp4'))).toEqual([]);

    // Thông báo trên giao diện giữ nguyên tên video + mốc kẹt, không bị thay bằng câu chung chung
    const ui = friendlyIssue(stalledError);
    expect(ui.message).toContain('TT131 TA.mp4');
    expect(ui.message).toContain('07:40');
    expect(failureReasonLabel({ code: stalledError.code, jobType: 'merge', message: stalledError.message })).toContain(
      'Video nguồn #3'
    );
  }, INTEGRATION_CASE_TIMEOUT_MS);

  it('ffmpeg giả chạy chậm (máy 2 luồng + HDD) nhưng out_time_ms tăng đều → KHÔNG bị dừng oan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-v6-slow-'));
    tempDirs.push(root);
    const slowScript = join(root, 'fake-slow-ffmpeg.mjs');
    await writeFile(
      slowScript,
      `
let step = 0;
process.stdout.write('out_time_ms=100000\\nprogress=continue\\n');
const timer = setInterval(() => {
  step += 1;
  process.stdout.write('out_time_ms=' + ((step + 1) * 250000) + '\\nprogress=' + (step >= 5 ? 'end' : 'continue') + '\\n');
  if (step >= 5) {
    clearInterval(timer);
  }
}, 450);
`,
      'utf8'
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const processes = new ProcessManager(logger as never);
    managedManagers.push(processes);
    vi.spyOn(processes, 'setPriority').mockResolvedValue();

    // Tổng thời gian chạy ~2.250ms > stallTimeoutMs (1.500ms), nhưng mỗi 450ms out_time_ms đều tăng
    const result = await processes.run({
      jobId: 'job-slow-ok',
      tool: 'ffmpeg',
      executablePath: process.execPath,
      args: [slowScript],
      timeoutMs: 30_000,
      stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS,
      progressValueOfStdoutLine: parseFfmpegOutTimeSeconds
    });

    expect(result.code).toBe(0);
  }, INTEGRATION_CASE_TIMEOUT_MS);

  it('thời gian tác vụ đang Tạm dừng (suspended) và bước dồn moov (+faststart) không bị cắt oan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-v6-pause-faststart-'));
    tempDirs.push(root);
    const faststartGate = await createLoopbackSignalGate();
    const faststartScript = join(root, 'fake-faststart-ffmpeg.mjs');
    await writeFile(
      faststartScript,
      `
import { createConnection } from 'node:net';
const sock = createConnection({ host: '127.0.0.1', port: ${faststartGate.port} }, () => {
  process.stdout.write('out_time_ms=10000000\\nprogress=continue\\n');
});
let startedFinalize = false;
sock.on('data', () => {
  if (startedFinalize) return;
  startedFinalize = true;
  process.stderr.write('[mp4 @ 000001] Starting second pass: moving the moov atom to the beginning of the file\\n');
  // Bước dồn moov im lặng 2.100ms (> stallTimeoutMs 1.500ms nhưng < finalizeStallTimeoutMs 6.000ms), tự thoát 0 khi hết timer
  setTimeout(() => {
    process.stdout.write('out_time_ms=10000000\\nprogress=end\\n');
  }, 2_100);
});
`,
      'utf8'
    );

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const processes = new ProcessManager(logger as never);
    managedManagers.push(processes);
    vi.spyOn(processes, 'setPriority').mockResolvedValue();

    const result = await processes.run({
      jobId: 'job-faststart-ok',
      tool: 'ffmpeg',
      executablePath: process.execPath,
      args: [faststartScript],
      timeoutMs: 30_000,
      stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS,
      finalizeStallTimeoutMs: SIMULATED_FINALIZE_STALL_TIMEOUT_MS,
      progressValueOfStdoutLine: parseFfmpegOutTimeSeconds,
      onStdoutLine: (line) => {
        if (line.includes('out_time_ms=10000000')) {
          faststartGate.release();
        }
      },
      isFinalizeStderrLine: (line) => line.includes('Starting second pass')
    });
    expect(result.code).toBe(0);

    // Kiểm tra thêm: khi người dùng bấm Tạm dừng (pauseByJob → suspended = true), đồng hồ canh đứng im cũng tạm dừng
    const pausedGate = await createLoopbackSignalGate();
    const pausedScript = join(root, 'fake-paused-ffmpeg.mjs');
    await writeFile(
      pausedScript,
      `
import { createConnection } from 'node:net';
const sock = createConnection({ host: '127.0.0.1', port: ${pausedGate.port} }, () => {
  process.stdout.write('out_time_ms=5000000\\nprogress=continue\\n');
});
let finished = false;
sock.on('data', () => {
  if (finished) return;
  finished = true;
  process.stdout.write('out_time_ms=9000000\\nprogress=end\\n');
});
`,
      'utf8'
    );
    vi.spyOn(
      processes as unknown as { controlWindowsProcessTree: () => Promise<void> },
      'controlWindowsProcessTree'
    ).mockResolvedValue();
    let resolveFirstStdout!: () => void;
    const firstStdoutReady = new Promise<void>((resolve) => {
      resolveFirstStdout = resolve;
    });
    const runPaused = processes.run({
      jobId: 'job-paused-ok',
      tool: 'ffmpeg',
      executablePath: process.execPath,
      args: [pausedScript],
      timeoutMs: 30_000,
      stallTimeoutMs: SIMULATED_STALL_TIMEOUT_MS,
      progressValueOfStdoutLine: parseFfmpegOutTimeSeconds,
      onStdoutLine: (line) => {
        if (line.includes('out_time_ms=5000000')) resolveFirstStdout();
      }
    });
    await firstStdoutReady;
    await processes.pauseByJob('job-paused-ok');
    // Giữ trạng thái Tạm dừng lâu hơn stallTimeoutMs (2.100ms > 1.500ms) để chứng minh đồng hồ canh không cộng thời gian đang tạm dừng
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await processes.resumeByJob('job-paused-ok');
    pausedGate.release();
    const pausedResult = await runPaused;
    expect(pausedResult.code).toBe(0);
  }, INTEGRATION_CASE_TIMEOUT_MS);

  it('ngưỡng mặc định đủ rộng cho máy 2 luồng + HDD (5 phút xử lý / 15 phút dồn faststart) và gắn đủ ở các bước dài', async () => {
    expect(FFMPEG_PROGRESS_STALL_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(FFMPEG_FASTSTART_FINALIZE_STALL_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(parseFfmpegOutTimeSeconds('progress=continue')).toBeNull();
    expect(parseFfmpegOutTimeSeconds('frame=13828')).toBeNull();
    expect(parseFfmpegOutTimeSeconds('speed=0.00x')).toBeNull();
    expect(parseFfmpegOutTimeSeconds('out_time_ms=460940227')).toBeCloseTo(460.940227, 5);
    expect(parseFfmpegOutTimeSeconds('out_time=00:07:40.94')).toBeCloseTo(460.94, 2);

    const [normalizeSrc, mergeSrc, clipSrc, verifierSrc, localCutSrc, downloadSrc] = await Promise.all([
      readFile('src/main/normalize/normalize-engine.ts', 'utf8'),
      readFile('src/main/merge/merge-engine.ts', 'utf8'),
      readFile('src/main/clips/clip-engine.ts', 'utf8'),
      readFile('src/main/media/file-verifier.ts', 'utf8'),
      readFile('src/main/media/local-cut-service.ts', 'utf8'),
      readFile('src/main/downloader/download-engine.ts', 'utf8')
    ]);

    expect(normalizeSrc.match(/FFMPEG_PROGRESS_STALL_TIMEOUT_MS/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(mergeSrc.match(/FFMPEG_PROGRESS_STALL_TIMEOUT_MS/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(clipSrc).toContain('FFMPEG_PROGRESS_STALL_TIMEOUT_MS');
    expect(verifierSrc.match(/FFMPEG_PROGRESS_STALL_TIMEOUT_MS/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(localCutSrc).toContain('FFMPEG_PROGRESS_STALL_TIMEOUT_MS');
    expect(downloadSrc).toContain('FFMPEG_PROGRESS_STALL_TIMEOUT_MS');
  });
});
