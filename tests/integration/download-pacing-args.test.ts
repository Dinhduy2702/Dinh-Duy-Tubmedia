import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import type { DownloadPacingContext } from '@shared/utils/download-pacing.js';
import type { AppSettings, MediaInfo, Project, QueueJob } from '@shared/types/domain.js';

// Hướng C kế hoạch 429 (2026-10-13). Trước đây yt-dlp không nghỉ giữa các yêu cầu dù 6 video YouTube cùng tải hay nền tảng
// vừa trả 429. Chỉ giãn nhịp — số kết nối giữ nguyên như thực tế (người dùng chọn). Bài này chạy DownloadEngine.run() THẬT
// trên CSDL thật, chỉ giả lập tiến trình yt-dlp để bắt đúng tham số dòng lệnh.

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let sources: MediaSourceRepository;
let engine: DownloadEngine;
let settings: AppSettings;
let ytdlpArgs: string[][];

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

/** Tải một video rồi trả về tham số dòng lệnh yt-dlp nhận được. */
const argsFor = async (platform: string, url: string, pacing?: DownloadPacingContext, attempts = 0): Promise<string[]> => {
  const project = makeProject(`ds-${randomUUID().slice(0, 8)}`);
  const sourceId = insertSource(project.id, url, platform, randomUUID().slice(0, 11));
  ytdlpArgs = [];
  await engine.run(jobFor(project.id, sourceId, attempts), resource, new AbortController().signal, () => undefined, pacing);
  expect(ytdlpArgs).toHaveLength(1);
  return ytdlpArgs[0]!;
};
const ariaArgsOf = (args: string[]): string => args[args.indexOf('--downloader-args') + 1] ?? '';
const valueAfter = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
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
  // yt-dlp giả: ghi tệp đúng theo mẫu -o rồi báo đường dẫn như yt-dlp thật (__VDMSP_FILE__).
  const processes = {
    run: vi.fn((options: { tool?: string; args: string[]; onStdoutLine?: (line: string) => void }) => {
      ytdlpArgs.push(options.args);
      const template = options.args[options.args.indexOf('-o') + 1] ?? '';
      const output = template.replace(/%\((\w+)\)[.\d]*[sB]/g, (_match, field: string) =>
        field === 'ext' ? 'mp4' : field === 'id' ? 'ID' : 'Video'
      );
      writeFileSync(output, Buffer.alloc(5000, 7));
      options.onStdoutLine?.(`__VDMSP_FILE__:${output}`);
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '' });
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

describe('Hướng C 429 — bộ tải giãn nhịp với nền tảng', () => {
  const youtube = 'https://www.youtube.com/watch?v=abcDEF12345';
  const UNCHANGED_ARIA = 'aria2c:-x 16 -s 16 -k 8M --file-allocation=none --summary-interval=0 --console-log-level=warn --retry-wait=3 --max-tries=10 --continue=true --allow-overwrite=true';

  it('6 video YouTube cùng tải: yt-dlp nghỉ ~1 s giữa các yêu cầu và 1–3 s trước khi tải; phần aria2c giữ nguyên', async () => {
    const args = await argsFor('youtube', youtube, { samePlatformActive: 6, rateLimitStrikes: 0 });
    expect(valueAfter(args, '--sleep-requests')).toBe('1');
    expect(valueAfter(args, '--sleep-interval')).toBe('1');
    expect(valueAfter(args, '--max-sleep-interval')).toBe('3');
    expect(ariaArgsOf(args)).toBe(UNCHANGED_ARIA);
  });

  it('một video YouTube lẻ: không nghỉ', async () => {
    const args = await argsFor('youtube', youtube, { samePlatformActive: 1, rateLimitStrikes: 0 });
    expect(args).not.toContain('--sleep-requests');
  });

  it('YouTube vừa dính 429 (lần 2): nghỉ lâu hơn — 2 s giữa yêu cầu, 3–8 s trước khi tải', async () => {
    const args = await argsFor('youtube', youtube, { samePlatformActive: 1, rateLimitStrikes: 2 });
    expect(valueAfter(args, '--sleep-requests')).toBe('2');
    expect(valueAfter(args, '--sleep-interval')).toBe('3');
    expect(valueAfter(args, '--max-sleep-interval')).toBe('8');
  });

  it('link tệp trực tiếp: giữ nguyên như cũ (không nghỉ)', async () => {
    const args = await argsFor('cdn.example.com', 'https://cdn.example.com/video.mp4', { samePlatformActive: 6, rateLimitStrikes: 0 });
    expect(args).not.toContain('--sleep-requests');
    expect(ariaArgsOf(args)).toBe(UNCHANGED_ARIA);
  });

  it('lần thử lại (không kèm cờ aria2c) vẫn được giãn nhịp theo nền tảng', async () => {
    const args = await argsFor('youtube', youtube, { samePlatformActive: 3, rateLimitStrikes: 0 }, 1);
    expect(args).not.toContain('--downloader-args');
    expect(valueAfter(args, '--sleep-requests')).toBe('1');
  });
});
