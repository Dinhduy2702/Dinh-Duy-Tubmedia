import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '@main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '@main/media/quarantine-service.js';
import { DownloadEngine } from '@main/downloader/download-engine.js';
import { builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { WINDOWS_MAX_PATH_LENGTH } from '@shared/utils/download-path-budget.js';
import type { AppError } from '@shared/errors/app-errors.js';
import type { AppSettings, MediaInfo, Project, QueueJob } from '@shared/types/domain.js';

// 2026-10-23: video Facebook có tiêu đề dài không tải được vì đường dẫn tệp tạm vượt MAX_PATH (260) của Windows; lỗi bị xếp
// "không xác định, không thử lại"; tệp .part nằm ngay thư mục video vì -o là đường dẫn tuyệt đối nên yt-dlp bỏ qua
// --paths temp. Bài này chạy DownloadEngine.run() THẬT trên CSDL thật, chỉ giả lập tiến trình yt-dlp.

const FB_URL =
  'https://www.facebook.com/armsfamilyhomestead/videos/these-pigs-are-looking-for-a-way-into-the-pecan-farm-its-just-a-matter-of-time-b/1589967605531745/';
const FB_ID = '1589967605531745';
const LONG_TITLE = `610K views · 8.6K reactions ｜ ${'These pigs are looking for a way into the pecan farm! '.repeat(6)}｜ Arms Family Homestead`;

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let sources: MediaSourceRepository;
let engine: DownloadEngine;
let settings: AppSettings;
let ytdlpArgs: string[][];
/** Lượt yt-dlp giả tiếp theo báo lỗi này (rồi tự xóa); null → tải thành công. */
let nextFailure: string | null;

const mediaInfo: MediaInfo = {
  duration: 15,
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

const makeProject = (sourceFolder: string, tempFolder = join(folder, 'tam')): Project => {
  mkdirSync(sourceFolder, { recursive: true });
  return projects.create({
    name: `ds-${randomUUID().slice(0, 8)}`,
    sourceFolder,
    tempFolder,
    outputFolder: join(folder, 'thanh-pham'),
    finalFileName: 'ds',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
};

const insertSource = (projectId: string): string => {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'unknown',NULL,?,?)`
    )
    .run(id, `facebook:facebook:${FB_ID}::project:${projectId}`, FB_URL, FB_URL, 'facebook', 'facebook', FB_ID, now, now);
  return id;
};

const jobFor = (projectId: string, sourceId: string, id = randomUUID(), attempts = 0): QueueJob => ({
  id,
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
const run = (job: QueueJob): Promise<unknown> => engine.run(job, resource, new AbortController().signal, () => undefined);
const runError = async (job: QueueJob): Promise<AppError> => {
  try {
    await run(job);
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Lượt tải lẽ ra phải lỗi.');
};

const pathsValues = (args: string[]): string[] => args.flatMap((arg, index) => (args[index - 1] === '--paths' ? [arg] : []));
const templateOf = (args: string[]): string => args[args.indexOf('-o') + 1] ?? '';
const titleBytesOf = (template: string): number | null => {
  const match = /%\(title\)\.(\d+)B/.exec(template);
  return match ? Number(match[1]) : null;
};
/** Cắt theo byte UTF-8 như %(title).NB của yt-dlp. */
const truncateBytes = (text: string, bytes: number): string => {
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char) > bytes) break;
    out += char;
  }
  return out;
};
/** Tên tệp yt-dlp thật sẽ đặt theo mẫu (không gồm đuôi). */
const nameFor = (template: string): string =>
  template
    .replace(/\.%\(ext\)s$/, '')
    .replace(/%\(title\)\.(\d+)B/, (_match, bytes: string) => truncateBytes(LONG_TITLE, Number(bytes)))
    .replace('%(id)s', FB_ID);

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-path-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  settings = { ...defaultAppSettings, cookiesFilePath: '', cookiesBrowser: 'none', useAria2c: false };
  ytdlpArgs = [];
  nextFailure = null;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const toolsGet = vi.fn((name: string) =>
    name === 'yt-dlp' ? { available: true, executablePath: join(folder, 'yt-dlp-gia.exe') } : { available: false, executablePath: null }
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
          ? { ok: true, path, level, reasons: [], duration: 15 }
          : { ok: false, path, level, reasons: ['Tệp không tồn tại.'], duration: 0 }
      )
    ),
    measureAudio: vi.fn(() => Promise.resolve({ meanVolumeDb: -20, maxVolumeDb: -3 }))
  };
  // yt-dlp giả: như yt-dlp thật, mẫu -o tương đối được đặt trong thư mục "home:" của --paths.
  const processes = {
    run: vi.fn((options: { tool?: string; args: string[]; onStdoutLine?: (line: string) => void }) => {
      ytdlpArgs.push(options.args);
      if (nextFailure) {
        const stderrTail = nextFailure;
        nextFailure = null;
        return Promise.resolve({ code: 1, stdoutTail: '', stderrTail });
      }
      const template = templateOf(options.args);
      const home = pathsValues(options.args).find((value) => value.startsWith('home:'))?.slice('home:'.length) ?? '';
      const relativeName = template.replace(/%\((\w+)\)[.\d]*[sB]/g, (_match, field: string) =>
        field === 'ext' ? 'mp4' : field === 'id' ? FB_ID : 'Video'
      );
      const output = isAbsolute(relativeName) ? relativeName : join(home, relativeName);
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

/** Thư mục nguồn có tổng độ dài đúng `length` ký tự (giả lập "E:\DinhDuy\NA401_Bẫy lợn\video" cộng phần sâu hơn). */
const folderOfLength = (name: string, length: number): string => {
  const base = join(folder, name);
  return join(base, 'v'.repeat(Math.max(1, length - base.length - 1)));
};

describe('Tệp tạm của yt-dlp nằm trong thư mục tạm, không nằm cạnh video', () => {
  it('mẫu -o là tên tương đối; --paths home: = thư mục nguồn, temp: = thư mục tạm riêng của danh sách', async () => {
    const project = makeProject(join(folder, 'video'));
    await run(jobFor(project.id, insertSource(project.id)));
    const args = ytdlpArgs[0]!;
    const template = templateOf(args);
    expect(isAbsolute(template)).toBe(false);
    expect(template).toMatch(/ \[%\(id\)s\] \[LINK_[A-F0-9]{12}\]\.%\(ext\)s$/);
    const workFolder = join(project.tempFolder, '_dl', project.id.slice(0, 8));
    expect(pathsValues(args)).toEqual([`home:${project.sourceFolder}`, `temp:${workFolder}`]);
    expect(statSync(workFolder).isDirectory()).toBe(true);
  });
});

describe('Tên tệp tự rút ngắn để đường dẫn dưới 260 ký tự', () => {
  it('thư mục dài như máy thật: tiêu đề được cắt ngắn hơn mức cũ, mọi tệp tạm/tệp cuối ≤ 259 ký tự', async () => {
    const project = makeProject(folderOfLength('nguon', 90), folderOfLength('tam', 60));
    await run(jobFor(project.id, insertSource(project.id)));
    const template = templateOf(ytdlpArgs[0]!);
    const bytes = titleBytesOf(template);
    expect(bytes).not.toBeNull();
    expect(bytes!).toBeLessThan(165);
    const name = nameFor(template);
    const workFolder = join(project.tempFolder, '_dl', project.id.slice(0, 8));
    for (const path of [
      join(workFolder, `${name}.f1205344837823463v.mp4.part`),
      join(workFolder, `${name}.f1205344837823463v.mp4.part-Frag12345.part`),
      join(project.sourceFolder, `${name}.mp4`)
    ]) {
      expect(path.length).toBeLessThanOrEqual(WINDOWS_MAX_PATH_LENGTH);
    }
  });

  it('thư mục quá dài, không tên nào vừa → báo rõ ràng, không chạy yt-dlp, không thử lại vô ích', async () => {
    const project = makeProject(folderOfLength('nguon', 225));
    const error = await runError(jobFor(project.id, insertSource(project.id)));
    expect(ytdlpArgs).toHaveLength(0);
    expect(error.code).toBe('DOWNLOAD_FAILED');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Thư mục lưu video quá dài');
    expect(error.message).toContain(project.sourceFolder);
    expect(error.details).toMatchObject({ failureSubtype: 'path_too_long', reason: 'DOWNLOAD_FOLDER_TOO_LONG' });
  });
});

describe('yt-dlp báo đường dẫn quá dài → câu báo rõ ràng + tự thử lại với tên ngắn hơn', () => {
  const realError = (length: number): string =>
    `ERROR: unable to open for writing: [Errno 2] No such file or directory: 'E:\\\\${'x'.repeat(length - 3)}'`;

  it('lần 1 lỗi → thử lại được, nói rõ nguyên nhân; lần 2 tiêu đề ngắn một nửa; lần 3 bỏ tiêu đề', async () => {
    const project = makeProject(join(folder, 'video'));
    const sourceId = insertSource(project.id);
    const jobId = randomUUID();

    nextFailure = realError(262);
    const first = await runError(jobFor(project.id, sourceId, jobId, 0));
    expect(first.code).toBe('DOWNLOAD_FAILED');
    expect(first.retryable).toBe(true);
    expect(first.message).toContain('đường dẫn tệp quá dài (262 ký tự)');
    expect(first.message).toContain('tự rút ngắn tên tệp và thử lại');
    expect(first.details).toMatchObject({ failureSubtype: 'path_too_long', pathLength: 262 });
    const firstBytes = titleBytesOf(templateOf(ytdlpArgs[0]!))!;

    nextFailure = realError(261);
    await runError(jobFor(project.id, sourceId, jobId, 1));
    expect(titleBytesOf(templateOf(ytdlpArgs[1]!))).toBe(Math.floor(firstBytes / 2));

    await run(jobFor(project.id, sourceId, jobId, 2));
    const third = templateOf(ytdlpArgs[2]!);
    expect(third.startsWith('Video [%(id)s]')).toBe(true);
    expect(titleBytesOf(third)).toBeNull();
  });

  it('lỗi khác ở lần thử lại không làm đổi tên tệp (giữ tệp .part để tải tiếp)', async () => {
    const project = makeProject(join(folder, 'video'));
    const sourceId = insertSource(project.id);
    const jobId = randomUUID();
    nextFailure = 'ERROR: [facebook] 1589967605531745: HTTP Error 503: Service Unavailable';
    await runError(jobFor(project.id, sourceId, jobId, 0));
    await run(jobFor(project.id, sourceId, jobId, 1));
    expect(templateOf(ytdlpArgs[1]!)).toBe(templateOf(ytdlpArgs[0]!));
  });
});
