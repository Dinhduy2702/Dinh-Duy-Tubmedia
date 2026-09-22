import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueueJob, ResourceProfile } from '@shared/types/domain.js';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';

// Vấn đề 2 mục 1 (2026-09-22): kiểm tra ĐÚNG đường dây thật trong QueueManager (không chỉ lớp
// SystemLoadGovernor thuần) — resourcesAllow() phải dùng bộ điều tiết có độ trễ, không còn so sánh tức
// thời như trước, và isSystemLoadThrottled() phải phản ánh đúng trạng thái để hiện lên giao diện. Các
// bài CÓ CHỜ THẬT (real time, không giả lập đồng hồ) để đo đúng hành vi thời gian thực như yêu cầu.
type ManagerAccess = {
  resourcesAllow: (job: QueueJob, profile: ResourceProfile, cpuPercent: number) => Promise<boolean>;
};

let folder = '';
const openDatabases: AppDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function profile(overrides: Partial<ResourceProfile> = {}): ResourceProfile {
  return {
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
    cpuSoftLimitPercent: 85,
    memoryFreeMinimumBytes: 0, // không chặn vì thiếu RAM trong test
    diskFreeMinimumBytes: 0,
    gpuJobs: 0,
    builtIn: false,
    ...overrides
  };
}

function setup(): {
  manager: QueueManager;
  access: ManagerAccess;
  markOneJobActive: () => void;
  makeJob: (type: QueueJob['type']) => QueueJob;
} {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-load-governor-'));
  const database = new AppDatabase(join(folder, 'db.sqlite'));
  openDatabases.push(database);
  const queue = new QueueRepository(database.db);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manager = new QueueManager(
    queue,
    new ProjectRepository(database.db),
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never
  );
  return {
    manager,
    access: manager as unknown as ManagerAccess,
    // Đặt active.size = 1 để mô phỏng "đã có một tác vụ đang chạy" — governor chỉ áp dụng khi KHÔNG
    // phải tác vụ đầu tiên của cả ứng dụng (tránh "đói" hoàn toàn khi Tubmedia chưa chạy gì).
    markOneJobActive: () => (manager as unknown as { active: Map<string, unknown> }).active.set('other-job', {}),
    // projectId=null để bỏ qua nhánh kiểm tra dung lượng ổ đĩa (statfs thư mục thật) — chỉ kiểm tra CPU.
    makeJob: (type) => queue.create({ projectId: null, type, input: {} })
  };
}

describe('QueueManager + SystemLoadGovernor — giảm tải động theo CPU hệ thống, có độ trễ chống nhấp nháy', () => {
  it('luôn cho phép tác vụ ĐẦU TIÊN của cả ứng dụng bắt đầu dù CPU đang rất cao — tránh "đói" hoàn toàn', async () => {
    const { access, makeJob } = setup();
    const job = makeJob('merge');
    for (let i = 0; i < 20; i += 1) {
      expect(await access.resourcesAllow(job, profile(), 99)).toBe(true);
    }
  });

  it('CPU cao một lần chưa đủ lâu (chưa qua sustainedMs) thì vẫn cho tác vụ THÊM bắt đầu', async () => {
    const { access, makeJob, markOneJobActive } = setup();
    markOneJobActive();
    const job = makeJob('merge');
    expect(await access.resourcesAllow(job, profile(), 99)).toBe(true);
  });

  it('download cũng bị giảm tải theo CPU (không chỉ clip/normalize/merge) vì download cũng dùng ffmpeg hậu xử lý để tạo bản edit', async () => {
    const { access, makeJob, markOneJobActive } = setup();
    markOneJobActive();
    const job = makeJob('download');
    // cpuSoftLimitPercent=1 → CPU đo 50% luôn "cao"; chờ THẬT hơn sustainedMs mặc định (5s) để xác nhận
    // đúng hành vi thời gian thực, không giả lập đồng hồ.
    const throttleProfile = profile({ id: 'resource-download-throttle', cpuSoftLimitPercent: 1 });
    const start = Date.now();
    let becameBlockedAt: number | null = null;
    while (Date.now() - start < 7_000) {
      const allowed = await access.resourcesAllow(job, throttleProfile, 50);
      if (!allowed) {
        becameBlockedAt = Date.now() - start;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(becameBlockedAt, 'tác vụ download phải bị tạm hoãn trong vòng 7s thật khi CPU cao liên tục').not.toBeNull();
  }, 15_000);

  it('isSystemLoadThrottled() phản ánh đúng trạng thái, xác nhận bằng CHỜ THẬT (không giả lập đồng hồ) theo đúng sustainedMs mặc định', async () => {
    const { manager, access, makeJob, markOneJobActive } = setup();
    markOneJobActive();
    const job = makeJob('merge');
    expect(manager.isSystemLoadThrottled()).toBe(false);
    const highCpuProfile = profile({ id: 'resource-throttle-real-time', cpuSoftLimitPercent: 1 });
    const start = Date.now();
    let throttledAt: number | null = null;
    while (Date.now() - start < 7_000) {
      const allowed = await access.resourcesAllow(job, highCpuProfile, 50); // 50 > ngưỡng cao (1) → luôn "cao"
      if (!allowed) {
        throttledAt = Date.now() - start;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(throttledAt, 'phải chuyển sang giảm tải trong vòng 7s thật (sustainedMs mặc định 5s)').not.toBeNull();
    expect(throttledAt!).toBeGreaterThanOrEqual(4_800); // cho phép sai số nhỏ do lịch trình hệ điều hành
    expect(manager.isSystemLoadThrottled()).toBe(true);
  }, 15_000);

  it('mỗi hồ sơ tài nguyên có bộ điều tiết RIÊNG — ngưỡng cao lấy đúng cpuSoftLimitPercent của hồ sơ đó', async () => {
    const { access, makeJob, markOneJobActive } = setup();
    markOneJobActive();
    const job = makeJob('merge');
    const relaxedProfile = profile({ id: 'resource-relaxed', cpuSoftLimitPercent: 99 });
    // CPU 50% không vượt ngưỡng cao 99% của hồ sơ này → không bao giờ bị chặn, kể cả sau nhiều lượt.
    for (let i = 0; i < 10; i += 1) {
      expect(await access.resourcesAllow(job, relaxedProfile, 50)).toBe(true);
    }
  });
});
