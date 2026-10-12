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
import { SourceRateLimitedError } from '@shared/errors/app-errors.js';
import { builtInQualityProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { AttentionNotice, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// Hướng B của kế hoạch 429 (đã duyệt 2026-10-10). Trước đây: một video dính HTTP 429 thì tạm dừng ĐÚNG danh sách đó và chờ
// người dùng bấm Tiếp tục vô thời hạn, còn các danh sách khác cùng nền tảng vẫn bắt đầu video mới và lần lượt bị chặn.
// Giờ: cả ứng dụng nghỉ với nền tảng đó (mọi danh sách, cả làn ghép; nền tảng khác vẫn chạy), tự tiếp tục sau 2 → 5 → 15
// phút với 1 video một lúc rồi tăng dần; lần thứ 4 liên tiếp thì dừng hẳn như cũ. Chạy tick()/execute() THẬT của
// QueueManager trên CSDL thật; chỉ giả lập bộ tải. Thời gian chờ được rút ngắn bằng đúng ngõ e2e dùng.

type Behavior = 'rate-limited' | 'ok' | 'hold';
type Internals = { tick: () => Promise<void>; schedulerRunning: boolean; active: Map<string, unknown>; jobStartTimes: number[] };

const resource: ResourceProfile = {
  id: 'resource-429',
  name: 'Hồ sơ kiểm thử 429',
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
let notices: AttentionNotice[];
let behaviors: Map<string, Behavior>;
let held: Map<string, { resolve: () => void; reject: (error: unknown) => void }>;
let started: string[];
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

const internals = (): Internals => manager as unknown as Internals;
// Nhịp "bắt đầu dần" (Lag bước 2, tối đa 2 tác vụ mỗi 350 ms) có bài kiểm riêng ở queue-list-concurrency — ở đây mỗi lượt tick
// coi như một cửa sổ mới để chỉ kiểm hành vi 429.
const tick = (): Promise<void> => {
  internals().jobStartTimes = [];
  return internals().tick();
};
const idle = async (): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (internals().active.size > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  // .finally() của runJob chạy sau khi tác vụ xong — chờ thêm một nhịp.
  await new Promise((resolve) => setTimeout(resolve, 20));
};
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
const youtube = (project: Project, behavior: Behavior, extra: Record<string, unknown> = {}): QueueJob => {
  counter += 1;
  const url = `https://www.youtube.com/watch?v=VIDEO${String(counter).padStart(6, '0')}`;
  behaviors.set(url, behavior);
  return queue.create({ projectId: project.id, type: 'download', input: { url, ...extra } });
};
const tiktok = (project: Project, behavior: Behavior): QueueJob => {
  counter += 1;
  const url = `https://www.tiktok.com/@kenh/video/${7000000000000 + counter}`;
  behaviors.set(url, behavior);
  return queue.create({ projectId: project.id, type: 'download', input: { url } });
};
const urlOf = (job: QueueJob): string => String(job.input.url);
const rateNotices = (): AttentionNotice[] => notices.filter((notice) => notice?.code === 'SOURCE_RATE_LIMITED');

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-429-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  notices = [];
  behaviors = new Map();
  held = new Map();
  started = [];
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const settings = {
    // Cố định số danh sách chạy cùng lúc (không phụ thuộc phần cứng máy chạy test) — bài này kiểm cổng 429, không kiểm trần danh sách.
    get: () => ({ ...defaultAppSettings, maxConcurrentDownloadLists: 6 }),
    profiles: () => ({ qualities: builtInQualityProfiles, resources: [resource] })
  };
  const downloader = {
    run: vi.fn((job: QueueJob, _profile: unknown, _signal: unknown, onProgress: (progress: Record<string, unknown>) => void) => {
      const url = urlOf(job);
      started.push(url);
      onProgress({ percent: 10, speed: null, etaSeconds: null, stage: 'downloading' });
      const result = { outputPath: join(folder, 'video.mp4'), skipped: false, resultMessage: 'Đã tải và kiểm tra hoàn tất.' };
      const behavior = behaviors.get(url) ?? 'ok';
      if (behavior === 'rate-limited') return Promise.reject(new SourceRateLimitedError({ httpStatus: 429 }));
      if (behavior === 'ok') return Promise.resolve(result);
      return new Promise((resolve, reject) => held.set(url, { resolve: () => resolve(result), reject }));
    })
  };
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    settings as never,
    downloader as never,
    {} as never,
    {} as never,
    { pauseByJob: vi.fn(() => Promise.resolve()) } as never,
    logger as never
  );
  manager.setWindow({
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    show: vi.fn(),
    restore: vi.fn(),
    flashFrame: vi.fn(),
    focus: vi.fn(),
    webContents: { send: (_channel: string, payload: unknown) => notices.push(payload as AttentionNotice) }
  } as never);
  internals().schedulerRunning = true;
});

