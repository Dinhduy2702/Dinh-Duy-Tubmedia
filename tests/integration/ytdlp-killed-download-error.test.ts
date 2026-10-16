import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
import type { AppSettings, MediaInfo, Project, QueueJob } from '@shared/types/domain.js';

// 2026-10-16: yt-dlp bị dừng ngang (taskkill /T /F giết nó trước tiến trình chính) không in câu lỗi nào — trước đây
// DownloadEngine báo "Video không khả dụng…" và KHÔNG thử lại (bài e2e "Khởi động…" đỏ chập chờn trên CI, có từ 1.6.3).
// Chạy DownloadEngine.run() THẬT trên CSDL thật, chỉ giả lập tiến trình yt-dlp trả đúng đầu ra đo được.

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let sources: MediaSourceRepository;
let engine: DownloadEngine;
let settings: AppSettings;
let ytdlpArgs: string[][];
let ytdlpResult: { code: number; stdoutTail: string; stderrTail: string };

const mediaInfo: MediaInfo = {
  duration: 60,
  width: 1280,
  height: 720,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.0',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/15360',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 2_000_000,
  audioBitrate: 128_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  fileSize: 5000
};

const makeProject = (name: string): Project => {
  const sourceFolder = join(folder, name, 'video');
  mkdirSync(sourceFolder, { recursive: true });
  return projects.create({
    name,
    sourceFolder,
    tempFolder: join(folder, name, 'tam'),
    outputFolder: join(folder, name, 'thanh-pham'),
    finalFileName: name,
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
};

const insertSource = (projectId: string, url: string, platform: string, mediaId: string): string => {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'unknown',NULL,?,?)`
    )
    .run(id, `${platform}:${platform}:${mediaId}::project:${projectId}`, url, url, platform, platform, mediaId, now, now);
  return id;
};

const jobFor = (projectId: string, sourceId: string, attempts = 0): QueueJob => ({
  id: randomUUID(),
  projectId,
  type: 'download',
  status: 'downloading',
  priority: 0,
  sourceId,
  itemId: null,
  input: {},
  progress: 0,
  speed: null,
  etaSeconds: null,
  attempts,
  maxAttempts: 3,
  errorCode: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: null
});

const resource = builtInResourceProfiles.find((profile) => profile.id === 'resource-balanced') ?? builtInResourceProfiles[0]!;

const failWith = async (result: { code: number; stdoutTail: string; stderrTail: string }): Promise<{ code?: string; retryable?: boolean; message: string }> => {
  const project = makeProject(`ds-${randomUUID().slice(0, 8)}`);
  const url = 'http://127.0.0.1:56695/treo/video.html';
  const sourceId = insertSource(project.id, url, 'generic', randomUUID().slice(0, 11));
  ytdlpResult = result;
  try {
    await engine.run(jobFor(project.id, sourceId), resource, new AbortController().signal, () => undefined);
  } catch (error) {
    return error as { code?: string; retryable?: boolean; message: string };
  }
  throw new Error('engine.run phải thất bại');
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-pacing-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  settings = { ...defaultAppSettings, cookiesFilePath: '', cookiesBrowser: 'none', useAria2c: true, aria2Connections: 16 };
  ytdlpArgs = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const toolsGet = vi.fn((name: string) =>
    name === 'yt-dlp' || name === 'aria2c'
      ? { available: true, executablePath: join(folder, `${name}-gia.exe`) }
      : { available: false, executablePath: null }
  );
  const quarantine = new QuarantineService(logger, {
    items: new QuarantineRepository(database.db),
    projects,
    rootOf: () => folder
  });
  const analyzer = { analyze: vi.fn(() => Promise.resolve(mediaInfo)) };
  const verifier = {
    verify: vi.fn((path: string, level: string) =>
      Promise.resolve(
        existsSync(path)
          ? { ok: true, path, level, reasons: [], duration: 60 }
          : { ok: false, path, level, reasons: ['Tệp không tồn tại.'], duration: 0 }
      )
    ),
    measureAudio: vi.fn(() => Promise.resolve({ meanVolumeDb: -20, maxVolumeDb: -3 }))
  };
  // yt-dlp giả: trả mã thoát + đầu ra cấu hình sẵn, không ghi tệp nào (lượt tải thất bại).
  const processes = {
    run: vi.fn((options: { args: string[] }) => {
      ytdlpArgs.push(options.args);
      return Promise.resolve(ytdlpResult);
    })
  };
  engine = new DownloadEngine(
    processes as never,
    { get: toolsGet } as never,
    sources,
    projects,
    { get: () => settings } as never,
    analyzer as never,
    verifier as never,
    quarantine,
    logger as never
  );
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('DownloadEngine: yt-dlp bị dừng ngang không bị báo nhầm "video không khả dụng"', () => {
  it('nguyên văn yt-dlp bị taskkill (mã 1, chỉ có dòng tiến trình) → lỗi THỬ LẠI ĐƯỢC, nói rõ bị dừng đột ngột', async () => {
    const error = await failWith({
      code: 1,
      stdoutTail: '[generic] Extracting URL: http://127.0.0.1:56695/treo/video.html\n[generic] video: Downloading webpage',
      stderrTail: ''
    });
    expect(error.code).toBe('DOWNLOAD_FAILED');
    expect(error.retryable).toBe(true);
    expect(error.message).not.toMatch(/không khả dụng/);
    expect(error.message).toMatch(/dừng đột ngột/);
  });

  it('có câu ERROR: mà không nhận ra loại → không thử lại, câu báo nói "lỗi không xác định" chứ không phải "không khả dụng"', async () => {
    const error = await failWith({ code: 1, stdoutTail: '', stderrTail: 'ERROR: something odd happened in the extractor' });
    expect(error.retryable).toBe(false);
    expect(error.message).not.toMatch(/không khả dụng/);
    expect(error.message).toMatch(/không xác định/);
  });

  it('video thật sự không khả dụng → vẫn báo đúng "không khả dụng", không thử lại', async () => {
    const error = await failWith({ code: 1, stdoutTail: '', stderrTail: 'ERROR: [youtube] abc: Video unavailable' });
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/không khả dụng/);
  });
});
