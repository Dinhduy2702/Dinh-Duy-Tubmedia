import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DOWNLOAD_TEMP_IDLE_MAX_MS,
  downloadWorkFolder,
  mergeCachesIdle,
  removeDownloadWorkFolder,
  removeMergeCaches,
  removeVideoDownloadTemp,
  sweepDownloadTemp
} from '@main/files/download-temp-cleanup.js';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { downloadLinkTag } from '@shared/utils/url.js';
import type { AppSettings, Project, QueueJob } from '@shared/types/domain.js';

// 2026-10-24 (người dùng yêu cầu): Tubmedia luôn tự dọn tệp tạm — tải xong, tải lỗi, huỷ giữa chừng, và tệp mồ côi còn sót
// từ phiên trước (tắt đột ngột / mất điện) — không bắt người dùng xoá tay. Chạy trên thư mục tạm thật của hệ điều hành.

let folder = '';
const none = { protectedFolders: [] as string[], protectedFiles: [] as string[] };
const LINK_A = 'LINK_AAAAAAAAAAAA';
const LINK_B = 'LINK_BBBBBBBBBBBB';

const touch = (path: string, ageMs = 0): void => {
  writeFileSync(path, 'x');
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    utimesSync(path, when, when);
  }
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-temp-cleanup-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('tệp tạm của từng video và từng danh sách', () => {
  it('video xong/lỗi/huỷ: chỉ xoá tệp tạm mang mã liên kết của video đó, giữ tệp của video khác đang tải', async () => {
    const work = downloadWorkFolder(join(folder, 'tam'), 'abcdef12-3456');
    mkdirSync(work, { recursive: true });
    touch(join(work, `Video A [id1] [${LINK_A}].f137.mp4.part`));
    touch(join(work, `Video A [id1] [${LINK_A}].f137.mp4.ytdl`));
    touch(join(work, `Video A [id1] [${LINK_A}].f270.mp4.part-Frag12`));
    touch(join(work, `Video B [id2] [${LINK_B}].f140.m4a.part`));
    expect(await removeVideoDownloadTemp(work, LINK_A, none)).toBe(3);
    expect(readdirSync(work)).toEqual([`Video B [id2] [${LINK_B}].f140.m4a.part`]);
  });

  it('danh sách không còn gì để tải tiếp: xoá cả thư mục làm việc; "_dl" chỉ xoá khi đã rỗng', async () => {
    const temp = join(folder, 'tam');
    const workA = downloadWorkFolder(temp, 'aaaaaaaa-1');
    const workB = downloadWorkFolder(temp, 'bbbbbbbb-1');
    mkdirSync(join(workA, 'con'), { recursive: true });
    mkdirSync(workB, { recursive: true });
    touch(join(workA, 'x.part'));
    touch(join(workA, 'con', 'y.part'));
    touch(join(workB, 'z.part'));
    expect(await removeDownloadWorkFolder(workA, none)).toBe(2);
    expect(existsSync(workA)).toBe(false);
    expect(existsSync(join(temp, '_dl')), 'còn thư mục của danh sách khác').toBe(true);
    await removeDownloadWorkFolder(workB, none);
    expect(existsSync(join(temp, '_dl')), 'đã rỗng → xoá').toBe(false);
    expect(existsSync(temp), 'không bao giờ xoá thư mục tạm người dùng chọn').toBe(true);
  });

  it('an toàn: không xoá thư mục sai dạng, thư mục người dùng chọn, hay lối tắt trỏ ra ngoài', async () => {
    const notWork = join(folder, 'tam', '_dl', 'khong-phai-ma');
    mkdirSync(notWork, { recursive: true });
    touch(join(notWork, `a [${LINK_A}].part`));
    expect(await removeVideoDownloadTemp(notWork, LINK_A, none)).toBe(0);

    const chosen = downloadWorkFolder(join(folder, 'tam'), 'cccccccc-1');
    mkdirSync(chosen, { recursive: true });
    touch(join(chosen, `a [${LINK_A}].part`));
    expect(await removeVideoDownloadTemp(chosen, LINK_A, { protectedFolders: [chosen], protectedFiles: [] })).toBe(0);
    expect(await removeDownloadWorkFolder(chosen, { protectedFolders: [join(chosen, 'video')], protectedFiles: [] })).toBe(0);

    const outside = join(folder, 'du-lieu-that');
    mkdirSync(outside, { recursive: true });
    touch(join(outside, `quan-trong [${LINK_A}].mp4`));
    const link = downloadWorkFolder(join(folder, 'tam2'), 'dddddddd-1');
    mkdirSync(join(folder, 'tam2', '_dl'), { recursive: true });
    symlinkSync(outside, link, 'junction');
    expect(await removeVideoDownloadTemp(link, LINK_A, none)).toBe(0);
    expect(await removeDownloadWorkFolder(link, none)).toBe(0);
    expect(readdirSync(outside)).toEqual([`quan-trong [${LINK_A}].mp4`]);
  });
});

