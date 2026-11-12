import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let electronTempRoot = tmpdir();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronTempRoot)
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}));

import { CookieJarStore } from '../../src/main/cookies/cookie-jar-store.js';
import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { QuickDownloadStatus } from '../../src/shared/quick-download.js';

const BOT_LINE =
  "ERROR: [youtube] abcDEF12345: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.";
const ROTATED_LINES = [
  'WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.',
  BOT_LINE
];

const temporaryRoots: string[] = [];

async function waitTerminalStatus(service: QuickDownloadService, taskId: string): Promise<QuickDownloadStatus> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = service.status(taskId);
    if (current && ['completed', 'skipped', 'failed', 'cancelled', 'interrupted'].includes(current.phase)) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Tác vụ ${taskId} không kết thúc kịp thời hạn kiểm thử.`);
}

async function createBotCheckFixture(options: {
  withFakeCookies: boolean;
  onRun: (callIndex: number, args: string[], emitStderr: (line: string) => void) => Promise<void> | void;
}) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-qd-bot-check-'));
  temporaryRoots.push(root);
  electronTempRoot = join(root, 'electron-temp');
  const outputDirectory = join(root, 'output');
  const stateDirectory = join(root, 'state');
  const securityDirectory = join(root, 'security');
  await mkdir(electronTempRoot, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(securityDirectory, { recursive: true });

  let cookieFilePath = '';
  if (options.withFakeCookies) {
    cookieFilePath = join(root, 'fake-cookies.txt');
    await writeFile(
      cookieFilePath,
      '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tsid_initial_fake\n',
      'utf8'
    );
  }

  let runCount = 0;
  const seenCookiePaths: Array<string | null> = [];
  const processes = {
    run: vi.fn(
      async (runOptions: {
        args: string[];
        onStderrLine?: (line: string) => void;
      }) => {
        const callIndex = runCount;
        runCount += 1;
        const cookieFlagIndex = runOptions.args.indexOf('--cookies');
        seenCookiePaths.push(cookieFlagIndex >= 0 ? (runOptions.args[cookieFlagIndex + 1] ?? null) : null);
        const emitted: string[] = [];
        await options.onRun(callIndex, runOptions.args, (line) => {
          emitted.push(line);
          runOptions.onStderrLine?.(line);
        });
        return {
          code: 1,
          stdoutTail: '',
          stderrTail: emitted.join('\n')
        };
      }
    ),
    hasJob: vi.fn(() => false),
    pauseByJob: vi.fn(() => Promise.resolve(0)),
    resumeByJob: vi.fn(() => Promise.resolve()),
    killByJob: vi.fn(() => Promise.resolve())
  };

  const tools = {
    ensureRequiredReady: vi.fn(() => Promise.resolve([])),
    get: vi.fn((name: string) => ({
      name,
      available: true,
      executablePath: join(root, `${name}.exe`)
    }))
  };
  const verifier = {
    verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 60 }))
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
  const settings = {
    get: () => ({
      ...defaultAppSettings,
      defaultResourceProfileId: 'test-zero-disk',
      cookiesFilePath: cookieFilePath,
      cookiesBrowser: 'none' as const,
      cookiesBrowserProfile: ''
    }),
    profiles: () => ({
      resources: [
        {
          id: 'test-zero-disk',
          diskFreeMinimumBytes: 0
        }
      ]
    })
  };

  const cookieJar = new CookieJarStore(securityDirectory);
  const service = new QuickDownloadService(
    processes as never,
    tools as never,
    verifier as never,
    logger as never,
    stateDirectory,
    settings as never
  );
  service.setCookieJar(cookieJar);

  return {
    root,
    outputDirectory,
    securityDirectory,
    cookieFilePath,
    seenCookiePaths,
    processes,
    service
  };
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const dir = temporaryRoots.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

describe('Tải nhanh gặp chặn chống bot YouTube (V1)', () => {
  it('chưa gắn cookie mà gặp "not a bot" → báo BOT_CHECK (tạm chặn), không báo COOKIES_EXPIRED hay AUTHENTICATION_REQUIRED', async () => {
    const { outputDirectory, processes, service } = await createBotCheckFixture({
      withFakeCookies: false,
      onRun: (_index, _args, emitStderr) => {
        emitStderr(BOT_LINE);
      }
    });

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      outputDirectory,
      mode: 'full',
      quality: 'best'
    });
    const finalStatus = await waitTerminalStatus(service, started.taskId);
    await service.shutdown();

    expect(processes.run).toHaveBeenCalledTimes(1);
    expect(finalStatus.phase).toBe('failed');
    expect(finalStatus.errorCode).toBe('BOT_CHECK');
    expect(finalStatus.message).not.toMatch(/hết hạn/i);
    expect(finalStatus.message).toMatch(/tạm|chặn|bot/i);
  });

  it('có cookie giả: yt-dlp cập nhật cookie xoay vòng trên bản sao tạm rồi vẫn dính "not a bot" → giữ lại cookie mới vào tệp gốc trước khi xoá tạm và báo BOT_CHECK', async () => {
    const { outputDirectory, securityDirectory, cookieFilePath, seenCookiePaths, processes, service } =
      await createBotCheckFixture({
        withFakeCookies: true,
        onRun: async (callIndex, args, emitStderr) => {
          const cookieIdx = args.indexOf('--cookies');
          if (callIndex === 1 && cookieIdx >= 0) {
            const leasedPath = args[cookieIdx + 1]!;
            await writeFile(
              leasedPath,
              '# Netscape HTTP Cookie File\n# This file is generated by yt-dlp. Do not edit.\n.youtube.com\tTRUE\t/\tTRUE\t2050000000\tSID\tsid_rotated_by_ytdlp\n',
              'utf8'
            );
          }
          emitStderr(BOT_LINE);
        }
      });

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      outputDirectory,
      mode: 'full',
      quality: 'best'
    });
    const finalStatus = await waitTerminalStatus(service, started.taskId);
    await service.shutdown();

    expect(processes.run).toHaveBeenCalledTimes(2);
    expect(seenCookiePaths[0]).toBeNull();
    expect(seenCookiePaths[1]).not.toBeNull();
    expect(seenCookiePaths[1]).not.toBe(cookieFilePath);

    expect(finalStatus.phase).toBe('failed');
    expect(finalStatus.errorCode).toBe('BOT_CHECK');
    expect(finalStatus.message).not.toMatch(/hết hạn/i);
    expect(finalStatus.message).toMatch(/không phải do cookies/i);

    const savedCookieContent = await readFile(cookieFilePath, 'utf8');
    expect(savedCookieContent).toContain('sid_rotated_by_ytdlp');

    const remainingLeaseFiles = await readdir(join(securityDirectory, 'cookie-runs')).catch(() => []);
    expect(remainingLeaseFiles).toEqual([]);
  });

  it('yt-dlp báo rõ cookie đã bị trình duyệt xoay/thu hồi → vẫn báo COOKIES_EXPIRED và không ghi đè cookie hỏng vào tệp gốc', async () => {
    const { outputDirectory, cookieFilePath, processes, service } = await createBotCheckFixture({
      withFakeCookies: true,
      onRun: async (callIndex, args, emitStderr) => {
        const cookieIdx = args.indexOf('--cookies');
        if (callIndex === 1 && cookieIdx >= 0) {
          const leasedPath = args[cookieIdx + 1]!;
          await writeFile(
            leasedPath,
            '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2050000000\tSID\tsid_corrupted_should_not_persist\n',
            'utf8'
          );
        }
        for (const line of ROTATED_LINES) emitStderr(line);
      }
    });

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      outputDirectory,
      mode: 'full',
      quality: 'best'
    });
    const finalStatus = await waitTerminalStatus(service, started.taskId);
    await service.shutdown();

    expect(processes.run).toHaveBeenCalledTimes(2);
    expect(finalStatus.phase).toBe('failed');
    expect(finalStatus.errorCode).toBe('COOKIES_EXPIRED');
    expect(finalStatus.message).toMatch(/xoay/i);
    expect(finalStatus.message).toMatch(/ẩn danh/i);

    const savedCookieContent = await readFile(cookieFilePath, 'utf8');
    expect(savedCookieContent).toContain('sid_initial_fake');
    expect(savedCookieContent).not.toContain('sid_corrupted_should_not_persist');
  });
});
