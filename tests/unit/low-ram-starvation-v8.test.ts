import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type * as OsModule from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/contracts/channels.js';
import type { AttentionNotice, QueueJob, ResourceProfile } from '@shared/types/domain.js';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
let mockedFreeMemBytes = 4 * GIB;
let mockedTotalMemBytes = 8 * GIB;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof OsModule>();
  return {
    ...actual,
    freemem: vi.fn(() => mockedFreeMemBytes),
    totalmem: vi.fn(() => mockedTotalMemBytes)
  };
});

const { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } = await import(
  '@main/settings/defaults.js'
);
const { AppDatabase } = await import('@main/database/database.js');
const { ProjectRepository } = await import('@main/database/repositories/project-repository.js');
const { ItemRepository } = await import('@main/database/repositories/item-repository.js');
const { QueueRepository } = await import('@main/database/repositories/queue-repository.js');
const { MediaSourceRepository } = await import('@main/database/repositories/media-source-repository.js');
const { QueueManager } = await import('@main/queue/queue-manager.js');

const lowMachineProfile: ResourceProfile = {
  ...builtInResourceProfiles.find((profile) => profile.id === 'resource-low')!,
  diskFreeMinimumBytes: 0,
  builtIn: false
};

const tempDirs: string[] = [];
const openDbs: Array<{ close: () => void }> = [];

afterEach(() => {
  mockedFreeMemBytes = 4 * GIB;
  mockedTotalMemBytes = 8 * GIB;
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function createHarness() {
  const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-v8-ram-'));
  tempDirs.push(sandbox);
  const database = new AppDatabase(join(sandbox, 'db.sqlite'));
  openDbs.push(database);
  const queue = new QueueRepository(database.db);
  const projects = new ProjectRepository(database.db);
  const items = new ItemRepository(database.db);
  const sources = new MediaSourceRepository(database.db);

  const sourceFolder = join(sandbox, 'src');
  const tempFolder = join(sandbox, 'tmp');
  const outputFolder = join(sandbox, 'out');
  mkdirSync(sourceFolder, { recursive: true });
  mkdirSync(tempFolder, { recursive: true });
  mkdirSync(outputFolder, { recursive: true });

  const project = projects.create({
    name: 'Danh sách máy 4GB RAM',
    sourceFolder,
    tempFolder,
    outputFolder,
    finalFileName: 'out',
    qualityProfileId: 'quality-720p-fast',
    resourceProfileId: 'resource-low'
  });

  const notices: AttentionNotice[] = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn((channel: string, payload: unknown) => {
        if (channel === IPC.events.attention) notices.push(payload as AttentionNotice);
      })
    }
  };

  const manager = new QueueManager(
    queue,
    projects,
    items,
    sources,
    {
      get: () => defaultAppSettings,
      profiles: () => ({ resources: builtInResourceProfiles, qualities: builtInQualityProfiles })
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
  );
  manager.setWindow(fakeWindow as never);

  const job1 = queue.create({ projectId: project.id, type: 'download', input: {} });
  const job2 = queue.create({ projectId: project.id, type: 'download', input: {} });

  const access = manager as unknown as {
    active: Map<string, unknown>;
    resourcesAllow: (job: QueueJob, profile: ResourceProfile, cpuPercent: number) => Promise<boolean>;
  };

  return { access, job1, job2, notices };
}

describe('V8 — Chống kẹt im lặng Hàng đợi trên máy 4–8 GB RAM đang mở kèm CapCut', () => {
  it('1) freemem = 500 MiB (< 768 MiB dự trữ): việc đầu tiên (active.size = 0) VẪN được chạy, nhưng việc thứ 2 bị giữ chờ', async () => {
    mockedTotalMemBytes = 4 * GIB;
    mockedFreeMemBytes = 500 * MIB;
    const { access, job1, job2, notices } = createHarness();

    expect(access.active.size).toBe(0);
    expect(await access.resourcesAllow(job1, lowMachineProfile, 10)).toBe(true);
    expect(notices).toHaveLength(0);

    access.active.set(job1.id, { job: job1, controller: new AbortController() });
    expect(await access.resourcesAllow(job2, lowMachineProfile, 10)).toBe(false);
    expect(notices).toHaveLength(0);
  });

  it('2) freemem = 150 MiB (< sàn khẩn cấp 256 MiB) khi active.size = 0: việc đầu tiên tạm chờ KÈM thông báo tiếng Việt rõ ràng (không spam lặp lại)', async () => {
    mockedTotalMemBytes = 4 * GIB;
    mockedFreeMemBytes = 150 * MIB;
    const { access, job1, notices } = createHarness();

    expect(await access.resourcesAllow(job1, lowMachineProfile, 10)).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.severity).toBe('warning');
    expect(`${notices[0]!.title} ${notices[0]!.message}`).toContain(
      'RAM trống quá thấp, Tubmedia đang tạm chờ để tránh đơ máy'
    );

    // Gọi lại liên tiếp trên các nhịp tick kế tiếp không bắn thông báo trùng dồn dập
    expect(await access.resourcesAllow(job1, lowMachineProfile, 10)).toBe(false);
    expect(notices).toHaveLength(1);
  });
});