describe('quét tệp tạm mồ côi (khi mở app và định kỳ)', () => {
  it('xoá thư mục của danh sách đã xoá / đã xong / bỏ quên quá 14 ngày; giữ danh sách còn tải tiếp gần đây', async () => {
    const temp = join(folder, 'tam');
    const make = (name: string, ageMs = 0): string => {
      const work = join(temp, '_dl', name);
      mkdirSync(work, { recursive: true });
      touch(join(work, 'x.part'), ageMs);
      return work;
    };
    const deleted = make('11111111', 2 * 60 * 60_000);
    const otherAppActive = make('55555555', 30_000); // không có trong CSDL nhưng vừa ghi → có thể của Tubmedia khác đang tải
    const finished = make('22222222');
    const pausedRecent = make('33333333', 60_000);
    const pausedForgotten = make('44444444', DOWNLOAD_TEMP_IDLE_MAX_MS + 60_000);
    mkdirSync(join(temp, '_dl', 'thu-muc-khac'), { recursive: true });
    touch(join(temp, '_dl', 'tep-le.txt'));

    const report = await sweepDownloadTemp({
      tempFolders: [temp, temp.toUpperCase()],
      resumableByWorkName: new Map([
        ['22222222', false],
        ['33333333', true],
        ['44444444', true]
      ]),
      protection: none
    });
    expect(report).toEqual({ removedFolders: 3, removedFiles: 3 });
    expect([deleted, finished, pausedRecent, pausedForgotten].map((work) => existsSync(work))).toEqual([false, false, true, false]);
    expect(existsSync(otherAppActive), 'thư mục lạ vừa được ghi (dưới 1 giờ) → chưa coi là mồ côi').toBe(true);
    expect(existsSync(join(temp, '_dl', 'thu-muc-khac')), 'không đụng thư mục lạ').toBe(true);
    expect(existsSync(join(temp, '_dl', 'tep-le.txt'))).toBe(true);
  });

  it('bản đệm ghép: chỉ xoá thư mục có dấu sở hữu Tubmedia; nhận biết bản đệm bỏ lâu', async () => {
    const temp = join(folder, 'tam');
    const owned = join(temp, '_normalized-cache');
    const foreign = join(temp, '_remux-cache');
    mkdirSync(owned, { recursive: true });
    mkdirSync(foreign, { recursive: true });
    writeFileSync(
      join(owned, '.tubmedia-owned.json'),
      JSON.stringify({ owner: 'Tubmedia', purpose: 'normalize-cache', createdAt: new Date().toISOString(), version: 1 })
    );
    touch(join(owned, 'a.mp4'), DOWNLOAD_TEMP_IDLE_MAX_MS + 60_000);
    touch(join(foreign, 'cua-nguoi-dung.mp4'));
    expect(await mergeCachesIdle(temp), 'bản đệm của người khác vừa sửa → chưa bỏ lâu').toBe(false);
    expect(await removeMergeCaches(temp, none)).toBe(1);
    expect(existsSync(owned)).toBe(false);
    expect(existsSync(join(foreign, 'cua-nguoi-dung.mp4')), 'không có dấu sở hữu → không xoá').toBe(true);
  });
});

// ---- Hàng đợi thật trên CSDL thật: nối việc dọn vào đúng lúc ----
type Internals = {
  cleanupVideoDownloadTemp: (jobId: string) => Promise<void>;
  cleanupProjectTemporaryArtifacts: (projectId: string, preserve?: boolean) => Promise<void>;
};

