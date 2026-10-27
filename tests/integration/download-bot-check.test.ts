import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '@main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '@main/media/quarantine-service.js';
import { DownloadEngine } from '@main/downloader/download-engine.js';
import { builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { classifyYtDlpFailure } from '@shared/utils/download-failure.js';
import type { AppSettings, Project, QueueJob } from '@shared/types/domain.js';

// 2026-10-27 — điều tra "cookie vừa xuất, tải được vài video rồi vài phút sau báo cần cookie mới". Nhật ký 27/10: ~50 video
// trong 15 phút rồi YouTube trả "Sign in to confirm you’re not a bot" cho MỌI video, kể cả video chưa gắn cookie; app gắn
// cookie thử lại, vẫn câu đó → báo "cookie hết hạn" và tạm dừng từng video (36–40 video mỗi đợt). Câu này là YouTube chặn tạm
// theo lượng yêu cầu, không phải cookie hỏng. Bài này chạy DownloadEngine.run() THẬT, chỉ giả lập tiến trình yt-dlp.

const BOT = 'ERROR: [youtube] abcDEF12345: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.';
const ROTATED =
  'WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.\n' +
  BOT;

describe('phân loại câu lỗi YouTube', () => {
  it('"not a bot" là chặn tạm (bot_check), không phải lỗi đăng nhập chung', () => {
    expect(classifyYtDlpFailure(BOT)).toMatchObject({ category: 'authentication', subtype: 'bot_check' });
  });
  it('yt-dlp báo cookie đã bị xoay/thu hồi → cookie hỏng thật (cookies_invalid), kể cả khi kèm câu "not a bot"', () => {
    expect(classifyYtDlpFailure(ROTATED)).toMatchObject({ category: 'authentication', subtype: 'cookies_invalid' });
  });
  // 2026-10-27 (rà soát trước 1.7.3): "Sign in to confirm your age" là video giới hạn độ tuổi — CẦN đăng nhập thật, không phải
  // YouTube chặn tạm. Bản đầu của bot_check bắt mọi câu "sign in to confirm" → app sẽ chờ rồi thử lại vô ích thay vì xin cookie.
  it('"Sign in to confirm your age" (giới hạn độ tuổi) là lỗi đăng nhập thật, KHÔNG phải chặn chống bot', () => {
    const age = 'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.';
    expect(classifyYtDlpFailure(age)).toMatchObject({ category: 'authentication', subtype: 'authentication' });
  });

  it('kèm HTTP 429 → giới hạn 429; video cần đăng nhập thật → lỗi đăng nhập như cũ', () => {
    expect(classifyYtDlpFailure(`WARNING: HTTP Error 429: Too Many Requests\n${BOT}`)).toMatchObject({ subtype: 'http_429' });
    expect(classifyYtDlpFailure('ERROR: [youtube] x: This video is members-only content.')).toMatchObject({ subtype: 'authentication' });
  });
});

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let sources: MediaSourceRepository;
let engine: DownloadEngine;
let settings: AppSettings;
let stderr = '';
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-bot-check-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  const cookies = join(folder, 'cookies.txt');
  writeFileSync(cookies, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\tabc\n');
  settings = { ...defaultAppSettings, cookiesFilePath: cookies, cookiesBrowser: 'none' };
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const quarantine = new QuarantineService(logger as never, { items: new QuarantineRepository(database.db), projects, rootOf: () => folder });
  engine = new DownloadEngine(
    { run: vi.fn(() => Promise.resolve({ code: 1, stdoutTail: '', stderrTail: stderr })) } as never,
    { get: (name: string) => ({ available: true, executablePath: join(folder, `${name}.exe`) }) } as never,
    sources,
    projects,
    { get: () => settings } as never,
    { analyze: vi.fn() } as never,
    { verify: vi.fn(), measureAudio: vi.fn() } as never,
    quarantine,
    logger as never
  );
});
afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

const setup = (): { project: Project; job: QueueJob } => {
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
    id: randomUUID(), projectId: project.id, type: 'download', status: 'downloading', priority: 0, sourceId, itemId: null,
    input: {}, progress: 0, speed: null, etaSeconds: null, attempts: 0, maxAttempts: 3, errorCode: null, errorMessage: null,
    createdAt: now, updatedAt: now, startedAt: now, finishedAt: null
  };
  return { project, job };
};
const resource = builtInResourceProfiles[0]!;
const run = (job: QueueJob): Promise<unknown> => engine.run(job, resource, new AbortController().signal, () => undefined);

describe('lượt tải gặp chặn chống bot', () => {
  it('chưa gắn cookie → thử lại bằng cookie đã cấu hình (như cũ); gắn rồi vẫn bị chặn → chờ như HTTP 429, KHÔNG báo cookie hết hạn', async () => {
    stderr = BOT;
    const { job } = setup();
    await expect(run(job)).rejects.toMatchObject({ code: 'RETRY_WITH_CONFIGURED_COOKIES' });
    await expect(run(job)).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED', details: { rateLimitReason: 'bot_check' } });
    const logged = (logger.warn.mock.calls as Array<[string, string, string, { metadata: Record<string, unknown> }]>).filter(
      (call) => call[1] === 'YTDLP_AUTHENTICATION_FAILURE'
    );
    const withCookies = logged.at(-1)?.[3].metadata;
    expect(withCookies).toMatchObject({ failureSubtype: 'bot_check', cookiesAttached: true });
    expect(String(withCookies?.technicalSummary), 'nhật ký giữ câu gốc của YouTube').toContain('not a bot');
  });

  it('chưa cấu hình cookie mà bị chặn chống bot → cũng chờ tự tiếp tục, không bắt người dùng thêm cookie', async () => {
    settings = { ...settings, cookiesFilePath: '' };
    stderr = BOT;
    const { job } = setup();
    await expect(run(job)).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED' });
  });

  it('yt-dlp báo cookie đã bị xoay/thu hồi → mới báo cookie hết hạn', async () => {
    stderr = ROTATED;
    const { job } = setup();
    await expect(run(job)).rejects.toMatchObject({ code: 'RETRY_WITH_CONFIGURED_COOKIES' });
    await expect(run(job)).rejects.toMatchObject({ code: 'COOKIES_EXPIRED' });
  });
});
