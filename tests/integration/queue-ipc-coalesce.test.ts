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
import { IPC } from '@shared/contracts/channels.js';
import { builtInQualityProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { AppSettings, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// Lag bước 3 (2026-10-12). Đo thật: mỗi lần hàng đợi đổi trạng thái, emit() gửi CẢ danh sách tác vụ qua IPC (250 tác vụ
// ≈450 KB, 1500 tác vụ ≈2,1 MB) — 24 video bắt đầu / xong = 24 lần gửi sát nhau, vòng lặp main khựng tới 837 ms; giao diện
// vẽ lại toàn bộ mỗi lần. Và mỗi lượt tick (350 ms) đọc + phân tích CẢ bảng queue_jobs, kể cả hàng nghìn tác vụ đã xong.
// Giờ: gửi danh sách tối đa 1 lần mỗi 300 ms (lần đầu gửi ngay, các lần sau gộp vào 1 lần gửi cuối với dữ liệu mới nhất);
// tick chỉ đọc tác vụ chưa xong, trạng thái phụ thuộc đã xong tra riêng theo id.

type Internals = {
  tick: () => Promise<void>;
  emit: () => void;
  schedulerRunning: boolean;
  tickRunning: boolean;
};

const resource: ResourceProfile = {
  id: 'resource-ipc',
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
let sends: Array<{ at: number; jobs: QueueJob[] }>;

const internals = (): Internals => manager as unknown as Internals;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// Giống bộ lập lịch thật: không bao giờ có hai lượt tick chạy song song (cờ tickRunning). Không có bước này, lượt tick tự
// động (tác vụ xong → emit → tick ngay) có thể chạy chen với lượt tick của bài kiểm khi máy bận, gây kết quả sai ngẫu nhiên.
const tick = async (): Promise<void> => {
  while (internals().tickRunning) await new Promise((resolve) => setTimeout(resolve, 5));
  internals().tickRunning = true;
  try {
    await internals().tick();
  } finally {
    internals().tickRunning = false;
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
const download = (project: Project, extra: Record<string, unknown> = {}): QueueJob => {
  counter += 1;
  return queue.create({
    projectId: project.id,
    type: 'download',
    input: { url: `https://www.tiktok.com/@kenh/video/${7200000000000 + counter}`, ...extra }
  });
};
const attachWindow = (): void => {
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        if (channel === IPC.events.queueChanged) sends.push({ at: Date.now(), jobs: payload as QueueJob[] });
      }
    }
  };
  manager.setWindow(window as never);
  // Chỉ kiểm việc gửi qua IPC — tắt bộ lập lịch để emit() không kéo theo các lượt tick chạy tác vụ.
  internals().schedulerRunning = false;
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-ipc-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  held = new Map();
  started = [];
  sends = [];
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 6 };
  const downloader = {
    run: vi.fn((job: QueueJob) => {
      started.push(job);
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
  await sleep(30);
  await manager.stop(false);
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('Lag bước 3 — gộp các lần gửi danh sách tác vụ qua IPC', () => {
  it('20 thay đổi liên tiếp → gửi ngay 1 lần, rồi 1 lần cuối sau ~300 ms mang dữ liệu MỚI NHẤT (không phải 20 lần)', async () => {
    attachWindow();
    const project = makeProject('A');
    for (let index = 0; index < 20; index += 1) {
      download(project);
      internals().emit();
    }
    expect(sends, 'thay đổi đầu tiên sau lúc yên được gửi ngay').toHaveLength(1);
    await sleep(150);
    expect(sends, 'trong 300 ms không gửi thêm').toHaveLength(1);
    await sleep(250);
    expect(sends, 'gộp các thay đổi còn lại vào đúng 1 lần gửi cuối').toHaveLength(2);
    expect(sends[1]!.jobs, 'lần gửi cuối có đủ 20 tác vụ (dữ liệu mới nhất)').toHaveLength(20);
    expect(sends[1]!.at - sends[0]!.at).toBeGreaterThanOrEqual(280);
    await sleep(350);
    expect(sends, 'không có thay đổi mới thì không gửi lại').toHaveLength(2);
  });

  it('thay đổi lẻ sau lúc yên vẫn tới giao diện ngay (không chậm 300 ms)', async () => {
    attachWindow();
    const project = makeProject('A');
    download(project);
    internals().emit();
    await sleep(400);
    sends.length = 0;
    download(project);
    internals().emit();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.jobs).toHaveLength(2);
  });

  it('dừng hàng đợi thì hủy lần gửi đang chờ (không gửi vào cửa sổ / CSDL đã đóng)', async () => {
    attachWindow();
    const project = makeProject('A');
    download(project);
    internals().emit();
    download(project);
    internals().emit();
    expect(sends).toHaveLength(1);
    await manager.stop(false);
    await sleep(400);
    expect(sends).toHaveLength(1);
  });
});

describe('Lag bước 3 — tick chỉ đọc tác vụ chưa xong', () => {
  it('2000 tác vụ đã xong + vài tác vụ chờ: tick không đọc cả bảng, phụ thuộc vẫn xét đúng (xong / lỗi / không tồn tại)', async () => {
    const project = makeProject('A');
    const insert = database.db.prepare(
      `INSERT INTO queue_jobs(id,project_id,type,status,priority,input_json,progress,attempts,max_attempts,created_at,updated_at,finished_at)
       VALUES(?,?,?,?,0,?,100,0,3,?,?,?)`
    );
    const at = new Date().toISOString();
    for (let index = 0; index < 2000; index += 1) {
      insert.run(`done-${index}`, project.id, 'download', index % 50 === 0 ? 'failed' : 'completed', '{}', at, at, at);
    }
    const afterDone = download(project, { dependsOn: ['done-1'] });
    const afterFailed = download(project, { dependsOn: ['done-0'] });
    const afterMissing = download(project, { dependsOn: ['khong-ton-tai'] });
    const blocker = queue.update(download(project).id, { status: 'paused' });
    const afterPending = download(project, { dependsOn: [blocker.id] });

    const listSpy = vi.spyOn(queue, 'list');
    await tick();
    await sleep(30);
    expect(
      listSpy.mock.calls.filter((call) => call.length === 0 || call[0] === undefined),
      'tick không đọc cả bảng queue_jobs'
    ).toHaveLength(0);

    expect(started.map((job) => job.id), 'phụ thuộc đã hoàn tất → được chạy').toEqual([afterDone.id]);
    expect(queue.get(afterFailed.id)).toMatchObject({ status: 'failed', errorCode: 'DEPENDENCY_FAILED' });
    expect(queue.get(afterMissing.id)).toMatchObject({ status: 'failed', errorCode: 'DEPENDENCY_FAILED' });
    expect(queue.get(afterPending.id)?.status, 'phụ thuộc còn đang chạy → chờ').toBe('pending');

    // Phụ thuộc vừa chuyển sang đã xong → không còn trong danh sách chưa xong, phải tra theo id.
    database.db.prepare("UPDATE queue_jobs SET status='completed' WHERE id=?").run(blocker.id);
    await tick();
    await sleep(30);
    expect(started.map((job) => job.id), 'phụ thuộc vừa xong → tác vụ sau được chạy').toEqual([afterDone.id, afterPending.id]);
  });
});
