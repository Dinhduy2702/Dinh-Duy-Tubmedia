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
import { CookiesExpiredError } from '@shared/errors/app-errors.js';
import { IPC } from '@shared/contracts/channels.js';
import type { AppSettings, Project, ResourceProfile } from '@shared/types/domain.js';

// 1.7.6 việc B (người dùng 2026-11-07): yt-dlp báo "cookies are no longer valid … likely been rotated" (trình duyệt đã xoay
// cookie vì vẫn dùng tiếp phiên đã xuất) nhưng app chỉ báo chung "hết hạn hoặc không còn hợp lệ" → người dùng xuất lại từ
// cùng phiên và cookie lại hỏng sau vài phút (03/11: 20/18/80/0/144 phút). Thông báo phải nói rõ lý do + cách xuất đúng.

type Internals = { tick: () => Promise<void>; schedulerRunning: boolean; tickRunning: boolean; cpuPercent: () => number };
type Notice = { code?: string; title?: string; message?: string; steps?: string[] };

const resource: ResourceProfile = {
  id: 'resource-cookie-rotated',
  name: 'Hồ sơ kiểm thử',
  description: '',
  downloadWorkers: 2,
  analyzeWorkers: 1,
  normalizeWorkers: 1,
  remuxWorkers: 1,
  clipWorkers: 1,
  ffmpegThreads: 1,
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
let send: ReturnType<typeof vi.fn>;
let failure: () => Error;

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
const cookieNotices = (): Notice[] =>
  send.mock.calls
    .filter((call) => call[0] === IPC.events.attention)
    .map((call) => call[1] as Notice)
    .filter((notice) => notice.code === 'COOKIES_EXPIRED');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-cookie-rotated-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 2, downloadAdaptiveBoost: false };
  send = vi.fn();
  failure = () => new CookiesExpiredError({ failureCategory: 'authentication', failureSubtype: 'cookies_invalid' });
  const downloader = {
    run: vi.fn(async () => {
      await settle(5);
      throw failure();
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
    isVisible: () => true,
    isMinimized: () => false,
    show: vi.fn(),
    restore: vi.fn(),
    flashFrame: vi.fn(),
    focus: vi.fn(),
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

describe('cookie bị trình duyệt xoay: thông báo nói rõ lý do và cách lấy lại đúng', () => {
  it('yt-dlp báo cookie bị xoay → thông báo và lỗi của video nói "xoay" + hướng dẫn xuất từ cửa sổ ẩn danh rồi đóng ngay', async () => {
    const list = makeProject('TH205');
    queue.create({ projectId: list.id, type: 'download', input: { url: 'https://www.youtube.com/watch?v=rotated0001' } });

    await runTicks(6);

    const notices = cookieNotices();
    expect(notices.length).toBe(1);
    const notice = notices[0]!;
    expect(notice.title, 'tiêu đề nói rõ cookie bị trình duyệt xoay, không chỉ "hết hạn"').toMatch(/xoay/i);
    const steps = (notice.steps ?? []).join(' ');
    expect(steps, 'các bước chỉ cách xuất đúng').toMatch(/ẩn danh/i);
    expect(steps, 'phải dặn đóng cửa sổ ẩn danh ngay sau khi xuất').toMatch(/đóng/i);

    const job = queue.list().find((item) => item.projectId === list.id)!;
    expect(job.status).toBe('paused');
    expect(job.errorMessage ?? '', 'lỗi của video cũng nói lý do + cách lấy lại').toMatch(/xoay/i);
    expect(job.errorMessage ?? '').toMatch(/ẩn danh/i);
  });

  it('cookie hết hạn thường (không phải bị xoay) → giữ thông báo cũ, không nói nhầm là bị xoay', async () => {
    failure = () => new CookiesExpiredError({ failureCategory: 'authentication', failureSubtype: 'authentication' });
    const list = makeProject('TH206');
    queue.create({ projectId: list.id, type: 'download', input: { url: 'https://www.youtube.com/watch?v=expired0001' } });

    await runTicks(6);

    const notice = cookieNotices()[0]!;
    expect(notice.title).toBe('Cookies đã hết hạn hoặc không còn hợp lệ');
    expect(notice.title).not.toMatch(/xoay/i);
  });
});
