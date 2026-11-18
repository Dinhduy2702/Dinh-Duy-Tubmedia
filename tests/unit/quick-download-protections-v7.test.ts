import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sandboxRoot = mkdtempSync(join(tmpdir(), 'tubmedia-v7-root-'));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => sandboxRoot)
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}));

import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';
import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import { PlatformRateLimitGate } from '../../src/main/queue/platform-rate-limit-gate.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '../../src/main/settings/defaults.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';

const subRoots: string[] = [];

function makeSubDir(prefix: string): string {
  const dir = mkdtempSync(join(sandboxRoot, prefix));
  subRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of subRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(join(sandboxRoot, 'TubmediaQD'), { recursive: true, force: true });
  vi.clearAllMocks();
});

async function waitForTerminal(service: QuickDownloadService, taskId: string, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = service.status(taskId);
    if (
      status &&
      ['completed', 'cancelled', 'failed', 'skipped', 'interrupted'].includes(status.phase) &&
      !service.isActive()
    ) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('Timeout waiting for QuickDownloadService terminal status');
}

describe('V7 — Tải nhanh đồng bộ bảo vệ máy yếu/HDD, tốc độ, cổng 429 và giữ .part khi lỗi mạng', () => {
  it('1) buildQuickDownloadArguments với ổ HDD + rateLimit 1M + proxy + giãn nhịp → co mảnh còn 2, truyền đủ --limit-rate, --proxy, --file-access-retries 5, --socket-timeout 30 và cờ nghỉ', () => {
    const req = validateQuickDownloadRequest({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      outputDirectory: 'D:\\Video',
      mediaMode: 'video-audio',
      quality: 'best',
      mode: 'full',
      accurateCut: false
    });
    const args = buildQuickDownloadArguments(
      req,
      { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\qd', runToken: 'run-1', outputToken: 'tok1' },
      undefined,
      {
        concurrentFragments: 4,
        fragmentsAuto: true,
        diskKind: 'hdd',
        rateLimit: '1M',
        proxy: 'http://127.0.0.1:8080',
        platform: 'youtube',
        pacing: { samePlatformActive: 2, rateLimitStrikes: 0 }
      }
    );

    const fragIdx = args.indexOf('--concurrent-fragments');
    expect(args[fragIdx + 1]).toBe('2');
    expect(args).toEqual(
      expect.arrayContaining([
        '--limit-rate',
        '1M',
        '--proxy',
        'http://127.0.0.1:8080',
        '--file-access-retries',
        '5',
        '--socket-timeout',
        '30',
        '--sleep-requests',
        '1'
      ])
    );
  });

  it('2) Lỗi mạng tạm thời giữ lại tệp .part (kể cả qua recover() mở lại app trong 7 ngày) để bấm Tải lại nối tiếp, và xoá sạch khi hoàn tất', async () => {
    const dir = makeSubDir('net-part-');
    const outDir = join(dir, 'out');
    const stateDir = join(dir, 'state');
    mkdirSync(outDir, { recursive: true });

    let attempt = 0;
    let sawExistingPartOnRetry = false;

    const processes = {
      run: vi.fn((opts: {
        tool: string;
        args: string[];
        onStdoutLine?: (line: string) => void;
        onStderrLine?: (line: string) => void;
      }) => {
        if (opts.tool !== 'yt-dlp') {
          return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 5 });
        }
        attempt += 1;
        const tempArg = opts.args[opts.args.indexOf('-P', opts.args.indexOf('-P') + 1) + 1]!;
        const tempFolder = tempArg.replace(/^temp:/, '');
        const partFile = join(tempFolder, 'sample.f137.mp4.part');

        if (attempt === 1) {
          mkdirSync(tempFolder, { recursive: true });
          writeFileSync(partFile, 'half-downloaded-bytes');
          opts.onStderrLine?.('ERROR: [youtube] abcdef12345: Unable to download video data: The read operation timed out');
          return Promise.resolve({
            code: 1,
            stdoutTail: '',
            stderrTail: 'ERROR: Unable to download video data: The read operation timed out',
            durationMs: 20
          });
        }

        sawExistingPartOnRetry = existsSync(partFile);
        const tokenMatch = /\[QD-([^\]]+)\]/.exec(opts.args[opts.args.indexOf('-o') + 1] ?? '');
        const finalFile = join(outDir, `Video [abcdef12345] [QD-${tokenMatch?.[1] ?? 'tok'}].mp4`);
        writeFileSync(finalFile, 'completed-video');
        opts.onStdoutLine?.(`TUBMEDIA_FILE|${finalFile}`);
        return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 20 });
      }),
      hasJob: vi.fn(() => false),
      pauseByJob: vi.fn(() => Promise.resolve(0)),
      resumeByJob: vi.fn(() => Promise.resolve(0)),
      killByJob: vi.fn(() => Promise.resolve(undefined))
    };

    const tools = {
      ensureRequiredReady: vi.fn(() => Promise.resolve([])),
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
    };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 30 }))
    };
    const settingsStub = {
      get: () => ({ ...defaultAppSettings, rateLimit: '2M', proxy: 'http://127.0.0.1:8888' }),
      profiles: () => ({ resources: builtInResourceProfiles, qualities: builtInQualityProfiles })
    };

    const service = new QuickDownloadService(
      processes as never,
      tools as never,
      verifier as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      stateDir,
      settingsStub as never
    );

    const rawRequest = {
      url: 'https://www.youtube.com/watch?v=abcdef12345',
      outputDirectory: outDir,
      quality: 'best' as const,
      mediaMode: 'video-audio' as const,
      mode: 'full' as const,
      accurateCut: false,
      embedCredit: false
    };

    const firstStart = await service.start(rawRequest);
    const firstDone = await waitForTerminal(service, firstStart.taskId);
    expect(firstDone.phase).toBe('failed');

    // Thư mục tạm chứa .part vẫn còn trên đĩa và không bị recover() xoá khi chưa quá 7 ngày
    const qdRoot = join(sandboxRoot, 'TubmediaQD');
    const keptEntries = existsSync(qdRoot) ? readdirSync(qdRoot) : [];
    expect(keptEntries.length).toBe(1);

    // Giả lập tệp .part đã 3 giờ tuổi (> 1 giờ mồ côi thường, nhưng < 7 ngày resume) rồi mở lại app
    const resumeDir = join(qdRoot, keptEntries[0]!);
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1_000);
    for (const f of readdirSync(resumeDir)) {
      utimesSync(join(resumeDir, f), threeHoursAgo, threeHoursAgo);
    }
    await service.recover();
    expect(existsSync(resumeDir)).toBe(true);

    // Bấm Tải lại cùng link → dùng lại đúng thư mục chứa .part và xoá sạch sau khi hoàn tất
    const secondStart = await service.start(rawRequest);
    const secondDone = await waitForTerminal(service, secondStart.taskId);
    expect(secondDone.phase).toBe('completed');
    expect(sawExistingPartOnRetry).toBe(true);
    expect(existsSync(resumeDir)).toBe(false);
  });

  it('3) Bị chặn HTTP 429 trên Tải nhanh đi chung PlatformRateLimitGate: ghi nhận strike, tự chờ hết cooldown rồi tải tiếp từ .part', async () => {
    const dir = makeSubDir('gate-429-');
    const outDir = join(dir, 'out');
    const stateDir = join(dir, 'state');
    mkdirSync(outDir, { recursive: true });

    const sharedGate = new PlatformRateLimitGate(() => 0, 35);
    let calls = 0;

    const processes = {
      run: vi.fn((opts: {
        tool: string;
        args: string[];
        onStdoutLine?: (line: string) => void;
        onStderrLine?: (line: string) => void;
      }) => {
        if (opts.tool !== 'yt-dlp') {
          return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 5 });
        }
        calls += 1;
        if (calls === 1) {
          opts.onStderrLine?.('ERROR: [youtube] rate429vid0: HTTP Error 429: Too Many Requests');
          return Promise.resolve({
            code: 1,
            stdoutTail: '',
            stderrTail: 'HTTP Error 429: Too Many Requests',
            durationMs: 10
          });
        }
        const tokenMatch = /\[QD-([^\]]+)\]/.exec(opts.args[opts.args.indexOf('-o') + 1] ?? '');
        const finalFile = join(outDir, `Video [rate429vid0] [QD-${tokenMatch?.[1] ?? 'tok'}].mp4`);
        writeFileSync(finalFile, 'ok-after-429');
        opts.onStdoutLine?.(`TUBMEDIA_FILE|${finalFile}`);
        return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 10 });
      }),
      hasJob: vi.fn(() => false),
      pauseByJob: vi.fn(() => Promise.resolve(0)),
      resumeByJob: vi.fn(() => Promise.resolve(0)),
      killByJob: vi.fn(() => Promise.resolve(undefined))
    };

    const service = new QuickDownloadService(
      processes as never,
      {
        ensureRequiredReady: vi.fn(() => Promise.resolve([])),
        get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe` }))
      } as never,
      { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 15 })) } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      stateDir,
      {
        get: () => defaultAppSettings,
        profiles: () => ({ resources: builtInResourceProfiles, qualities: builtInQualityProfiles })
      } as never
    );

    service.setSharedRateLimits({
      gate: () => sharedGate,
      activeOfPlatform: () => 0
    });

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=rate429vid0',
      outputDirectory: outDir,
      quality: 'best',
      mediaMode: 'video-audio',
      mode: 'full',
      accurateCut: false,
      embedCredit: false
    });

    const finished = await waitForTerminal(service, started.taskId);
    expect(finished.phase).toBe('completed');
    expect(calls).toBe(2);
    expect(sharedGate.strikesOf('youtube')).toBe(1);
  });
});
