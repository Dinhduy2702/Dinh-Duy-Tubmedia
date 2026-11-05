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

// 2026-11-05 (đo giả lập máy 4 luồng, CPU toàn máy đã kiểm chứng): một bản mã hoá CapCut nền chiếm ~93% CPU → từ phút thứ
// 12 không video nào tải nữa (5 video chờ) tới hết 30 phút. Bài này tái hiện bằng hàng đợi thật + bộ tải giả, CPU ghim 99%.

type EncodeSlotProvider = (job: QueueJob, threads: number, signal: AbortSignal, onWaiting: () => void) => Promise<() => void>;
type Internals = {
  tick: () => Promise<void>;
  schedulerRunning: boolean;
  tickRunning: boolean;
  autoGlobalDownloadCap: () => number;
  autoConcurrentDownloadLists: () => number;
  editEncodeLimitOverride: number | null;
  lastCpuPercent: number;
  cpuPercent: () => number;
  backgroundEncodeCpuPercent: () => number;
};

// Như hồ sơ mặc định "Máy trạm cân bằng": ngưỡng CPU 88%.
const resource: ResourceProfile = {
  id: 'resource-liveness',
  name: 'Hồ sơ kiểm thử',
  description: '',
  downloadWorkers: 2,
  analyzeWorkers: 2,
  normalizeWorkers: 2,
  remuxWorkers: 2,
  clipWorkers: 2,
  ffmpegThreads: 6,
  filterThreads: 3,
  filterComplexThreads: 3,
  processPriority: 'below_normal',
  cpuSoftLimitPercent: 88,
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
let started: string[];
let encoding: Set<string>;
let finishEncode: Map<string, () => void>;
let finishDownload: Map<string, () => void>;
let logInfo: ReturnType<typeof vi.fn>;
/** Mỗi bài kiểm một mã — việc giả của bài trước (còn chạy sau khi dọn) tự kết thúc, không tràn sang bài sau. */
let testToken = 0;

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
/**
 * Chạy hàng đợi trong `seconds` giây giả lập, mỗi lượt +5 s. Bước lớn có chủ ý: kết quả chỉ phụ thuộc thời gian GIẢ LẬP, không
 * phụ thuộc máy chạy bài kiểm nhanh hay chậm (2026-11-05: bước 1 s cần 41 lượt thật → máy bận 100% CPU không kịp 30 s).
 * Bộ điều tiết cần >= 5 s liên tục, bảo đảm sống 30 s — bước 5 s vẫn kiểm đúng cả hai mốc.
 */
const STEP_MS = 5_000;
const runFor = async (seconds: number): Promise<void> => {
  for (let round = 0; round < Math.ceil((seconds * 1_000) / STEP_MS); round += 1) {
    vi.setSystemTime(Date.now() + STEP_MS);
    await tick();
    await settle(20);
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
      input: { url: `https://www.tiktok.com/@kenh/video/${7400000000000 + counter}` }
    });
  });
