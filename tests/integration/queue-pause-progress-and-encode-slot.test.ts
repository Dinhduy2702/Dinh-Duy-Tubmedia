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
import type { QueueJob, ResourceProfile } from '@shared/types/domain.js';

type EncodeSlotProvider = (
  job: QueueJob,
  threads: number,
  signal: AbortSignal,
  onWaiting: () => void
) => Promise<() => void>;

type Internals = {
  updateProgress: (
    jobId: string,
    progress: number,
    speed?: string | null,
    etaSeconds?: number | null,
    status?: QueueJob['status'],
    force?: boolean
  ) => void;
  editEncodeLimitOverride: number | null;
  lastCpuPercent: number;
  encodesRunning: number;
  encodeHolders: Set<string>;
};

const resource: ResourceProfile = {
  id: 'resource-test-15',
  name: 'Test 15',
  description: '',
  downloadWorkers: 2,
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
let provider: EncodeSlotProvider | null = null;

const internals = (): Internals => manager as unknown as Internals;
const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-issue15-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  provider = null;
  const downloader = {
    setEncodeSlotProvider: (next: EncodeSlotProvider) => {
      provider = next;
    },
    run: vi.fn()
  };
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    {
      get: () => defaultAppSettings,
      profiles: () => ({ qualities: builtInQualityProfiles, resources: [resource] })
    } as never,
    downloader as never,
    {} as never,
    {} as never,
    {
      pauseByJob: vi.fn(() => Promise.resolve(1)),
      resumeByJob: vi.fn(() => Promise.resolve())
    } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
  );
  internals().editEncodeLimitOverride = 1;
  internals().lastCpuPercent = 0;
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

const makeJob = (name: string): QueueJob => {
  const project = projects.create({
    name,
    sourceFolder: join(folder, name, 'src'),
    tempFolder: join(folder, name, 'tmp'),
    outputFolder: join(folder, name, 'out'),
    finalFileName: name,
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: resource.id
  });
  mkdirSync(project.sourceFolder, { recursive: true });
  const job = queue.create({
    projectId: project.id,
    type: 'download',
    input: { url: `https://www.tiktok.com/@u/video/${Date.now()}` }
  });
  queue.update(job.id, { status: 'downloading' });
  return queue.get(job.id)!;
};

describe('#15 — updateProgress không ghi đè paused; nhả ghế encodesRunning và bỏ qua waiter đang paused', () => {
  it('updateProgress đến trễ sau khi tác vụ đã paused không kéo trạng thái về downloading', async () => {
    const job = makeJob('PauseProgress');
    await manager.pause(job.id);
    expect(queue.get(job.id)?.status).toBe('paused');

    internals().updateProgress(job.id, 65, '3.5 MiB/s', 12, 'downloading', true);

    expect(queue.get(job.id)?.status).toBe('paused');
  });

  it('tạm dừng tác vụ đang giữ ghế encode sẽ nhả encodesRunning để tác vụ khác vào mã hóa ngay', async () => {
    const jobA = makeJob('EncodeA');
    const jobB = makeJob('EncodeB');
    const ctrlA = new AbortController();
    const ctrlB = new AbortController();

    const releaseA = await provider!(jobA, 4, ctrlA.signal, () => undefined);
    expect(internals().encodesRunning).toBe(1);

    let bAcquired = false;
    const promiseB = provider!(jobB, 4, ctrlB.signal, () => undefined).then((rel) => {
      bAcquired = true;
      return rel;
    });

    await settle(100);
    expect(bAcquired).toBe(false);

    // Tạm dừng jobA → phải nhả ghế encodesRunning để jobB nhận ghế
    await manager.pause(jobA.id);
    expect(internals().encodesRunning).toBe(0);

    await settle(700);
    expect(bAcquired).toBe(true);
    const releaseB = await promiseB;
    expect(internals().encodesRunning).toBe(1);

    releaseB();
    releaseA();
    expect(internals().encodesRunning).toBe(0);
  });

  it('bỏ qua waiter đang ở trạng thái paused để không làm kẹt waiter xếp sau', async () => {
    const holder = makeJob('Holder');
    const waiterPaused = makeJob('WaiterPaused');
    const waiterActive = makeJob('WaiterActive');
    const ctrlH = new AbortController();
    const ctrlP = new AbortController();
    const ctrlA = new AbortController();

    const releaseH = await provider!(holder, 4, ctrlH.signal, () => undefined);

    let pausedAcquired = false;
    let activeAcquired = false;
    const promiseP = provider!(waiterPaused, 4, ctrlP.signal, () => undefined).then((rel) => {
      pausedAcquired = true;
      return rel;
    });
    const promiseA = provider!(waiterActive, 4, ctrlA.signal, () => undefined).then((rel) => {
      activeAcquired = true;
      return rel;
    });

    await settle(100);
    await manager.pause(waiterPaused.id);

    // Holder nhả ghế → waiterActive phải được vào dù waiterPaused đứng trước trong encodeWaiters!
    releaseH();
    await settle(700);

    expect(activeAcquired).toBe(true);
    expect(pausedAcquired).toBe(false);

    const releaseA = await promiseA;
    releaseA();
    ctrlP.abort();
    await expect(promiseP).rejects.toThrow();
  });
});
