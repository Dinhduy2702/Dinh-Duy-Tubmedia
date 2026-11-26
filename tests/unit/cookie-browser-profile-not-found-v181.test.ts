import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronTempRoot = tmpdir();
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronTempRoot) },
  shell: { showItemInFolder: vi.fn() }
}));

import {
  browserCookieNotFoundMessage,
  classifyYtDlpFailure,
  isBrowserCookieNotFoundErrorText
} from '../../src/shared/utils/download-failure.js';
import { parseUserActionMessage } from '../../src/shared/utils/user-action-message.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { buildCookieArguments } from '../../src/main/downloader/ytdlp-cookie-arguments.js';
import { AppDatabase } from '../../src/main/database/database.js';
import { ProjectRepository } from '../../src/main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '../../src/main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '../../src/main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '../../src/main/media/quarantine-service.js';
import { DownloadEngine } from '../../src/main/downloader/download-engine.js';
import { builtInResourceProfiles, defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { AppSettings, QueueJob } from '../../src/shared/types/domain.js';

const FIREFOX_DEFAULT_ERROR =
  "ERROR: could not find firefox cookies database in 'C:\\Users\\Giap\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\Default', 'C:\\Users\\Giap\\AppData\\Local\\Packages\\Mozilla.Firefox_n80bbvh6b1yt2\\LocalCache\\Roaming\\Mozilla\\Firefox\\Profiles\\Default'";

const tempRoots: string[] = [];
const openDbs: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('v1.8.1 — lỗi không tìm thấy kho cookies trình duyệt (firefox:Default) và tự xoá hồ sơ khi đổi trình duyệt', () => {
  it('nhận diện lỗi could not find firefox cookies database là authentication / browser_cookie_not_found', () => {
    expect(isBrowserCookieNotFoundErrorText(FIREFOX_DEFAULT_ERROR)).toBe(true);
    expect(classifyYtDlpFailure(FIREFOX_DEFAULT_ERROR)).toEqual({
      category: 'authentication',
      subtype: 'browser_cookie_not_found',
      httpStatus: null,
      retryable: false
    });
  });

  it('browserCookieNotFoundMessage dựng UserActionMessage có bước cụ thể và nút Mở Cài đặt', () => {
    const message = browserCookieNotFoundMessage('firefox', 'Default');
    const parsed = parseUserActionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain('cookies');
    expect(parsed!.summary).toContain('Firefox');
    expect(parsed!.summary).toContain('Default');
    expect(parsed!.steps.length).toBeGreaterThanOrEqual(3);

    const issue = friendlyIssue(message);
    expect(issue.kind).toBe('user-action');
    expect(issue.action).toEqual({ label: 'Mở Cài đặt', page: 'settings' });
  });

  it('buildCookieArguments bỏ qua tên hồ sơ kiểu Chromium (Default / Profile N) khi trình duyệt là Firefox nhưng vẫn giữ hồ sơ Firefox thật', () => {
    expect(
      buildCookieArguments({
        cookiesFilePath: '',
        cookiesBrowser: 'firefox',
        cookiesBrowserProfile: 'Default'
      })
    ).toEqual(['--cookies-from-browser', 'firefox']);

    expect(
      buildCookieArguments({
        cookiesFilePath: '',
        cookiesBrowser: 'firefox',
        cookiesBrowserProfile: 'Profile 2'
      })
    ).toEqual(['--cookies-from-browser', 'firefox']);

    expect(
      buildCookieArguments({
        cookiesFilePath: '',
        cookiesBrowser: 'firefox',
        cookiesBrowserProfile: 'abcd1234.default-release'
      })
    ).toEqual(['--cookies-from-browser', 'firefox:abcd1234.default-release']);

    expect(
      buildCookieArguments({
        cookiesFilePath: '',
        cookiesBrowser: 'chrome',
        cookiesBrowserProfile: 'Default'
      })
    ).toEqual(['--cookies-from-browser', 'chrome:Default']);
  });

  it('DownloadEngine ném BrowserCookieLockedError kèm UserActionMessage thay vì Lỗi của ứng dụng', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tubmedia-cookie-not-found-'));
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
    const settings: AppSettings = { ...defaultAppSettings, cookiesBrowser: 'firefox', cookiesBrowserProfile: 'Default' };
    const engine = new DownloadEngine(
      { run: vi.fn(() => Promise.resolve({ code: 1, stdoutTail: '', stderrTail: FIREFOX_DEFAULT_ERROR })) } as never,
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
      .run(sourceId, 'youtube:abcDEF12345', url, url, 'youtube', 'Youtube', 'abcDEF12345', now, now);

    const job: QueueJob = {
      id: randomUUID(),
      projectId: project.id,
      type: 'download',
      status: 'downloading',
      priority: 0,
      sourceId,
      itemId: null,
      progress: 0,
      attempts: 0,
      maxAttempts: 3,
      input: { cookieRetryRequested: true },
      errorCode: null,
      errorMessage: null,
      speed: null,
      etaSeconds: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null
    };

    let caught: unknown;
    try {
      await engine.run(job, builtInResourceProfiles[0]!, new AbortController().signal, () => undefined);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('BROWSER_COOKIE_DATABASE_LOCKED');
    const message = (caught as Error).message;
    expect(parseUserActionMessage(message)).not.toBeNull();
    expect(friendlyIssue(message).kind).toBe('user-action');
  });

  it('SettingsPage và CookieManagerDialog tự xoá trắng hồ sơ khi người dùng đổi trình duyệt', () => {
    const settingsPage = readFileSync(join(process.cwd(), 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8');
    const cookieDialog = readFileSync(join(process.cwd(), 'src/renderer/src/components/CookieManagerDialog.tsx'), 'utf8');

    expect(settingsPage).toContain("patch('cookiesBrowserProfile', '')");
    expect(cookieDialog).toMatch(/setBrowser\([\s\S]{0,80}setProfile\(''\)/);
  });
});
