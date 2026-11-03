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

// 1.7.5 (người dùng báo 2026-11-03, đo thật): video tải xong rồi tạo bản CapCut vẫn GIỮ chỗ tải của danh sách → khi mọi chỗ
// đang mã hoá thì 0 lượt tải ("cứ xoay"); 1.7.4 bỏ giới hạn → 6 bản mã hoá cùng lúc, CPU 93%. Giờ: xin lượt mã hoá thì trả
// chỗ tải ngay (video khác tải tiếp), và số bản mã hoá cùng lúc có trần theo CPU của máy.

type EncodeSlotProvider = (
  job: QueueJob,
  threads: number,
  signal: AbortSignal,
  onWaiting: () => void
) => Promise<() => void>;
type Internals = {
  tick: () => Promise<void>;
  schedulerRunning: boolean;
  tickRunning: boolean;
  autoGlobalDownloadCap: () => number;
  editEncodeLimitOverride: number | null;
  lastCpuPercent: number;
  cpuPercent: () => number;
};

const resource: ResourceProfile = {
  id: 'resource-encode-lane',
  name: 'Hồ sơ kiểm thử',
  description: '',
  downloadWorkers: 2,
  analyzeWorkers: 2,
  normalizeWorkers: 2,
  remuxWorkers: 2,
  clipWorkers: 2,
  ffmpegThreads: 8,
  filterThreads: 4,
  filterComplexThreads: 4,
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
let provider: EncodeSlotProvider | null;
let downloading: Set<string>;
let encoding: Set<string>;
let finishEncode: Map<string, () => void>;

const internals = (): Internals => manager as unknown as Internals;
const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const tick = async (): Promise<void> => {
  while (internals().tickRunning) await settle(5);
  internals().tickRunning = true;
  try {
    await internals().tick();
  } finally {
    internals().tickRunning = false;
  }
};
const tickUntilSettled = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) {
    vi.setSystemTime(Date.now() + 400);
    await tick();
    await settle();
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
const addDownloads = (project: Project, count: number): QueueJob[] =>
  Array.from({ length: count }, () => {
    counter += 1;
    return queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: `https://www.tiktok.com/@kenh/video/${7300000000000 + counter}` }
    });
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-encode-lane-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 1, downloadAdaptiveBoost: false };
  provider = null;
  downloading = new Set();
  encoding = new Set();
  finishEncode = new Map();
  // Tải giả: "tải" xong ngay rồi xin lượt mã hoá (như bước tạo bản CapCut), giữ tới khi bài kiểm cho xong.
  const downloader = {
    setEncodeSlotProvider: (next: EncodeSlotProvider) => {
      provider = next;
    },
    run: vi.fn(async (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => {
      downloading.add(job.id);
      await settle(5);
      downloading.delete(job.id);
      const release = provider
        ? await provider(job, profile.ffmpegThreads, signal, () => undefined)
        : () => undefined;
      encoding.add(job.id);
      await new Promise<void>((resolve) => finishEncode.set(job.id, resolve));
      encoding.delete(job.id);
      release();
      return { outputPath: join(folder, `${job.id}.mp4`), skipped: false, resultMessage: 'Đã tải.' };
    })
  };
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    {
      get: () => settings,
      profiles: () => ({ qualities: builtInQualityProfiles, resources: [resource] })
    } as never,
    downloader as never,
    {} as never,
    {} as never,
    { pauseByJob: vi.fn(() => Promise.resolve()) } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
  );
  internals().schedulerRunning = true;
  internals().autoGlobalDownloadCap = () => 99;
  internals().lastCpuPercent = 0;
  // CPU thật của máy chạy bài kiểm không được quyết định kết quả — bài nào cần "máy bận" tự đặt.
  internals().cpuPercent = () => 0;
});

afterEach(async () => {
  for (const finish of finishEncode.values()) finish();
  await settle(1_200);
  internals().schedulerRunning = false;
  database.close();
  rmSync(folder, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('làn mã hoá CapCut tách khỏi chỗ tải', () => {
  it('danh sách 2 luồng: 2 video đang mã hoá không chặn 2 video tiếp theo bắt đầu tải', async () => {
    internals().editEncodeLimitOverride = 4;
    const list = makeProject('TA784');
    addDownloads(list, 6);

    await tickUntilSettled();

    expect(provider, 'hàng đợi phải cấp lượt mã hoá cho bộ tải').not.toBeNull();
    expect(encoding.size + downloading.size).toBeGreaterThan(2);
    expect(encoding.size).toBe(4);
  });

  it('trần số bản mã hoá cùng lúc: vượt trần thì video chờ lượt mã hoá, nhưng vẫn không giữ chỗ tải', async () => {
    internals().editEncodeLimitOverride = 1;
    const list = makeProject('Y420');
    addDownloads(list, 4);

    await tickUntilSettled();
    await settle(1_200);
    await tickUntilSettled();

    expect(encoding.size, 'mỗi lúc chỉ 1 bản mã hoá').toBe(1);
    const runs = (manager as unknown as { downloader: { run: ReturnType<typeof vi.fn> } }).downloader.run.mock
      .calls.length;
    expect(runs, 'các video khác vẫn được bắt đầu tải dù đang chờ lượt mã hoá').toBe(4);

    const first = [...encoding][0]!;
    finishEncode.get(first)!();
    await settle(1_500);
    expect(encoding.size, 'xong một bản thì bản tiếp theo được mã hoá').toBe(1);
    expect(encoding.has(first)).toBe(false);
  });

  it('CPU máy đang bận (người dùng đang làm việc) → không mở thêm bản mã hoá thứ hai', async () => {
    internals().editEncodeLimitOverride = 4;
    internals().cpuPercent = () => 85;
    const list = makeProject('TH179');
    addDownloads(list, 3);

    await tickUntilSettled();
    await settle(1_200);

    expect(encoding.size).toBe(1);
  });
});
