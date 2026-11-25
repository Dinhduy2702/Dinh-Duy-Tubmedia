import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sandboxRoot = mkdtempSync(join(tmpdir(), 'tubmedia-step6-root-'));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => sandboxRoot) },
  shell: { showItemInFolder: vi.fn() }
}));

import { CookieJarStore, mergeCookieRun } from '../../src/main/cookies/cookie-jar-store.js';
import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '../../src/main/settings/defaults.js';

const subRoots: string[] = [];

function makeSub(prefix: string): string {
  const dir = mkdtempSync(join(sandboxRoot, prefix));
  subRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of subRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(join(sandboxRoot, 'TubmediaQD'), { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function waitTerminal(service: QuickDownloadService, taskId: string): Promise<ReturnType<QuickDownloadService['status']>> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const status = service.status(taskId);
    if (status && ['completed', 'cancelled', 'failed', 'skipped', 'interrupted'].includes(status.phase) && !service.isActive()) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('Timeout waiting for QuickDownloadService');
}

describe('#29–#40: cookie-jar-store, hậu tố tạm download-engine, và quick-download-service', () => {
  it('cookie-jar-store: dùng renameWithRetry, >= khi so hạn cookie bị trùng, và release() bọc try/catch không ném lỗi', async () => {
    const src = readFileSync(join(process.cwd(), 'src/main/cookies/cookie-jar-store.ts'), 'utf8');
    expect(src).toContain('renameWithRetry(temporary, path)');

    const header = '# Netscape HTTP Cookie File\n';
    const base = `${header}.youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tv0\n`;
    const current = `${header}.youtube.com\tTRUE\t/\tTRUE\t1900000100\tSID\tv1\n`;
    const updated = `${header}.youtube.com\tTRUE\t/\tTRUE\t1900000100\tSID\tv2\n`;
    expect(mergeCookieRun(base, updated, current)).toBeNull();

    const dir = makeSub('jar-');
    const cookiePath = join(dir, 'cookies.txt');
    writeFileSync(cookiePath, base, 'utf8');
    const jar = new CookieJarStore(join(dir, 'sec'));
    const lease = await jar.lease({ cookiesFilePath: cookiePath, cookiesBrowser: 'none', cookiesBrowserProfile: '' });
    writeFileSync(lease.settings!.cookiesFilePath, updated, 'utf8');
    const internals = jar as unknown as { writeBack: () => Promise<void> };
    internals.writeBack = () => Promise.reject(new Error('disk locked'));
    await expect(lease.release('success')).resolves.toBeUndefined();
  });

  it('download-engine: hậu tố tạm remux/replace dùng mã ngắn (+14 ký tự thay vì UUID đầy đủ)', () => {
    const src = readFileSync(join(process.cwd(), 'src/main/downloader/download-engine.ts'), 'utf8');
    expect(src).not.toContain('.tubmedia-${job.id}.pending.mp4');
    expect(src).not.toContain('.tubmedia-${job.id}.original');
  });

  it('quick-download-service: phụ đề bị HTTP 429 → tự fallback tải lại video không kèm phụ đề kèm cảnh báo', async () => {
    const dir = makeSub('qd-sub429-');
    const outDir = join(dir, 'out');
    mkdirSync(outDir, { recursive: true });
    const seenArgs: string[][] = [];
    let attempt = 0;

    const processes = {
      run: vi.fn((opts: { tool: string; args: string[]; onStdoutLine?: (l: string) => void; onStderrLine?: (l: string) => void }) => {
        if (opts.tool !== 'yt-dlp') return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 });
        attempt += 1;
        seenArgs.push(opts.args);
        if (attempt === 1) {
          const line = "ERROR: Unable to download video subtitles for 'vi': HTTP Error 429: Too Many Requests";
          opts.onStderrLine?.(line);
          return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: line, durationMs: 5 });
        }
        const tokenMatch = /\[QD-([^\]]+)\]/.exec(opts.args[opts.args.indexOf('-o') + 1] ?? '');
        const finalFile = join(outDir, `Video [sub429] [QD-${tokenMatch?.[1] ?? 'tok'}].mp4`);
        writeFileSync(finalFile, 'video-bytes');
        opts.onStdoutLine?.(`TUBMEDIA_FILE|${finalFile}`);
        return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 5 });
      }),
      hasJob: vi.fn(() => false),
      pauseByJob: vi.fn(() => Promise.resolve(0)),
      resumeByJob: vi.fn(() => Promise.resolve(0)),
      killByJob: vi.fn(() => Promise.resolve(undefined))
    };

    const service = new QuickDownloadService(
      processes as never,
      { ensureRequiredReady: vi.fn(() => Promise.resolve([])), get: vi.fn((n: string) => ({ name: n, available: true, executablePath: `${n}.exe` })) } as never,
      { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 10 })) } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      join(dir, 'state'),
      { get: () => defaultAppSettings, profiles: () => ({ resources: builtInResourceProfiles, qualities: builtInQualityProfiles }) } as never
    );

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=sub429test0',
      outputDirectory: outDir,
      quality: 'best',
      mediaMode: 'video-audio',
      mode: 'full',
      accurateCut: false,
      downloadSubtitles: true,
      subtitleLanguage: 'vi',
      embedCredit: false
    });

    const done = await waitTerminal(service, started.taskId);
    expect(done?.phase).toBe('completed');
    expect(attempt).toBe(2);
    expect(seenArgs[0]).toContain('--write-subs');
    expect(seenArgs[1]).not.toContain('--write-subs');
    expect(done?.warnings.join(' ')).toMatch(/phụ đề/i);
  });

  it('quick-download-service: giữ .part khi đầy ổ (DISK_FULL) và khi gặp BOT_CHECK', async () => {
    for (const scenario of ['disk', 'bot'] as const) {
      const dir = makeSub(`qd-${scenario}-`);
      const outDir = join(dir, 'out');
      mkdirSync(outDir, { recursive: true });
      let recordedTempDir = '';

      const processes = {
        run: vi.fn((opts: { tool: string; args: string[]; onStderrLine?: (l: string) => void }) => {
          const tempArg = opts.args[opts.args.indexOf('-P', opts.args.indexOf('-P') + 1) + 1]!;
          recordedTempDir = tempArg.replace(/^temp:/, '');
          mkdirSync(recordedTempDir, { recursive: true });
          writeFileSync(join(recordedTempDir, 'sample.mp4.part'), 'partial-data');
          const errLine =
            scenario === 'disk'
              ? 'ERROR: unable to write data: [Errno 28] No space left on device'
              : "ERROR: [youtube] bot12345678: Sign in to confirm you're not a bot.";
          opts.onStderrLine?.(errLine);
          return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: errLine, durationMs: 5 });
        }),
        hasJob: vi.fn(() => false),
        pauseByJob: vi.fn(() => Promise.resolve(0)),
        resumeByJob: vi.fn(() => Promise.resolve(0)),
        killByJob: vi.fn(() => Promise.resolve(undefined))
      };

      const service = new QuickDownloadService(
        processes as never,
        { ensureRequiredReady: vi.fn(() => Promise.resolve([])), get: vi.fn((n: string) => ({ name: n, available: true, executablePath: `${n}.exe` })) } as never,
        { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 10 })) } as never,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        join(dir, 'state'),
        {
          get: () => ({ ...defaultAppSettings, defaultResourceProfileId: 'zero-disk' }),
          profiles: () => ({ resources: [{ ...builtInResourceProfiles[0]!, id: 'zero-disk', builtIn: false, diskFreeMinimumBytes: 0 }], qualities: builtInQualityProfiles })
        } as never
      );

      const started = await service.start({
        url: `https://www.youtube.com/watch?v=${scenario === 'disk' ? 'disk1234567' : 'bot12345678'}`,
        outputDirectory: outDir,
        quality: 'best',
        mediaMode: 'video-audio',
        mode: 'full',
        accurateCut: false,
        embedCredit: false
      });

      const done = await waitTerminal(service, started.taskId);
      expect(done?.phase).toBe('failed');
      expect(done?.errorCode).toBe(scenario === 'disk' ? 'DISK_FULL' : 'BOT_CHECK');
      expect(existsSync(join(recordedTempDir, 'sample.mp4.part')), scenario).toBe(true);
    }
  });
});
