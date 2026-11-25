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
import type { DownloadPacingContext } from '@shared/utils/download-pacing.js';

type Internals = {
  tick: () => Promise<void>;
  schedulerRunning: boolean;
  tickRunning: boolean;
  autoGlobalDownloadCap: () => number;
  cpuPercent: () => number;
  lastCpuPercent: number;
  encodeWaiters: string[];
  encodingJobs: Set<string>;
  active: Map<string, { job: QueueJob; controller: AbortController; promise: Promise<void>; sourceLock: string | null; startedAtMs: number }>;
  laneHolders: (lane: 'download-list' | 'merge-workflow') => Set<string>;
  pauseProjectForBlockingError: (job: QueueJob, code: string, message: string) => Promise<void>;
  autoListsCache: { at: number; value: number } | null;
  globalDownloadCapCache: { at: number; value: number } | null;
  loadGovernors: Map<string, unknown>;
  diskRecoveryChecks: Map<string, number>;
  downloadPacingContext: (job: QueueJob) => DownloadPacingContext;
};

const resource: ResourceProfile = {
  id: 'resource-v101112',
  name: 'Test V10-V12',
  description: '',
  downloadWorkers: 4,
  analyzeWorkers: 2,
  normalizeWorkers: 2,
  remuxWorkers: 2,
  clipWorkers: 2,
  ffmpegThreads: 4,
  filterThreads: 2,
  filterComplexThreads: 2,
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
let downloaderRun: ReturnType<typeof vi.fn>;

const internals = (): Internals => manager as unknown as Internals;

const makeProject = (name: string, rootDir = folder): Project => {
  const project = projects.create({
    name,
    sourceFolder: join(rootDir, name, 'src'),
    tempFolder: join(rootDir, name, 'tmp'),
    outputFolder: join(rootDir, name, 'out'),
    finalFileName: name,
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: resource.id
  });
  mkdirSync(project.sourceFolder, { recursive: true });
  mkdirSync(project.tempFolder, { recursive: true });
  mkdirSync(project.outputFolder, { recursive: true });
  return project;
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-v10-12-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 1, downloadAdaptiveBoost: false };
  downloaderRun = vi.fn(() => new Promise(() => undefined));
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    {
      get: () => settings,
      profiles: () => ({ qualities: builtInQualityProfiles, resources: [resource] })
    } as never,
    { run: downloaderRun } as never,
    {} as never,
    {} as never,
    { pauseByJob: vi.fn(() => Promise.resolve(1)), resumeByJob: vi.fn(() => Promise.resolve()) } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
  );
  internals().schedulerRunning = true;
  internals().autoGlobalDownloadCap = () => 12;
  internals().cpuPercent = () => 0;
  internals().lastCpuPercent = 0;
});