afterEach(async () => {
  for (const pending of held.values()) pending.resolve();
  await idle();
  internals().schedulerRunning = false;
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('Hướng B — dính 429 thì cả ứng dụng nghỉ với NỀN TẢNG đó rồi tự tiếp tục', () => {
  it('một danh sách dính 429 → video chờ lại (không tạm dừng danh sách), MỌI danh sách cùng nền tảng (cả làn ghép) không bắt đầu video mới, nền tảng khác vẫn chạy; hết giờ tự tiếp tục 1 video rồi tăng dần', async () => {
    manager.setRateLimitWaitOverrideMs(400);
    const listA = makeProject('Danh sach A');
    const listB = makeProject('Danh sach B');
    const merge = makeProject('Quy trinh ghep');
    const hit = youtube(listA, 'rate-limited');

    await tick();
    await idle();

    const afterHit = queue.get(hit.id)!;
    expect(afterHit.status, 'video dính 429 chờ lại, không bị tạm dừng chờ bấm tay').toBe('pending');
    expect(afterHit.errorCode).toBe('SOURCE_RATE_LIMITED');
    expect(afterHit.attempts, 'không đốt lượt thử').toBe(0);
    expect(String(afterHit.input.progressStage)).toContain('Đang chờ do giới hạn YouTube');
    expect(projects.get(listA.id)?.status).not.toBe('paused');
    const waits = manager.rateLimitWaits();
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ platform: 'youtube', label: 'YouTube', stopped: false, strikes: 1 });
    expect(rateNotices()).toHaveLength(1);
    expect(rateNotices()[0]).toMatchObject({ id: 'rate-limit-youtube', severity: 'warning' });
    expect(rateNotices()[0]!.sticky ?? false, 'tự tiếp tục được nên không đứng cố định').toBe(false);
    expect(rateNotices()[0]!.message).toContain('tự tiếp tục');
    expect(rateNotices()[0]!.message).toContain('YouTube');
    expect(logger.warn).toHaveBeenCalledWith('queue', 'RATE_LIMIT_COOLDOWN_STARTED', expect.any(String), expect.anything());

    const otherList = youtube(listB, 'hold');
    const mergeLane = youtube(merge, 'hold', { workflow: 'download-merge' });
    const otherPlatform = tiktok(listB, 'ok');
    started.length = 0;
    await tick();
    await idle();
    expect(started, 'chỉ nền tảng khác được bắt đầu trong lúc nghỉ').toEqual([urlOf(otherPlatform)]);
    expect(queue.get(otherList.id)?.status).toBe('pending');
    expect(queue.get(mergeLane.id)?.status).toBe('pending');

    await sleep(450);
    behaviors.set(urlOf(hit), 'hold');
    started.length = 0;
    await tick();
    await settle();
    expect(started, 'tự tiếp tục với 1 video của nền tảng một lúc').toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith('queue', 'RATE_LIMIT_COOLDOWN_ENDED', expect.any(String), expect.anything());

    held.get(started[0]!)!.resolve();
    await settle();
    await tick();
    await settle();
    expect(started, 'một video tải xong → nới lên 2 video cùng lúc').toHaveLength(3);
  });

  it('video đang tải dở từ trước cũng dính 429 → không tính thêm lần, không thông báo lặp, cũng chờ lại', async () => {
    manager.setRateLimitWaitOverrideMs(60_000);
    const list = makeProject('Danh sach');
    const first = youtube(list, 'hold');
    const second = youtube(list, 'hold');
    await tick();
    await settle();
    expect(started).toHaveLength(2);

    held.get(urlOf(first))!.reject(new SourceRateLimitedError({ httpStatus: 429 }));
    await settle();
    held.get(urlOf(second))!.reject(new SourceRateLimitedError({ httpStatus: 429 }));
    await idle();

    expect(queue.get(first.id)?.status).toBe('pending');
    expect(queue.get(second.id)?.status).toBe('pending');
    expect(manager.rateLimitWaits()[0]).toMatchObject({ strikes: 1 });
    expect(rateNotices()).toHaveLength(1);
  });

  it('sau 3 vòng tự tiếp tục vẫn dính 429 → dừng hẳn như cũ: tạm dừng danh sách, thông báo đứng cố định; bấm Tiếp tục thì tải lại bình thường', async () => {
    manager.setRateLimitWaitOverrideMs(60);
    const list = makeProject('Danh sach');
    const job = youtube(list, 'rate-limited');
    for (let round = 1; round <= 3; round += 1) {
      await tick();
      await idle();
      expect(queue.get(job.id)?.status, `vòng ${round}: vẫn tự chờ`).toBe('pending');
      await sleep(90);
    }
    await tick();
    await idle();

    const stopped = queue.get(job.id)!;
    expect(stopped.status).toBe('paused');
    expect(stopped.errorCode).toBe('SOURCE_RATE_LIMITED');
    expect(stopped.errorMessage).toContain('3 lần');
    expect(projects.get(list.id)?.status).toBe('paused');
    expect(manager.rateLimitWaits()[0]).toMatchObject({ platform: 'youtube', stopped: true });
    const sticky = rateNotices().filter((notice) => notice.sticky);
    expect(sticky.length).toBeGreaterThan(0);
    expect(sticky.at(-1)!.message).toContain('Tiếp tục');

    behaviors.set(urlOf(job), 'ok');
    await manager.resumeProject(list.id);
    expect(manager.rateLimitWaits()).toEqual([]);
    started.length = 0;
    await tick();
    await idle();
    expect(started).toEqual([urlOf(job)]);
    expect(queue.get(job.id)?.status).toBe('completed');
  });
});