/** Cho mọi video đang tải xong phần tải (sang bước mã hoá CapCut). */
const releaseDownloads = async (): Promise<void> => {
  for (const [id, finish] of finishDownload) {
    finishDownload.delete(id);
    finish();
  }
  await settle(50);
};
const blockLogs = (): Array<Record<string, unknown>> =>
  logInfo.mock.calls
    .filter((call) => call[1] === 'QUEUE_START_BLOCKED')
    .map((call) => (call[3] as { metadata: Record<string, unknown> }).metadata);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  testToken += 1;
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-liveness-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 1, downloadAdaptiveBoost: false };
  provider = null;
  started = [];
  encoding = new Set();
  finishEncode = new Map();
  finishDownload = new Map();
  logInfo = vi.fn();
  // Tải giả: "tải" xong ngay rồi xin lượt mã hoá CapCut, mã hoá tới khi bài kiểm cho xong (như một bản HDR dài).
  const downloader = {
    setEncodeSlotProvider: (next: EncodeSlotProvider) => {
      provider = next;
    },
    run: vi.fn(async (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => {
      const mine = testToken;
      const result = { outputPath: join(folder, `${job.id}.mp4`), skipped: false, resultMessage: 'Đã tải.' };
      started.push(job.id);
      // Tải giữ tới khi bài kiểm cho xong (video thật tải vài phút).
      await new Promise<void>((resolve) => finishDownload.set(job.id, resolve));
      const release = provider ? await provider(job, profile.ffmpegThreads, signal, () => undefined) : () => undefined;
      if (mine === testToken) {
        encoding.add(job.id);
        await new Promise<void>((resolve) => finishEncode.set(job.id, resolve));
        encoding.delete(job.id);
      }
      release();
      return result;
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
    { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
  );
  internals().schedulerRunning = true;
  // Như máy 4 luồng: 1 danh sách, tổng 2 video tải, 1 bản mã hoá.
  internals().autoGlobalDownloadCap = () => 2;
  internals().autoConcurrentDownloadLists = () => 1;
  internals().editEncodeLimitOverride = 1;
  internals().lastCpuPercent = 0;
  internals().cpuPercent = () => 0;
});

afterEach(async () => {
  // Dừng hàng đợi TRƯỚC rồi mới thả việc giả — không mở thêm video mới (giữ tải) trong lúc dọn.
  internals().schedulerRunning = false;
  for (const finish of finishDownload.values()) finish();
  await settle(50);
  for (const finish of finishEncode.values()) finish();
  await settle(300);
  database.close();
  rmSync(folder, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('hàng đợi không ngừng tải khi mã hoá nền làm CPU đầy (máy yếu)', () => {
  it('ghi nhật ký lý do chặn bắt đầu việc mới: bộ điều tiết CPU, ngưỡng, giá trị đọc được', async () => {
    internals().cpuPercent = () => 99;
    addDownloads(makeProject('TA801'), 4);
    await runFor(10);
    await releaseDownloads();

    await runFor(10);

    const governor = blockLogs().find((entry) => entry.gate === 'cpu-governor');
    expect(governor, 'phải có dòng QUEUE_START_BLOCKED cho bộ điều tiết CPU').toBeDefined();
    expect(governor).toMatchObject({ cpuPercent: 99, highPercent: 88, lowPercent: 63 });
  });

  it('bảo đảm sống: còn video chờ mà không video nào đang tải → tối đa 30 s phải có 1 video bắt đầu, bất kể CPU', async () => {
    internals().cpuPercent = () => 99;
    // Mã hoá nền không đo được (0) — chỉ bảo đảm sống mới cứu được.
    internals().backgroundEncodeCpuPercent = () => 0;
    addDownloads(makeProject('TA802'), 4);

    await runFor(10);
    const before = started.length;
    expect(before, 'trần 2 video tải cùng lúc').toBe(2);
    await releaseDownloads();
    await runFor(25);
    expect(started.length, 'chưa tới 30 s không tải → bảo đảm sống chưa can thiệp').toBe(before);
    await runFor(10);

    expect(started.length, 'tới 30 s không tải phải có thêm video bắt đầu').toBe(before + 1);
  });

  it('bảo đảm sống cả khi danh sách khác đang giữ lượt chỉ để mã hoá (máy yếu: 1 danh sách cùng lúc)', async () => {
    const listA = makeProject('TA803');
    addDownloads(listA, 1);
    await runFor(5);
    await releaseDownloads();
    await runFor(5);
    expect(encoding.size, 'video của danh sách A đang mã hoá').toBe(1);
    const listB = makeProject('TA804');
    const [waiting] = addDownloads(listB, 1);

    await runFor(25);
    expect(started, 'chưa tới 30 s → còn chờ lượt danh sách').not.toContain(waiting!.id);
    await runFor(10);

    expect(started, 'danh sách B phải được tải dù A còn đang mã hoá').toContain(waiting!.id);
  });

  it('không tính CPU của mã hoá nền: CPU 99% nhưng 95% là của bản mã hoá → video khác vẫn tải ngay', async () => {
    internals().cpuPercent = () => 99;
    internals().backgroundEncodeCpuPercent = () => 95;
    addDownloads(makeProject('TA805'), 4);
    await runFor(10);
    await releaseDownloads();

    await runFor(5);

    expect(started.length, 'phần CPU còn lại 4% — không lý do chặn').toBeGreaterThan(2);
  });

  it('vẫn chặn khi phần CPU còn lại cao (việc khác của người dùng), chỉ bảo đảm sống mới mở 1 video', async () => {
    internals().cpuPercent = () => 99;
    internals().backgroundEncodeCpuPercent = () => 5;
    addDownloads(makeProject('TA806'), 4);
    await runFor(10);
    await releaseDownloads();

    await runFor(20);

    expect(started.length, 'CPU còn lại 94% >= 88% → không mở thêm trong 20 s').toBe(2);
    expect(blockLogs().some((entry) => entry.gate === 'cpu-governor')).toBe(true);
  });
});
