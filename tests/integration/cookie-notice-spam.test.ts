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
import { AppError } from '@shared/errors/app-errors.js';
import { IPC } from '@shared/contracts/channels.js';
import type { AppSettings, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// 2026-11-05 (người dùng báo): "cứ có link nào cần cookies nó lại spam thông báo lên". Thông báo chặn vì cookies chỉ chặn
// trùng theo (danh sách, mã lỗi) — 3 mã cookie × mỗi danh sách — và mỗi lần hiện đều kéo cửa sổ app lên trước, lấy focus.

type Internals = { tick: () => Promise<void>; schedulerRunning: boolean; tickRunning: boolean; cpuPercent: () => number };

const resource: ResourceProfile = {
  id: 'resource-cookie-notice',
  name: 'Hồ sơ kiểm thử',
  description: '',
  downloadWorkers: 4,
  analyzeWorkers: 2,
  normalizeWorkers: 2,
  remuxWorkers: 2,
  clipWorkers: 2,
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
let failCode: Map<string, string>;
let send: ReturnType<typeof vi.fn>;
let focus: ReturnType<typeof vi.fn>;

const internals = (): Internals => manager as unknown as Internals;
const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const runTicks = async (count: number): Promise<void> => {
  for (let round = 0; round < count; round += 1) {
    vi.setSystemTime(Date.now() + 1_000);
    while (internals().tickRunning) await settle(5);
    internals().tickRunning = true;
    try {
      await internals().tick();
    } finally {
      internals().tickRunning = false;
    }
    await settle(40);
  }
};
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
const addFailing = (project: Project, codes: string[]): void => {
  for (const code of codes) {
    counter += 1;
    const job = queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: `https://www.youtube.com/watch?v=cookie${String(counter).padStart(5, '0')}` }
    });
    failCode.set(job.id, code);
  }
};
const cookieNotices = (): unknown[] =>
  send.mock.calls
    .filter((call) => call[0] === IPC.events.attention)
    .map((call) => call[1] as { code?: string })
    .filter((notice) => ['AUTHENTICATION_REQUIRED', 'COOKIES_EXPIRED', 'BROWSER_COOKIE_DATABASE_LOCKED'].includes(notice.code ?? ''));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-cookie-notice-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 6, downloadAdaptiveBoost: false };
  failCode = new Map();
  send = vi.fn();
  focus = vi.fn();
  const downloader = {
    run: vi.fn(async (job: QueueJob) => {
      await settle(5);
      throw new AppError(failCode.get(job.id) ?? 'COOKIES_EXPIRED', 'Video cần đăng nhập.');
    })
  };
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
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
  );
  manager.setWindow({
    isDestroyed: () => false,
    isVisible: () => false,
    isMinimized: () => true,
    show: vi.fn(),
    restore: vi.fn(),
    flashFrame: vi.fn(),
    focus,
    webContents: { send }
  } as never);
  internals().schedulerRunning = true;
  internals().cpuPercent = () => 0;
});

afterEach(async () => {
  internals().schedulerRunning = false;
  await settle(200);
  database.close();
  rmSync(folder, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('thông báo cần cookies không bị lặp', () => {
  it('nhiều video ở nhiều danh sách cùng cần cookies (đủ 3 loại mã) → chỉ 1 thông báo, kéo cửa sổ lên tối đa 1 lần', async () => {
    addFailing(makeProject('TH197'), ['COOKIES_EXPIRED', 'AUTHENTICATION_REQUIRED', 'BROWSER_COOKIE_DATABASE_LOCKED']);
    addFailing(makeProject('Y383'), ['COOKIES_EXPIRED', 'AUTHENTICATION_REQUIRED', 'COOKIES_EXPIRED']);
    addFailing(makeProject('TA801'), ['BROWSER_COOKIE_DATABASE_LOCKED', 'COOKIES_EXPIRED']);

    await runTicks(12);

    const paused = queue.list().filter((job) => job.status === 'paused').length;
    expect(paused, 'cả 8 video đều dừng chờ cookies').toBe(8);
    expect(cookieNotices().length, 'một vấn đề cookies cho cả app = một thông báo').toBe(1);
    expect(focus.mock.calls.length, 'không giành focus của người dùng nhiều lần').toBeLessThanOrEqual(1);
  });

  it('video cần cookies tiếp tục xuất hiện sau đó (danh sách mới thêm) → vẫn không báo lại khi chưa sửa cookies', async () => {
    addFailing(makeProject('TH198'), ['COOKIES_EXPIRED']);
    await runTicks(6);
    expect(cookieNotices().length).toBe(1);

    addFailing(makeProject('TH199'), ['AUTHENTICATION_REQUIRED', 'COOKIES_EXPIRED']);
    await runTicks(6);

    expect(cookieNotices().length, 'cùng một vấn đề cookies — không hiện thêm').toBe(1);
  });

  it('người dùng bấm Tiếp tục mà vẫn cần cookies → báo lại 1 lần (không nuốt mất thông báo)', async () => {
    const list = makeProject('TH200');
    addFailing(list, ['COOKIES_EXPIRED', 'COOKIES_EXPIRED']);
    await runTicks(6);
    expect(cookieNotices().length).toBe(1);

    await manager.resumeProject(list.id);
    await runTicks(6);

    expect(cookieNotices().length, 'mỗi lần người dùng chủ động chạy lại mà vẫn lỗi: đúng 1 thông báo').toBe(2);
  });
});
