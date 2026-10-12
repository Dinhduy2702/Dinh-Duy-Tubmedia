import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { AppSettings, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// Lag bước 1 (2026-10-12). Trước đây mỗi danh sách tải tự dùng đủ downloadWorkers, độc lập hoàn toàn: 6 danh sách × 4 luồng
// = 24 tiến trình yt-dlp cùng lúc (mỗi lần mở yt-dlp tốn ≈0,77 s CPU). Quy trình ghép thì bị chặn theo TỔNG số video
// (maxGlobalMergeJobs × downloadWorkers) nên 6 quy trình vẫn cùng chạy, mỗi cái vài video. Giờ: tối đa N danh sách tải và
// maxGlobalMergeJobs quy trình ghép chạy "full" cùng lúc — mỗi cái vẫn đủ luồng theo hồ sơ (không chia nhỏ luồng); cái
// sau chờ lượt. Thêm trần riêng YouTube 6 video toàn ứng dụng (lưới an toàn chống 429). tick() THẬT trên CSDL thật.

type Internals = {
  tick: () => Promise<void>;
  schedulerRunning: boolean;
  active: Map<string, unknown>;
  autoConcurrentDownloadLists: () => number;
};

const resource: ResourceProfile = {
  id: 'resource-lists',
  name: 'Hồ sơ kiểm thử',
  description: '',
  downloadWorkers: 4,
  analyzeWorkers: 4,
  normalizeWorkers: 4,
  remuxWorkers: 4,
  clipWorkers: 4,
  ffmpegThreads: 2,
  filterThreads: 1,
  filterComplexThreads: 1,
  processPriority: 'below_normal',
  cpuSoftLimitPercent: 100,
  memoryFreeMinimumBytes: 0,
  diskFreeMinimumBytes: 0,
  gpuJobs: 0,
  builtIn: false
};

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let queue: QueueRepository;
let manager: QueueManager;
let settings: AppSettings;
let held: Map<string, () => void>;
let started: QueueJob[];

const internals = (): Internals => manager as unknown as Internals;
const tick = (): Promise<void> => internals().tick();
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

const makeProject = (name: string): Project => {
  const project = projects.create({
    name,
    sourceFolder: join(folder, name, 'nguon'),
    tempFolder: join(folder, name, 'tam'),
    outputFolder: join(folder, name, 'thanh-pham'),
    finalFileName: name,
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: resource.id
  });
  for (const sub of ['nguon', 'tam', 'thanh-pham']) mkdirSync(join(folder, name, sub), { recursive: true });
  return project;
};

let counter = 0;
const addDownloads = (project: Project, count: number, platform: 'tiktok' | 'youtube', extra: Record<string, unknown> = {}): QueueJob[] =>
  Array.from({ length: count }, () => {
    counter += 1;
    const url =
      platform === 'youtube'
        ? `https://www.youtube.com/watch?v=VID${String(counter).padStart(8, '0')}`
        : `https://www.tiktok.com/@kenh/video/${7100000000000 + counter}`;
    return queue.create({ projectId: project.id, type: 'download', input: { url, ...extra } });
  });
const startedIn = (project: Project): number => started.filter((job) => job.projectId === project.id).length;
const finishAll = async (project: Project): Promise<void> => {
  for (const job of started.filter((item) => item.projectId === project.id)) held.get(job.id)?.();
  await settle();
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-lists-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  held = new Map();
  started = [];
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 2, maxGlobalMergeJobs: 1 };
  const downloader = {
    run: vi.fn((job: QueueJob, _profile: unknown, _signal: unknown, onProgress: (progress: Record<string, unknown>) => void) => {
      started.push(job);
      onProgress({ percent: 10, speed: null, etaSeconds: null, stage: 'downloading' });
      return new Promise((resolve) =>
        held.set(job.id, () => resolve({ outputPath: join(folder, `${job.id}.mp4`), skipped: false, resultMessage: 'Đã tải.' }))
      );
    })
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    { get: () => settings, profiles: () => ({ qualities: builtInQualityProfiles, resources: [resource] }) } as never,
    downloader as never,
    {} as never,
    {} as never,
    { pauseByJob: vi.fn(() => Promise.resolve()) } as never,
    logger as never
  );
  internals().schedulerRunning = true;
});

