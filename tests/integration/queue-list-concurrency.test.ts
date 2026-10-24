import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { AppSettings, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';
import { recommendedConcurrentFragments } from '@shared/utils/hardware-recommendation.js';

// Lag bước 1 (2026-10-12). Trước đây mỗi danh sách tải tự dùng đủ downloadWorkers, độc lập hoàn toàn: 6 danh sách × 4 luồng
// = 24 tiến trình yt-dlp cùng lúc (mỗi lần mở yt-dlp tốn ≈0,77 s CPU). Quy trình ghép thì bị chặn theo TỔNG số video
// (maxGlobalMergeJobs × downloadWorkers) nên 6 quy trình vẫn cùng chạy, mỗi cái vài video. Giờ: tối đa N danh sách tải và
// maxGlobalMergeJobs quy trình ghép chạy "full" cùng lúc — mỗi cái vẫn đủ luồng theo hồ sơ (không chia nhỏ luồng); cái
// sau chờ lượt. Thêm trần riêng YouTube 6 video toàn ứng dụng (lưới an toàn chống 429). tick() THẬT trên CSDL thật.

type Internals = {
  tick: () => Promise<void>;
  schedulerRunning: boolean;
  tickRunning: boolean;
  active: Map<string, unknown>;
  autoConcurrentDownloadLists: () => number;
  autoGlobalDownloadCap: () => number;
  adaptive: { level: number; observe: (sample: unknown) => unknown; noteThrottled: (now: number) => unknown };
};

/** Đề xuất A: ghim bộ tự tận dụng phần trống ở một bậc cố định (bỏ phần đo theo thời gian). */
const pinAdaptiveLevel = (level: number): { noteThrottled: ReturnType<typeof vi.fn> } => {
  const stub = { level, observe: () => null, noteThrottled: vi.fn(() => null) };
  internals().adaptive = stub;
  return stub;
};

const resource: ResourceProfile = {
  id: 'resource-lists',
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
let pacingOf: Map<string, unknown>;

const internals = (): Internals => manager as unknown as Internals;
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
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
// Lag bước 2: mỗi 350 ms chỉ bắt đầu tối đa 2 tác vụ. Đồng hồ (chỉ Date) được giả lập; mỗi lượt tick "cách nhau" 400 ms
// như nhịp tick thật, chạy đủ lượt để mọi chỗ còn trống được lấp.
const nextTickWindow = (): void => {
  vi.setSystemTime(Date.now() + 400);
};
const tickUntilSettled = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) {
    nextTickWindow();
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
const addDownloads = (project: Project, count: number, platform: 'tiktok' | 'youtube', extra: Record<string, unknown> = {}): QueueJob[] =>
  Array.from({ length: count }, () => {
    counter += 1;
    const url =
      platform === 'youtube'
        ? `https://www.youtube.com/watch?v=VID${String(counter).padStart(8, '0')}`
        : `https://www.tiktok.com/@kenh/video/${7100000000000 + counter}`;
    return queue.create({ projectId: project.id, type: 'download', input: { url, ...extra } });
  });
const startedIn = (project: Project): number => started.filter((job) => job.projectId === project.id).length;
const finishAll = async (project: Project): Promise<void> => {
  for (const job of started.filter((item) => item.projectId === project.id)) held.get(job.id)?.();
  await settle();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-lists-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  held = new Map();
  started = [];
  pacingOf = new Map();
  settings = { ...defaultAppSettings, maxConcurrentDownloadLists: 2, maxGlobalMergeJobs: 1 };
  const downloader = {
    run: vi.fn((job: QueueJob, _profile: unknown, _signal: unknown, onProgress: (progress: Record<string, unknown>) => void, pacing?: unknown) => {
      started.push(job);
      pacingOf.set(job.id, pacing);
      onProgress({ percent: 10, speed: null, etaSeconds: null, stage: 'downloading' });
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
  // Trần tổng theo máy (2026-10-24) đo máy đang chạy bài kiểm — các bài dưới kiểm trần KHÁC nên gỡ nó ra cho khỏi phụ thuộc máy.
  internals().autoGlobalDownloadCap = () => 99;
});

afterEach(async () => {
  for (const release of held.values()) release();
  await settle();
  internals().schedulerRunning = false;
  database.close();
  rmSync(folder, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('Lag bước 1 — trần số danh sách tải / quy trình ghép chạy cùng lúc, mỗi cái vẫn đủ luồng', () => {
  it('tối đa 2 danh sách tải chạy cùng lúc, MỖI danh sách đủ 4 luồng; danh sách thứ 3 chờ lượt rồi tự chạy khi một danh sách xong', async () => {
    const [a, b, c] = [makeProject('A'), makeProject('B'), makeProject('C')];
    for (const project of [a, b, c]) addDownloads(project, 5, 'tiktok');

    await tickUntilSettled();
    expect([startedIn(a), startedIn(b), startedIn(c)], 'A và B chạy đủ 4 luồng, C chờ').toEqual([4, 4, 0]);
    expect(manager.waitingLanes().downloadLists).toEqual([c.id]);

    await finishAll(a);
    await tickUntilSettled();
    expect(startedIn(a), 'A còn 1 video — vẫn giữ lượt').toBe(5);
    expect(startedIn(c), 'A chưa xong hẳn → C vẫn chờ').toBe(0);

    await finishAll(a);
    await tickUntilSettled();
    expect(startedIn(c), 'A xong hẳn → C vào lượt với đủ 4 luồng').toBe(4);
    expect(manager.waitingLanes().downloadLists).toEqual([]);
  });

  it('ô để "tự động" (0) dùng khuyến nghị phần cứng của máy', async () => {
    settings = { ...settings, maxConcurrentDownloadLists: 0 };
    internals().autoConcurrentDownloadLists = () => 1;
    const [a, b] = [makeProject('A'), makeProject('B')];
    for (const project of [a, b]) addDownloads(project, 3, 'tiktok');
    await tickUntilSettled();
    expect([startedIn(a), startedIn(b)]).toEqual([3, 0]);
  });

  it('quy trình ghép: tối đa maxGlobalMergeJobs quy trình chạy cùng lúc, mỗi quy trình đủ luồng tải (không chia đều cho mọi quy trình)', async () => {
    const [m1, m2] = [makeProject('Ghep 1'), makeProject('Ghep 2')];
    for (const project of [m1, m2]) addDownloads(project, 4, 'tiktok', { workflow: 'download-merge' });
    await tickUntilSettled();
    expect([startedIn(m1), startedIn(m2)]).toEqual([4, 0]);
    expect(manager.waitingLanes().mergeWorkflows).toEqual([m2.id]);
  });

  it('danh sách tải và quy trình ghép có trần riêng, không chiếm lượt của nhau', async () => {
    const [list, merge] = [makeProject('Danh sach'), makeProject('Ghep')];
    addDownloads(list, 2, 'tiktok');
    addDownloads(merge, 2, 'tiktok', { workflow: 'download-merge' });
    settings = { ...settings, maxConcurrentDownloadLists: 1, maxGlobalMergeJobs: 1 };
    await tickUntilSettled();
    expect([startedIn(list), startedIn(merge)]).toEqual([2, 2]);
  });

  it('YouTube tối đa 6 video toàn ứng dụng (cả làn ghép) dù 2 danh sách × 4 luồng = 8; nền tảng khác không bị trần này', async () => {
    settings = { ...settings, maxConcurrentDownloadLists: 2, maxGlobalMergeJobs: 1 };
    const [a, b, merge] = [makeProject('A'), makeProject('B'), makeProject('Ghep')];
    addDownloads(a, 4, 'youtube');
    addDownloads(b, 4, 'youtube');
    addDownloads(merge, 2, 'youtube', { workflow: 'download-merge' });
    await tickUntilSettled();
    const youtubeStarted = started.filter((job) => String(job.input.url).includes('youtube.com')).length;
    expect(youtubeStarted).toBe(6);

    const [tiktokA, tiktokB] = [makeProject('T1'), makeProject('T2')];
    settings = { ...settings, maxConcurrentDownloadLists: 4 };
    addDownloads(tiktokA, 4, 'tiktok');
    addDownloads(tiktokB, 4, 'tiktok');
    await tickUntilSettled();
    expect(startedIn(tiktokA) + startedIn(tiktokB)).toBe(8);
  });
});

// 2026-10-24 (nguyên tắc tự dò theo máy): ô "Tổng video tải đồng thời toàn ứng dụng" (maxGlobalDownloadWorkers) được lưu
// nhưng hàng đợi không đọc — chọn tay 2 danh sách × 4 luồng trên máy yếu vẫn mở 8 video. Giờ có trần tổng tự dò theo máy.
describe('Trần tổng video tải cùng lúc tự dò theo máy', () => {
  it('máy chỉ chịu 3 video: 2 danh sách × 4 luồng chỉ mở 3, xong một video thì mở tiếp đúng một', async () => {
    internals().autoGlobalDownloadCap = () => 3;
    const [a, b] = [makeProject('A'), makeProject('B')];
    for (const project of [a, b]) addDownloads(project, 4, 'tiktok');
    await tickUntilSettled();
    expect(started.length, 'trần tổng 3 dù danh sách cho phép 8').toBe(3);

    held.get(started[0]!.id)?.();
    await settle();
    await tickUntilSettled();
    expect(started.length, 'một video xong → mở thêm đúng một').toBe(4);
  });

  it('tính cả video của làn ghép vào trần tổng', async () => {
    internals().autoGlobalDownloadCap = () => 2;
    const [list, merge] = [makeProject('Danh sach'), makeProject('Ghep')];
    addDownloads(list, 2, 'tiktok');
    addDownloads(merge, 2, 'tiktok', { workflow: 'download-merge' });
    await tickUntilSettled();
    expect(started.length).toBe(2);
  });

  it('không dùng số cũ đã lưu ở maxGlobalDownloadWorkers (máy người dùng đang lưu 2 nhưng chạy 6–8 video)', async () => {
    settings = { ...settings, maxGlobalDownloadWorkers: 1 };
    internals().autoGlobalDownloadCap = () => 6;
    const [a, b] = [makeProject('A'), makeProject('B')];
    for (const project of [a, b]) addDownloads(project, 4, 'tiktok');
    await tickUntilSettled();
    expect(started.length).toBe(6);
  });
});

// Lag bước 2 (2026-10-12). Đo thật: mỗi lần mở yt-dlp tốn ≈0,77 s CPU; một lượt tick trước đây mở hết mọi video còn chỗ
// trong cùng một lúc (2 danh sách × 4 luồng = 8 tiến trình trong vài ms → máy đứng hình vài giây). Giờ mỗi 350 ms chỉ bắt đầu
// tối đa 2 tác vụ — tính theo THỜI GIAN, vì mỗi lần hàng đợi đổi trạng thái (emit) đều gọi tick ngay. Tổng số chạy cùng lúc
// vẫn như bước 1.
describe('Lag bước 2 — bắt đầu dần, tối đa 2 tác vụ mỗi 350 ms', () => {
  it('2 danh sách × 4 luồng: mỗi lượt tick (cách 400 ms) chỉ mở thêm 2 video, sau 4 lượt đủ 8 như cũ', async () => {
    const [a, b, c] = [makeProject('A'), makeProject('B'), makeProject('C')];
    for (const project of [a, b, c]) addDownloads(project, 5, 'tiktok');

    const counts: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      nextTickWindow();
      await tick();
      await settle();
      counts.push(started.length);
    }
    expect(counts, 'mỗi lượt +2, dừng ở 8 (trần 2 danh sách × 4 luồng)').toEqual([2, 4, 6, 8, 8]);
    expect([startedIn(a), startedIn(b), startedIn(c)]).toEqual([4, 4, 0]);
  });

  it('nhiều lượt tick sát nhau (do hàng đợi đổi trạng thái gọi tick ngay) vẫn chung suất 2 tác vụ của cửa sổ 350 ms', async () => {
    const [a, b] = [makeProject('A'), makeProject('B')];
    for (const project of [a, b]) addDownloads(project, 4, 'tiktok');
    for (let round = 0; round < 4; round += 1) {
      await tick();
      await settle();
    }
    expect(started.length, '4 lượt tick trong cùng một khoảnh khắc chỉ mở 2 video').toBe(2);
    vi.setSystemTime(Date.now() + 349);
    await tick();
    expect(started.length, 'chưa đủ 350 ms — chưa mở thêm').toBe(2);
    vi.setSystemTime(Date.now() + 1);
    await tick();
    await settle();
    expect(started.length, 'qua cửa sổ mới — mở thêm 2').toBe(4);
  });

  it('lượt tick đã hết suất bắt đầu vẫn báo đúng danh sách đang chờ lượt (không nhấp nháy "Đang chờ lượt")', async () => {
    const [a, b, c] = [makeProject('A'), makeProject('B'), makeProject('C')];
    for (const project of [a, b, c]) addDownloads(project, 5, 'tiktok');
    nextTickWindow();
    await tick();
    await settle();
    expect(started.length).toBe(2);
    await tick();
    await settle();
    expect(started.length, 'cùng cửa sổ — không mở thêm').toBe(2);
    expect(manager.waitingLanes().downloadLists, 'A và B đã giữ lượt, C chờ — dù lượt này đã hết suất').toEqual([c.id]);
  });
});

// Hướng C 429 (2026-10-12): bộ tải cần biết đang có bao nhiêu video CÙNG nền tảng tải trên toàn ứng dụng để hạ số kết nối
// aria2c và nghỉ giữa các yêu cầu. Trước đây hàng đợi không truyền gì.
describe('Hướng C 429 — hàng đợi báo bộ tải tình trạng nền tảng', () => {
  it('mỗi video nhận số video cùng nền tảng đang tải (tính cả nó) trên toàn ứng dụng; nền tảng khác đếm riêng', async () => {
    settings = { ...settings, maxConcurrentDownloadLists: 4 };
    const [a, b, t] = [makeProject('A'), makeProject('B'), makeProject('T')];
    addDownloads(a, 2, 'youtube');
    addDownloads(b, 2, 'youtube');
    addDownloads(t, 1, 'tiktok');
    await tickUntilSettled();
    const youtubeCounts = started
      .filter((job) => String(job.input.url).includes('youtube.com'))
      .map((job) => (pacingOf.get(job.id) as { samePlatformActive: number } | undefined)?.samePlatformActive);
    expect(youtubeCounts, 'video YouTube thứ n bắt đầu khi đã có n video YouTube đang tải').toEqual([1, 2, 3, 4]);
    const tiktok = started.find((job) => String(job.input.url).includes('tiktok.com'))!;
    expect(pacingOf.get(tiktok.id)).toMatchObject({ samePlatformActive: 1, rateLimitStrikes: 0 });
  });
});

// Đề xuất A (người dùng duyệt 2026-10-24). Đo thật: 1 danh sách chỉ chạy đúng số luồng của hồ sơ dù máy cho phép nhiều hơn,
// mỗi video 2 mảnh → mạng chỉ dùng ~1/4. Giờ tăng dần theo bậc; bậc 0 = y như cũ.
describe('Đề xuất A — tự tận dụng phần trống', () => {
  it('bậc 0: đúng như cũ (danh sách chạy đúng số luồng của hồ sơ)', async () => {
    pinAdaptiveLevel(0);
    internals().autoGlobalDownloadCap = () => 12;
    const a = makeProject('A');
    addDownloads(a, 10, 'tiktok');
    await tickUntilSettled();
    expect(startedIn(a)).toBe(4);
  });

  it('bậc tối đa, chỉ 1 danh sách: được dùng tới trần tổng theo máy', async () => {
    pinAdaptiveLevel(4);
    internals().autoGlobalDownloadCap = () => 12;
    const a = makeProject('A');
    addDownloads(a, 10, 'tiktok');
    await tickUntilSettled();
    expect(startedIn(a)).toBe(10);
  });

  it('bậc giữa: tăng từng phần (4 → 8 khi trần tổng 12, bậc 2/4)', async () => {
    pinAdaptiveLevel(2);
    internals().autoGlobalDownloadCap = () => 12;
    const a = makeProject('A');
    addDownloads(a, 10, 'tiktok');
    await tickUntilSettled();
    expect(startedIn(a)).toBe(8);
  });

  it('2 danh sách cùng có việc: trần tổng chia đều (12 → mỗi danh sách 6)', async () => {
    pinAdaptiveLevel(4);
    internals().autoGlobalDownloadCap = () => 12;
    const [a, b] = [makeProject('A'), makeProject('B')];
    for (const project of [a, b]) addDownloads(project, 8, 'tiktok');
    await tickUntilSettled();
    expect([startedIn(a), startedIn(b)]).toEqual([6, 6]);
  });

  it('máy yếu (trần tổng 2): không có gì để tăng — không vượt trần tổng', async () => {
    pinAdaptiveLevel(4);
    internals().autoGlobalDownloadCap = () => 2;
    const a = makeProject('A');
    addDownloads(a, 6, 'tiktok');
    await tickUntilSettled();
    expect(startedIn(a)).toBe(2);
  });

  it('YouTube vẫn tối đa 6 video toàn ứng dụng dù bậc tối đa', async () => {
    pinAdaptiveLevel(4);
    internals().autoGlobalDownloadCap = () => 12;
    const a = makeProject('A');
    addDownloads(a, 10, 'youtube');
    await tickUntilSettled();
    expect(startedIn(a)).toBe(6);
  });

  it('tắt "Tự tận dụng mạng còn trống": đúng như cũ dù bộ điều khiển ở bậc tối đa', async () => {
    settings = { ...settings, downloadAdaptiveBoost: false };
    pinAdaptiveLevel(4);
    internals().autoGlobalDownloadCap = () => 12;
    const a = makeProject('A');
    addDownloads(a, 10, 'tiktok');
    await tickUntilSettled();
    expect(startedIn(a)).toBe(4);
    expect((pacingOf.get(started[0]!.id) as { concurrentFragments?: number }).concurrentFragments).toBeUndefined();
  });

  it('số mảnh: video bắt đầu khi còn ít video tải được nhiều mảnh hơn; tự chọn số mảnh thì không đụng tới', async () => {
    pinAdaptiveLevel(4);
    internals().autoGlobalDownloadCap = () => 12;
    const a = makeProject('A');
    addDownloads(a, 1, 'tiktok');
    await tickUntilSettled();
    const base = recommendedConcurrentFragments(cpus().length, totalmem());
    expect((pacingOf.get(started[0]!.id) as { concurrentFragments?: number }).concurrentFragments).toBe(
      Math.min(8, 12 * base)
    );

    settings = { ...settings, downloadFragmentsAuto: false, downloadConcurrentFragments: 3 };
    const b = makeProject('B');
    addDownloads(b, 1, 'tiktok');
    await tickUntilSettled();
    const jobB = started.find((job) => job.projectId === b.id)!;
    expect((pacingOf.get(jobB.id) as { concurrentFragments?: number }).concurrentFragments).toBeUndefined();
  });

  it('video bị 429 hoặc 403 → báo bộ điều khiển lùi; lỗi khác thì không', () => {
    const stub = pinAdaptiveLevel(3);
    const a = makeProject('A');
    const [job] = addDownloads(a, 1, 'youtube');
    const note = (manager as unknown as { noteAdaptiveThrottle: (job: QueueJob, code: string, details?: Record<string, unknown>) => void })
      .noteAdaptiveThrottle.bind(manager);
    note(job!, 'DOWNLOAD_FAILED', { failureSubtype: 'network' });
    expect(stub.noteThrottled).not.toHaveBeenCalled();
    note(job!, 'DOWNLOAD_FAILED', { failureSubtype: 'http_403' });
    note(job!, 'SOURCE_RATE_LIMITED', {});
    expect(stub.noteThrottled).toHaveBeenCalledTimes(2);
  });
});