afterEach(() => {
  internals().schedulerRunning = false;
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('V10b / V11 / V12 — bảo vệ hàng đợi queue-manager', () => {
  it('V10b: laneHolders bỏ qua tác vụ đã tạm dừng, hủy hoặc lỗi để không rò rỉ giữ làn', () => {
    const pPaused = makeProject('P_Paused');
    const pCancelled = makeProject('P_Cancelled');
    const pFailed = makeProject('P_Failed');
    const pActive = makeProject('P_Active');

    const jPaused = queue.create({ projectId: pPaused.id, type: 'download', input: { workflow: 'download-only' } });
    queue.update(jPaused.id, { status: 'paused' });

    const jCancelled = queue.create({ projectId: pCancelled.id, type: 'download', input: { workflow: 'download-only' } });
    queue.update(jCancelled.id, { status: 'cancelled' });

    const jFailed = queue.create({ projectId: pFailed.id, type: 'download', input: { workflow: 'download-only' } });
    queue.update(jFailed.id, { status: 'failed' });

    const jActive = queue.create({ projectId: pActive.id, type: 'download', input: { workflow: 'download-only' } });
    queue.update(jActive.id, { status: 'downloading' });

    const dummy = (job: QueueJob) => ({
      job,
      controller: new AbortController(),
      promise: Promise.resolve(),
      sourceLock: null,
      startedAtMs: Date.now()
    });
    internals().active.set(jPaused.id, dummy(jPaused));
    internals().active.set(jCancelled.id, dummy(jCancelled));
    internals().active.set(jFailed.id, dummy(jFailed));
    internals().active.set(jActive.id, dummy(jActive));

    const holders = internals().laneHolders('download-list');
    expect(holders.has(pActive.id)).toBe(true);
    expect(holders.has(pPaused.id)).toBe(false);
    expect(holders.has(pCancelled.id)).toBe(false);
    expect(holders.has(pFailed.id)).toBe(false);
  });

  it('V10b: khi encodeWaiters chạm trần an toàn, tick() tạm dừng mở thêm tác vụ tải mới', async () => {
    const project = makeProject('EncodeBacklog');
    const pendingJob = queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: 'https://www.tiktok.com/@u/video/1234567890123' }
    });
    // Nhồi 8 waiter đang chờ encode
    for (let i = 0; i < 8; i += 1) {
      const waiter = queue.create({
        projectId: project.id,
        type: 'download',
        input: { url: `https://www.tiktok.com/@u/video/223456789012${i}` }
      });
      queue.update(waiter.id, { status: 'processing' });
      internals().encodeWaiters.push(waiter.id);
    }

    await internals().tick();

    expect(downloaderRun).not.toHaveBeenCalled();
    expect(queue.get(pendingJob.id)?.status).toBe('pending');
  });

  it('V11: downloadPacingContext chia rateLimit theo số luồng tải thực tế', () => {
    settings.rateLimit = '8M';
    const project = makeProject('RateSplit');
    const j1 = queue.create({ projectId: project.id, type: 'download', input: { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' } });
    const j2 = queue.create({ projectId: project.id, type: 'download', input: { url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' } });
    internals().active.set(j1.id, {
      job: j1,
      controller: new AbortController(),
      promise: Promise.resolve(),
      sourceLock: null,
      startedAtMs: Date.now()
    });

    // j1 đang chạy + j2 sắp bắt đầu = 2 luồng → 8M / 2 = 4096K
    const ctx = internals().downloadPacingContext(j2);
    expect(ctx.rateLimit).toBe('4096K');
  });

  it('V11: DISK_FULL trên một ổ đĩa dừng toàn bộ các dự án khác đang ghi vào cùng ổ đĩa đó', async () => {
    const projectA = makeProject('DiskA');
    const projectB = makeProject('DiskB'); // cùng ổ đĩa với projectA (cùng tmpdir)

    const jobA = queue.create({ projectId: projectA.id, type: 'download', input: {} });
    const jobB = queue.create({ projectId: projectB.id, type: 'download', input: {} });
    projects.setStatus(projectA.id, 'active');
    projects.setStatus(projectB.id, 'active');

    await internals().pauseProjectForBlockingError(jobA, 'DISK_FULL', 'Ổ đĩa đầy.');

    expect(projects.get(projectA.id)?.status).toBe('paused');
    expect(projects.get(projectB.id)?.status).toBe('paused');
    expect(queue.get(jobB.id)?.status).toBe('paused');
    expect(queue.get(jobB.id)?.errorCode).toBe('DISK_FULL');
  });

  it('V12: handleSettingsUpdated xóa cache giới hạn, bộ điều tiết CPU và đánh thức scheduler ngay', () => {
    internals().autoListsCache = { at: Date.now(), value: 1 };
    internals().globalDownloadCapCache = { at: Date.now(), value: 2 };
    internals().loadGovernors.set('resource-v101112', {});
    internals().diskRecoveryChecks.set('proj-1', Date.now());

    manager.handleSettingsUpdated();

    expect(internals().autoListsCache).toBeNull();
    expect(internals().globalDownloadCapCache).toBeNull();
    expect(internals().loadGovernors.size).toBe(0);
    expect(internals().diskRecoveryChecks.size).toBe(0);
  });
});
