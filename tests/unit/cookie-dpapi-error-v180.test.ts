import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

let electronTempRoot = tmpdir();
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronTempRoot) },
  shell: { showItemInFolder: vi.fn() }
}));

import { classifyYtDlpFailure, isBrowserCookieDpapiErrorText } from '../../src/shared/utils/download-failure.js';
import { parseUserActionMessage } from '../../src/shared/utils/user-action-message.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { AppDatabase } from '../../src/main/database/database.js';
import { ProjectRepository } from '../../src/main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '../../src/main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '../../src/main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '../../src/main/media/quarantine-service.js';
import { DownloadEngine } from '../../src/main/downloader/download-engine.js';
import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import { builtInResourceProfiles, defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { AppSettings, QueueJob } from '../../src/shared/types/domain.js';

const DPAPI_ERROR =
  'ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927 for more info';
const APP_BOUND_ERROR =
  'ERROR: [youtube] Could not decrypt Chrome cookies due to App-Bound Encryption.';

const tempRoots: string[] = [];
const openDbs: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('#13: nhận diện lỗi DPAPI / App-Bound Encryption (Chrome/Edge 127+) thành lỗi Cookie có UserActionMessage', () => {
  it('classifyYtDlpFailure phân loại DPAPI và App-Bound Encryption là authentication (browser_cookie_dpapi)', () => {
    expect(isBrowserCookieDpapiErrorText(DPAPI_ERROR)).toBe(true);
    expect(isBrowserCookieDpapiErrorText(APP_BOUND_ERROR)).toBe(true);
    expect(classifyYtDlpFailure(DPAPI_ERROR)).toEqual({
      category: 'authentication',
      subtype: 'browser_cookie_dpapi',
      httpStatus: null,
      retryable: false
    });
    expect(classifyYtDlpFailure(APP_BOUND_ERROR)).toEqual({
      category: 'authentication',
      subtype: 'browser_cookie_dpapi',
      httpStatus: null,
      retryable: false
    });
  });

  it('DownloadEngine ném BrowserCookieLockedError kèm UserActionMessage tiếng Việt (cookies.txt / Firefox / Cốc Cốc / dán cookie)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tubmedia-dpapi-engine-'));
    tempRoots.push(folder);
    const database = new AppDatabase(join(folder, 'db.sqlite'));
    openDbs.push(database);
    const projects = new ProjectRepository(database.db);
    const sources = new MediaSourceRepository(database.db);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const quarantine = new QuarantineService(logger, {
      items: new QuarantineRepository(database.db),
      projects,
      rootOf: () => folder
    });
    const settings: AppSettings = { ...defaultAppSettings, cookiesBrowser: 'chrome' };
    const engine = new DownloadEngine(
      { run: vi.fn(() => Promise.resolve({ code: 1, stdoutTail: '', stderrTail: DPAPI_ERROR })) } as never,
      { get: (name: string) => ({ available: true, executablePath: join(folder, `${name}.exe`), version: '2026.10.26', capabilities: [] }) } as never,
      sources,
      projects,
      { get: () => settings } as never,
      { analyze: vi.fn() } as never,
      { verify: vi.fn(), measureAudio: vi.fn() } as never,
      quarantine,
      logger as never
    );

    const sourceFolder = join(folder, 'video');
    mkdirSync(sourceFolder, { recursive: true });
    const project = projects.create({
      name: 'ds',
      sourceFolder,
      tempFolder: join(folder, 'tam'),
      outputFolder: join(folder, 'tp'),
      finalFileName: 'ds',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const sourceId = randomUUID();
    const now = new Date().toISOString();
    const url = 'https://www.youtube.com/watch?v=abcDEF12345';
    database.db
      .prepare(
        `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'unknown',NULL,?,?)`
      )
      .run(sourceId, `youtube:${sourceId}`, url, url, 'youtube', 'youtube', 'abcDEF12345', now, now);

    const job: QueueJob = {
      id: randomUUID(),
      projectId: project.id,
      type: 'download',
      status: 'downloading',
      priority: 0,
      sourceId,
      itemId: null,
      input: { cookieRetryRequested: true },
      progress: 0,
      speed: null,
      etaSeconds: null,
      attempts: 0,
      maxAttempts: 3,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null
    };

    const err = (await engine
      .run(job, builtInResourceProfiles[0]!, new AbortController().signal, () => undefined)
      .catch((caught: unknown) => caught)) as { code: string; message: string; details?: Record<string, unknown> };

    expect(err.code).toBe('BROWSER_COOKIE_DATABASE_LOCKED');
    expect(err.details?.failureSubtype).toBe('browser_cookie_dpapi');
    const parsed = parseUserActionMessage(err.message);
    expect(parsed).not.toBeNull();
    expect(parsed?.steps.join(' ')).toMatch(/cookies\.txt/i);
    expect(parsed?.steps.join(' ')).toMatch(/Firefox|Cốc Cốc/i);
    expect(friendlyIssue(err.message).steps.length).toBeGreaterThanOrEqual(2);
  });

  it('QuickDownloadService nhận diện lỗi DPAPI thành BROWSER_COOKIE_DATABASE_LOCKED với UserActionMessage và tự chạy lại khi lưu cookie mới', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tubmedia-dpapi-qd-'));
    tempRoots.push(root);
    electronTempRoot = join(root, 'electron-temp');
    const outputDirectory = join(root, 'output');
    const stateDirectory = join(root, 'state');
    mkdirSync(electronTempRoot, { recursive: true });
    mkdirSync(outputDirectory, { recursive: true });

    const cookieFile = join(root, 'cookies.txt');
    writeFileSync(cookieFile, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tval\n', 'utf8');

    let currentSettings: AppSettings = {
      ...defaultAppSettings,
      defaultResourceProfileId: 'test-zero',
      cookiesBrowser: 'edge',
      cookiesFilePath: ''
    };
    let callCount = 0;
    const processes = {
      run: vi.fn((opts: { onStderrLine?: (line: string) => void }) => {
        callCount += 1;
        if (callCount === 1) {
          opts.onStderrLine?.(DPAPI_ERROR);
          return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: DPAPI_ERROR });
        }
        return Promise.resolve({ code: 1, stdoutTail: '', stderrTail: 'stopped' });
      }),
      hasJob: vi.fn(() => false),
      pauseByJob: vi.fn(() => Promise.resolve(0)),
      resumeByJob: vi.fn(() => Promise.resolve()),
      killByJob: vi.fn(() => Promise.resolve())
    };
    const service = new QuickDownloadService(
      processes as never,
      {
        ensureRequiredReady: vi.fn(() => Promise.resolve([])),
        get: vi.fn((name: string) => ({ name, available: true, executablePath: join(root, `${name}.exe`) }))
      } as never,
      { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 60 })) } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      stateDirectory,
      {
        get: () => currentSettings,
        profiles: () => ({ resources: [{ id: 'test-zero', diskFreeMinimumBytes: 0 }] })
      } as never
    );

    const started = await service.start({
      url: 'https://www.youtube.com/watch?v=abcDEF12345',
      outputDirectory,
      mediaMode: 'video-audio',
      quality: 'best',
      mode: 'full',
      startSeconds: null,
      endSeconds: null,
      accurateCut: false,
      embedCredit: false
    });

    const deadline = Date.now() + 5_000;
    let status = service.status(started.taskId);
    while (status && !['completed', 'failed', 'cancelled', 'interrupted', 'skipped'].includes(status.phase) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
      status = service.status(started.taskId);
    }

    expect(status?.phase).toBe('failed');
    expect(status?.errorCode).toBe('BROWSER_COOKIE_DATABASE_LOCKED');
    expect(parseUserActionMessage(status?.error ?? '')).not.toBeNull();
    expect(status?.error).toMatch(/cookies\.txt/i);
    expect(status?.error).toMatch(/Firefox|Cốc Cốc/i);

    // Người dùng chuyển sang tệp cookies.txt → tự tiếp tục
    currentSettings = { ...currentSettings, cookiesBrowser: 'none', cookiesFilePath: cookieFile };
    const retried = await service.retryCookieBlocked();
    expect(retried).not.toBeNull();
    expect(callCount).toBe(2);
  });
});