afterEach(async () => {
  for (const release of held.values()) release();
  await settle();
  internals().schedulerRunning = false;
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('Lag bước 1 — trần số danh sách tải / quy trình ghép chạy cùng lúc, mỗi cái vẫn đủ luồng', () => {
  it('tối đa 2 danh sách tải chạy cùng lúc, MỖI danh sách đủ 4 luồng; danh sách thứ 3 chờ lượt rồi tự chạy khi một danh sách xong', async () => {
    const [a, b, c] = [makeProject('A'), makeProject('B'), makeProject('C')];
    for (const project of [a, b, c]) addDownloads(project, 5, 'tiktok');

    await tick();
    await settle();
    expect([startedIn(a), startedIn(b), startedIn(c)], 'A và B chạy đủ 4 luồng, C chờ').toEqual([4, 4, 0]);
    expect(manager.waitingLanes().downloadLists).toEqual([c.id]);

    await finishAll(a);
    await tick();
    await settle();
    expect(startedIn(a), 'A còn 1 video — vẫn giữ lượt').toBe(5);
    expect(startedIn(c), 'A chưa xong hẳn → C vẫn chờ').toBe(0);

    await finishAll(a);
    await tick();
    await settle();
    expect(startedIn(c), 'A xong hẳn → C vào lượt với đủ 4 luồng').toBe(4);
    expect(manager.waitingLanes().downloadLists).toEqual([]);
  });

  it('ô để "tự động" (0) dùng khuyến nghị phần cứng của máy', async () => {
    settings = { ...settings, maxConcurrentDownloadLists: 0 };
    internals().autoConcurrentDownloadLists = () => 1;
    const [a, b] = [makeProject('A'), makeProject('B')];
    for (const project of [a, b]) addDownloads(project, 3, 'tiktok');
    await tick();
    await settle();
    expect([startedIn(a), startedIn(b)]).toEqual([3, 0]);
  });

  it('quy trình ghép: tối đa maxGlobalMergeJobs quy trình chạy cùng lúc, mỗi quy trình đủ luồng tải (không chia đều cho mọi quy trình)', async () => {
    const [m1, m2] = [makeProject('Ghep 1'), makeProject('Ghep 2')];
    for (const project of [m1, m2]) addDownloads(project, 4, 'tiktok', { workflow: 'download-merge' });
    await tick();
    await settle();
    expect([startedIn(m1), startedIn(m2)]).toEqual([4, 0]);
    expect(manager.waitingLanes().mergeWorkflows).toEqual([m2.id]);
  });

  it('danh sách tải và quy trình ghép có trần riêng, không chiếm lượt của nhau', async () => {
    const [list, merge] = [makeProject('Danh sach'), makeProject('Ghep')];
    addDownloads(list, 2, 'tiktok');
    addDownloads(merge, 2, 'tiktok', { workflow: 'download-merge' });
    settings = { ...settings, maxConcurrentDownloadLists: 1, maxGlobalMergeJobs: 1 };
    await tick();
    await settle();
    expect([startedIn(list), startedIn(merge)]).toEqual([2, 2]);
  });

  it('YouTube tối đa 6 video toàn ứng dụng (cả làn ghép) dù 2 danh sách × 4 luồng = 8; nền tảng khác không bị trần này', async () => {
    settings = { ...settings, maxConcurrentDownloadLists: 2, maxGlobalMergeJobs: 1 };
    const [a, b, merge] = [makeProject('A'), makeProject('B'), makeProject('Ghep')];
    addDownloads(a, 4, 'youtube');
    addDownloads(b, 4, 'youtube');
    addDownloads(merge, 2, 'youtube', { workflow: 'download-merge' });
    await tick();
    await settle();
    const youtubeStarted = started.filter((job) => String(job.input.url).includes('youtube.com')).length;
    expect(youtubeStarted).toBe(6);

    const [tiktokA, tiktokB] = [makeProject('T1'), makeProject('T2')];
    settings = { ...settings, maxConcurrentDownloadLists: 4 };
    addDownloads(tiktokA, 4, 'tiktok');
    addDownloads(tiktokB, 4, 'tiktok');
    await tick();
    await settle();
    expect(startedIn(tiktokA) + startedIn(tiktokB)).toBe(8);
  });
});
