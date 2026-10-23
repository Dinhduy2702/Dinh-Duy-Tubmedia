import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type * as FsPromises from 'node:fs/promises';
import type { QueueJob, ResourceProfile } from '@shared/types/domain.js';

// 2026-10-23: tệp tạm của yt-dlp giờ nằm trong thư mục tạm của danh sách (<tạm>\_dl\<mã>) → bước kiểm ổ trống trước khi tải
// phải kiểm cả ổ chứa thư mục tạm, không chỉ ổ chứa thư mục video (phòng khi hai thư mục nằm trên hai ổ khác nhau).
// statfs được giả lập: mọi đường dẫn dưới "ổ tạm" chỉ còn 1 GB, nơi khác còn 500 GB.

const GB = 1024 ** 3;
let lowDiskRoot = '';
const statfsCalls: string[] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    statfs: vi.fn(async (path: string) => {
      statfsCalls.push(resolve(path));
      await actual.stat(path); // thư mục không tồn tại → lỗi như statfs thật
      const low = lowDiskRoot !== '' && resolve(path).toLowerCase().startsWith(resolve(lowDiskRoot).toLowerCase());
      return { bavail: BigInt(low ? 1 * GB : 500 * GB) / 4096n, bsize: 4096n, blocks: 0n, bfree: 0n, files: 0n, ffree: 0n, type: 0n };
    })
  };
});

const { AppDatabase } = await import('@main/database/database.js');
const { ProjectRepository } = await import('@main/database/repositories/project-repository.js');
const { ItemRepository } = await import('@main/database/repositories/item-repository.js');
const { QueueRepository } = await import('@main/database/repositories/queue-repository.js');
const { MediaSourceRepository } = await import('@main/database/repositories/media-source-repository.js');
const { QueueManager } = await import('@main/queue/queue-manager.js');

type ManagerAccess = {
  resourcesAllow: (job: QueueJob, profile: ResourceProfile, cpuPercent: number) => Promise<boolean>;
};

let folder = '';
const openDatabases: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
  lowDiskRoot = '';
  statfsCalls.length = 0;
});

const profile: ResourceProfile = {
  id: 'resource-test',
  name: 'Hồ sơ kiểm thử',
  description: '',
  downloadWorkers: 4,
  analyzeWorkers: 4,
  normalizeWorkers: 4,
  remuxWorkers: 4,
  clipWorkers: 4,
  ffmpegThreads: 4,
  filterThreads: 2,
  filterComplexThreads: 2,
  processPriority: 'below_normal',
  cpuSoftLimitPercent: 100,
  memoryFreeMinimumBytes: 0,
  diskFreeMinimumBytes: 10 * GB,
  gpuJobs: 0,
  builtIn: false
};

function setup(options: { createTemp: boolean }) {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-disk-temp-'));
  const database = new AppDatabase(join(folder, 'db.sqlite'));
  openDatabases.push(database);
  const queue = new QueueRepository(database.db);
  const projects = new ProjectRepository(database.db);
  const sourceFolder = join(folder, 'o-video', 'video');
  const tempDrive = join(folder, 'o-tam');
  const tempFolder = join(tempDrive, 'Tubmedia');
  mkdirSync(sourceFolder, { recursive: true });
  mkdirSync(options.createTemp ? tempFolder : tempDrive, { recursive: true });
  const project = projects.create({
    name: 'ds',
    sourceFolder,
    tempFolder,
    outputFolder: join(folder, 'thanh-pham'),
    finalFileName: 'ds',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never
  );
  const job = queue.create({ projectId: project.id, type: 'download', input: {} });
  return { access: manager as unknown as ManagerAccess, queue, job, tempDrive, tempFolder, sourceFolder };
}

describe('Kiểm ổ trống trước khi tải: cả ổ chứa thư mục tạm', () => {
  it('ổ thư mục video còn trống nhưng ổ thư mục tạm gần đầy → tạm dừng, câu báo nêu thư mục tạm', async () => {
    const { access, queue, job, tempDrive, tempFolder } = setup({ createTemp: true });
    lowDiskRoot = tempDrive;
    expect(await access.resourcesAllow(job, profile, 0)).toBe(false);
    const paused = queue.get(job.id)!;
    expect(paused.status).toBe('paused');
    expect(paused.errorCode).toBe('DISK_FULL');
    expect(paused.errorMessage).toContain(tempFolder);
  });

  it('thư mục tạm chưa được tạo: đo qua thư mục cha trên cùng ổ, không tạm dừng nhầm khi còn trống', async () => {
    const { access, queue, job, tempDrive } = setup({ createTemp: false });
    expect(await access.resourcesAllow(job, profile, 0)).toBe(true);
    expect(queue.get(job.id)!.status).not.toBe('paused');
    expect(statfsCalls).toContain(resolve(tempDrive));
  });

  it('thư mục tạm chưa được tạo mà ổ đó gần đầy → vẫn bắt được', async () => {
    const { access, queue, job, tempDrive, tempFolder } = setup({ createTemp: false });
    lowDiskRoot = tempDrive;
    expect(await access.resourcesAllow(job, profile, 0)).toBe(false);
    expect(queue.get(job.id)!.errorMessage).toContain(tempFolder);
  });

  it('cả hai ổ còn trống → cho tải', async () => {
    const { access, job, sourceFolder } = setup({ createTemp: true });
    expect(await access.resourcesAllow(job, profile, 0)).toBe(true);
    expect(statfsCalls).toContain(resolve(sourceFolder));
  });
});