describe('hàng đợi tự dọn đúng lúc', () => {
  let database: AppDatabase;
  let projects: ProjectRepository;
  let queue: QueueRepository;
  let manager: QueueManager;
  let settings: AppSettings;

  beforeEach(() => {
    database = new AppDatabase(join(folder, 'db.sqlite'));
    projects = new ProjectRepository(database.db);
    queue = new QueueRepository(database.db);
    settings = { ...defaultAppSettings };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    manager = new QueueManager(
      queue,
      projects,
      new ItemRepository(database.db),
      new MediaSourceRepository(database.db),
      { get: () => settings, profiles: () => ({ qualities: builtInQualityProfiles, resources: builtInResourceProfiles }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { pauseByJob: vi.fn(() => Promise.resolve()) } as never,
      logger as never
    );
  });
  afterEach(() => database.close());

  const internals = (): Internals => manager as unknown as Internals;
  const makeProject = (name: string): Project => {
    const project = projects.create({
      name,
      sourceFolder: join(folder, name, 'video'),
      tempFolder: join(folder, name, 'tam'),
      outputFolder: join(folder, name, 'thanh-pham'),
      finalFileName: name,
      qualityProfileId: builtInQualityProfiles[0]!.id,
      resourceProfileId: builtInResourceProfiles[0]!.id
    });
    mkdirSync(project.sourceFolder, { recursive: true });
    return project;
  };
  const addVideo = (project: Project, url: string, status: QueueJob['status']): { job: QueueJob; tag: string } => {
    const id = randomUUID();
    const now = new Date().toISOString();
    database.db
      .prepare(
        `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'unknown',NULL,?,?)`
      )
      .run(id, `youtube:${id}`, url, url, 'youtube', 'youtube', id.slice(0, 11), now, now);
    const job = queue.create({ projectId: project.id, type: 'download', sourceId: id, input: { url } });
    // Đi đúng đường chuyển trạng thái của kho tác vụ: chờ → đang tải → trạng thái cần thử.
    if (status !== 'pending') queue.update(job.id, { status: 'downloading' });
    if (status !== 'pending' && status !== 'downloading') queue.update(job.id, { status });
    return { job, tag: downloadLinkTag(url) };
  };
  const tempOf = (project: Project, tag: string): string => {
    const work = downloadWorkFolder(project.tempFolder, project.id);
    mkdirSync(work, { recursive: true });
    const file = join(work, `Video [x] [${tag}].f137.mp4.part`);
    touch(file);
    return file;
  };

  it('video tải lỗi hẳn / bị huỷ / tải xong → xoá tệp tạm của nó; đang chờ thử lại hoặc tạm dừng → giữ để tải tiếp', async () => {
    const project = makeProject('A');
    const cases: Array<[QueueJob['status'], boolean]> = [
      ['failed', false],
      ['cancelled', false],
      ['completed', false],
      ['retrying', true],
      ['paused', true],
      ['interrupted', true]
    ];
    for (const [status, kept] of cases) {
      const { job, tag } = addVideo(project, `https://www.youtube.com/watch?v=${randomUUID().slice(0, 11)}`, status);
      const file = tempOf(project, tag);
      await internals().cleanupVideoDownloadTemp(job.id);
      expect(existsSync(file), `trạng thái ${status}`).toBe(kept);
    }
  });

  it('danh sách xong hết (không còn gì để tải tiếp) → xoá cả thư mục tải dở của nó; còn video tạm dừng thì giữ', async () => {
    const done = makeProject('Xong');
    const doneVideo = addVideo(done, 'https://www.youtube.com/watch?v=AAAAAAAAAAA', 'failed');
    const doneFile = tempOf(done, doneVideo.tag);
    await internals().cleanupProjectTemporaryArtifacts(done.id, true);
    expect(existsSync(doneFile)).toBe(false);
    expect(existsSync(downloadWorkFolder(done.tempFolder, done.id))).toBe(false);

    const paused = makeProject('Dang-dung');
    const pausedVideo = addVideo(paused, 'https://www.youtube.com/watch?v=BBBBBBBBBBB', 'paused');
    const pausedFile = tempOf(paused, pausedVideo.tag);
    await internals().cleanupProjectTemporaryArtifacts(paused.id);
    expect(existsSync(pausedFile), 'còn video tạm dừng → giữ phần đã tải').toBe(true);
  });

  it('quét khi mở app: thư mục của danh sách đã xoá bị dọn, của danh sách còn tạm dừng được giữ', async () => {
    const paused = makeProject('Dang-dung');
    const pausedVideo = addVideo(paused, 'https://www.youtube.com/watch?v=CCCCCCCCCCC', 'paused');
    const pausedFile = tempOf(paused, pausedVideo.tag);
    const orphan = join(paused.tempFolder, '_dl', 'deadbeef');
    mkdirSync(orphan, { recursive: true });
    touch(join(orphan, 'mo-coi.part'), 2 * 60 * 60_000);
    await manager.sweepOrphanTemporaryFiles();
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(pausedFile)).toBe(true);
  });
});
