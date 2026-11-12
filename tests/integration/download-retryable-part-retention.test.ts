import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('@shared/utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Chỉ rút ngắn thời gian ngủ trong bài kiểm (không sửa src/shared/utils/retry.ts thật).
    retryDelayMs: () => 5
  };
});

import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QuarantineRepository } from '@main/database/repositories/quarantine-repository.js';
import { QuarantineService } from '@main/media/quarantine-service.js';
import { DownloadEngine } from '@main/downloader/download-engine.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import {
  DOWNLOAD_TEMP_IDLE_MAX_MS,
  ORPHAN_MIN_IDLE_MS,
  downloadWorkFolder
} from '@main/files/download-temp-cleanup.js';
import { builtInQualityProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { IPC } from '@shared/contracts/channels.js';
import { downloadLinkTag } from '@shared/utils/url.js';
import type { AppSettings, AttentionNotice, MediaInfo, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

const testResource: ResourceProfile = {
  id: 'resource-v3-test',
  name: 'Hồ sơ kiểm thử V3',
  description: '',
  downloadWorkers: 2,
  analyzeWorkers: 1,
  normalizeWorkers: 1,
  remuxWorkers: 1,
  clipWorkers: 1,
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

const sampleMediaInfo: MediaInfo = {
  duration: 120,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.0',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/15360',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 4_000_000,
  audioBitrate: 128_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  fileSize: 8192
};

interface RecordedYtDlpInvocation {
  args: string[];
  workFolder: string;
  homeFolder: string;
  outputTemplate: string;
  partExistedAtStart: boolean;
}

type YtDlpStepHandler = (ctx: {
  attemptIndex: number;
  args: string[];
  workFolder: string;
  homeFolder: string;
  resolvedFileName: string;
  partPath: string;
  ytdlPath: string;
  signal?: AbortSignal | undefined;
  onStdoutLine?: ((line: string) => void) | undefined;
  onStderrLine?: ((line: string) => void) | undefined;
}) => Promise<{ code: number; stdoutTail: string; stderrTail: string }>;

describe('V3 — Giữ tệp tạm .part khi video tải lỗi do lỗi thử lại được', () => {
  let folder = '';
  let database: AppDatabase;
  let projects: ProjectRepository;
  let items: ItemRepository;
  let queue: QueueRepository;
  let sources: MediaSourceRepository;
  let manager: QueueManager;
  let settings: AppSettings;
  let notices: AttentionNotice[];
  let invocations: RecordedYtDlpInvocation[];
  let stepHandler: YtDlpStepHandler;

  beforeEach(async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-v3-part-'));
    database = new AppDatabase(join(folder, 'db.sqlite'));
    projects = new ProjectRepository(database.db);
    items = new ItemRepository(database.db);
    queue = new QueueRepository(database.db);
    sources = new MediaSourceRepository(database.db);
    settings = {
      ...defaultAppSettings,
      cookiesFilePath: '',
      cookiesBrowser: 'none',
      downloadCompatibilityMode: 'source',
      downloadEditCopyMode: 'off'
    };
    notices = [];
    invocations = [];

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const quarantine = new QuarantineService(logger, {
      items: new QuarantineRepository(database.db),
      projects,
      rootOf: () => folder
    });
    const analyzer = {
      analyze: vi.fn(() => Promise.resolve(sampleMediaInfo))
    };
    const verifier = {
      verify: vi.fn((path: string, level: string) =>
        Promise.resolve(
          existsSync(path)
            ? { ok: true, path, level, reasons: [], duration: sampleMediaInfo.duration }
            : { ok: false, path, level, reasons: ['Tệp không tồn tại.'], duration: 0 }
        )
      ),
      measureAudio: vi.fn(() => Promise.resolve({ meanVolumeDb: -18, maxVolumeDb: -3 }))
    };

    stepHandler = () =>
      Promise.resolve({
        code: 1,
        stdoutTail: '',
        stderrTail: 'ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 503: Service Unavailable'
      });

    const processes = {
      pauseByJob: vi.fn(() => Promise.resolve(0)),
      run: vi.fn(
        async (options: {
          tool?: string;
          args: string[];
          signal?: AbortSignal;
          onStdoutLine?: (line: string) => void;
          onStderrLine?: (line: string) => void;
        }) => {
          const tempArg =
            options.args.find((arg, idx) => options.args[idx - 1] === '--paths' && arg.startsWith('temp:')) ?? '';
          const homeArg =
            options.args.find((arg, idx) => options.args[idx - 1] === '--paths' && arg.startsWith('home:')) ?? '';
          const workFolder = tempArg.slice('temp:'.length);
          const homeFolder = homeArg.slice('home:'.length);
          const outputTemplate = options.args[options.args.indexOf('-o') + 1] ?? '';
          const resolvedFileName = outputTemplate.replace(/%\((\w+)\)[.\d]*[sB]/g, (_m, field: string) =>
            field === 'ext' ? 'mp4' : field === 'id' ? 'dQw4w9WgXcQ' : 'Video thu nghiem V3'
          );
          const partPath = join(workFolder, `${resolvedFileName}.part`);
          const ytdlPath = join(workFolder, `${resolvedFileName}.ytdl`);
          const attemptIndex = invocations.length;
          invocations.push({
            args: [...options.args],
            workFolder,
            homeFolder,
            outputTemplate,
            partExistedAtStart: existsSync(partPath)
          });
          const res = await stepHandler({
            attemptIndex,
            args: options.args,
            workFolder,
            homeFolder,
            resolvedFileName,
            partPath,
            ytdlPath,
            signal: options.signal,
            onStdoutLine: options.onStdoutLine,
            onStderrLine: options.onStderrLine
          });
          return { ...res, durationMs: 5 };
        }
      )
    };

    const tools = {
      get: vi.fn((name: string) =>
        name === 'yt-dlp'
          ? { available: true, executablePath: join(folder, 'yt-dlp-gia.exe') }
          : { available: false, executablePath: null }
      )
    };

    const downloader = new DownloadEngine(
      processes as never,
      tools as never,
      sources,
      projects,
      { get: () => settings } as never,
      analyzer as never,
      verifier as never,
      quarantine,
      logger as never
    );

    manager = new QueueManager(
      queue,
      projects,
      items,
      sources,
      {
        get: () => settings,
        profiles: () => ({ qualities: builtInQualityProfiles, resources: [testResource] })
      } as never,
      downloader,
      {} as never,
      {} as never,
      processes as never,
      logger as never,
      () => true
    );
    (manager as unknown as { cpuPercent: () => number }).cpuPercent = () => 10;
    manager.setWindow({
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      show: vi.fn(),
      restore: vi.fn(),
      flashFrame: vi.fn(),
      focus: vi.fn(),
      webContents: {
        send: vi.fn((channel: string, payload: unknown) => {
          if (channel === IPC.events.attention) notices.push(payload as AttentionNotice);
        })
      }
    } as never);
    await manager.start();
  });

  afterEach(async () => {
    await manager.stop(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    database.close();
    rmSync(folder, { recursive: true, force: true });
  });

  const createProjectAndJob = (name: string, videoId = 'dQw4w9WgXcQ'): { project: Project; job: QueueJob; linkTag: string; url: string } => {
    const sourceFolder = join(folder, name, 'video');
    const tempFolder = join(folder, name, 'tam');
    const outputFolder = join(folder, name, 'thanh-pham');
    mkdirSync(sourceFolder, { recursive: true });
    mkdirSync(tempFolder, { recursive: true });
    mkdirSync(outputFolder, { recursive: true });
    const project = projects.create({
      name,
      sourceFolder,
      tempFolder,
      outputFolder,
      finalFileName: name,
      qualityProfileId: builtInQualityProfiles[0]!.id,
      resourceProfileId: testResource.id
    });
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const sourceId = randomUUID();
    const now = new Date().toISOString();
    database.db
      .prepare(
        `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,'unknown',NULL,?,?)`
      )
      .run(sourceId, `youtube:${videoId}`, url, url, 'youtube', 'youtube', videoId, now, now);
    projects.setStatus(project.id, 'active');
    const job = queue.create({
      projectId: project.id,
      type: 'download',
      sourceId,
      input: { url, displayName: name, workflow: 'download-only' },
      priority: 100,
      maxAttempts: 3
    });
    return { project, job, linkTag: downloadLinkTag(url), url };
  };

  const driveUntilStatus = async (jobId: string, expected: ReadonlyArray<QueueJob['status']>, timeoutMs = 4_000): Promise<QueueJob> => {
    const internals = manager as unknown as { tick: () => Promise<void>; tickRunning: boolean };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!internals.tickRunning) {
        internals.tickRunning = true;
        try {
          await internals.tick();
        } finally {
          internals.tickRunning = false;
        }
      }
      const current = queue.get(jobId);
      if (current && expected.includes(current.status) && manager.activeCount() === 0) {
        // Chờ các tác vụ dọn chạy nền (void cleanupVideoDownloadTemp / cleanupProjectTemporaryArtifacts) hoàn tất.
        await new Promise((resolve) => setTimeout(resolve, 60));
        return queue.get(jobId)!;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Hết thời gian chờ trạng thái ${expected.join('/')} (hiện tại: ${queue.get(jobId)?.status})`);
  };

  it('lỗi thử lại được → hết lượt → failed → giữ tệp .part (đúng lời hứa thông báo 2366); quét mồ côi > 60 phút KHÔNG xoá; quá 14 ngày thì dọn', async () => {
    const { project, job, linkTag } = createProjectAndJob('MangRot');
    const expectedWorkFolder = downloadWorkFolder(project.tempFolder, project.id);
    let createdPartPath = '';

    stepHandler = ({ partPath, ytdlPath }) => {
      createdPartPath = partPath;
      writeFileSync(partPath, 'du-lieu-da-tai-50-phan-tram', 'utf8');
      writeFileSync(ytdlPath, '{"downloader":{"current_fragment":{"index":12}}}', 'utf8');
      return Promise.resolve({
        code: 1,
        stdoutTail: '',
        stderrTail: 'ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 503: Service Unavailable'
      });
    };

    const failedJob = await driveUntilStatus(job.id, ['failed']);
    expect(failedJob.status).toBe('failed');
    expect(failedJob.attempts).toBe(3);
    expect(invocations).toHaveLength(3);
    expect(notices.some((n) => n.steps?.some((s) => s.includes('Không xóa tệp .part')))).toBe(true);

    expect(createdPartPath).toContain(expectedWorkFolder);
    expect(createdPartPath).toContain(`[${linkTag}]`);
    expect(existsSync(createdPartPath), 'tệp .part phải được giữ sau khi hết lượt thử do lỗi mạng').toBe(true);

    // Lùi thời gian sửa tệp .part quá ngưỡng mồ côi 60 phút (2 giờ trước) → sweepOrphanTemporaryFiles KHÔNG được xoá.
    const twoHoursAgo = new Date(Date.now() - (ORPHAN_MIN_IDLE_MS + 60 * 60_000));
    for (const name of readdirSync(expectedWorkFolder)) {
      utimesSync(join(expectedWorkFolder, name), twoHoursAgo, twoHoursAgo);
    }
    await manager.sweepOrphanTemporaryFiles(Date.now());
    expect(existsSync(createdPartPath), 'quét mồ côi sau > 60 phút không được xoá .part của video lỗi thử lại được').toBe(true);

    // Nhưng nếu người dùng bỏ quên quá 14 ngày (DOWNLOAD_TEMP_IDLE_MAX_MS có sẵn) → tự dọn để ổ không phình vĩnh viễn.
    await manager.sweepOrphanTemporaryFiles(Date.now() + DOWNLOAD_TEMP_IDLE_MAX_MS + 60_000);
    expect(existsSync(createdPartPath), 'bỏ quên quá 14 ngày phải được dọn theo DOWNLOAD_TEMP_IDLE_MAX_MS').toBe(false);
  });

  it('bấm Thử lại sau lỗi thử lại được → yt-dlp dùng lại đúng downloadWorkFolder + mã link (thấy .part cũ), tải xong thì dọn sạch .part', async () => {
    const { project, job, linkTag } = createProjectAndJob('ThuLaiTaiTiep', 'AbCdEfGhIjK');
    const expectedWorkFolder = downloadWorkFolder(project.tempFolder, project.id);
    let savedPartPath = '';

    stepHandler = ({ partPath, ytdlPath }) => {
      savedPartPath = partPath;
      writeFileSync(partPath, 'phan-da-tai-truoc-khi-rot-mang', 'utf8');
      writeFileSync(ytdlPath, '{}', 'utf8');
      return Promise.resolve({
        code: 1,
        stdoutTail: '',
        stderrTail: 'ERROR: Read timed out. (read timeout=30)'
      });
    };

    const failedJob = await driveUntilStatus(job.id, ['failed']);
    expect(failedJob.status).toBe('failed');
    expect(existsSync(savedPartPath), '.part phải còn trước khi bấm Thử lại').toBe(true);
    const initialWorkFolder = invocations[0]!.workFolder;
    const initialTemplate = invocations[0]!.outputTemplate;

    // Người dùng bấm Thử lại: yt-dlp chạy lại trên đúng thư mục tạm cũ + cùng mẫu tên [LINK_…], thấy .part có sẵn rồi hoàn tất.
    stepHandler = ({ workFolder, homeFolder, resolvedFileName, partPath, args, onStdoutLine }) => {
      expect(workFolder).toBe(expectedWorkFolder);
      expect(workFolder).toBe(initialWorkFolder);
      expect(args).toContain('--continue');
      expect(args).toContain('--part');
      expect(existsSync(partPath), 'lúc yt-dlp bắt đầu lượt Thử lại, tệp .part cũ phải còn nguyên').toBe(true);

      const finalOutput = isAbsolute(resolvedFileName) ? resolvedFileName : join(homeFolder, resolvedFileName);
      writeFileSync(finalOutput, Buffer.alloc(8192, 7));
      // Giả lập còn sót tệp phụ mang [LINK_…] trong _dl để kiểm chứng bước dọn sau khi hoàn tất.
      onStdoutLine?.(`__VDMSP_FILE__:${finalOutput}`);
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '' });
    };

    manager.retry(job.id);
    const completedJob = await driveUntilStatus(job.id, ['completed']);
    expect(completedJob.status).toBe('completed');
    expect(invocations.at(-1)!.workFolder).toBe(expectedWorkFolder);
    expect(invocations.at(-1)!.outputTemplate).toBe(initialTemplate);
    expect(invocations.at(-1)!.outputTemplate).toContain(`[${linkTag}]`);
    expect(invocations.at(-1)!.partExistedAtStart).toBe(true);
    expect(existsSync(savedPartPath), 'Thử lại thành công → .part phải được dọn').toBe(false);
    expect(existsSync(expectedWorkFolder), 'danh sách đã xong hết → thư mục làm việc tạm được dọn').toBe(false);
  });

  it('lỗi KHÔNG thử lại được (video riêng tư / 404) → xoá .part ngay như cũ', async () => {
    const { project, job } = createProjectAndJob('LoiKhongThuLaiDuoc', 'PrIvAtEvId1');
    const expectedWorkFolder = downloadWorkFolder(project.tempFolder, project.id);
    let createdPartPath = '';

    stepHandler = ({ partPath }) => {
      createdPartPath = partPath;
      writeFileSync(partPath, 'rac-khong-the-tai-tiep', 'utf8');
      return Promise.resolve({
        code: 1,
        stdoutTail: '',
        stderrTail: 'ERROR: [youtube] PrIvAtEvId1: Private video. Sign in if you have been granted access to this video'
      });
    };

    const failedJob = await driveUntilStatus(job.id, ['failed']);
    expect(failedJob.status).toBe('failed');
    expect(failedJob.attempts).toBe(1);
    expect(existsSync(createdPartPath), 'lỗi không thử lại được phải xoá .part ngay').toBe(false);
    expect(existsSync(expectedWorkFolder)).toBe(false);
  });

  it('tải xong và bị huỷ giữa chừng → đều xoá .part như cũ', async () => {
    // 1) Tải xong
    const doneCase = createProjectAndJob('TaiXong', 'DoNeViDeO11');
    let leftoverPart = '';
    stepHandler = ({ homeFolder, resolvedFileName, partPath, onStdoutLine }) => {
      leftoverPart = partPath;
      writeFileSync(partPath, 'manh-phu-con-sot', 'utf8');
      const finalOutput = join(homeFolder, resolvedFileName);
      writeFileSync(finalOutput, Buffer.alloc(8192, 3));
      onStdoutLine?.(`__VDMSP_FILE__:${finalOutput}`);
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '' });
    };
    const completed = await driveUntilStatus(doneCase.job.id, ['completed']);
    expect(completed.status).toBe('completed');
    expect(existsSync(leftoverPart)).toBe(false);

    // 2) Huỷ giữa chừng khi đang tải
    const cancelCase = createProjectAndJob('BiHuy', 'CaNcElViD22');
    let cancelledPart = '';
    let notifyStarted: (() => void) | null = null;
    const startedPromise = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    stepHandler = ({ partPath, signal }) =>
      new Promise((resolve) => {
        cancelledPart = partPath;
        writeFileSync(partPath, 'dang-tai-do-thi-bi-huy', 'utf8');
        notifyStarted?.();
        signal?.addEventListener(
          'abort',
          () => resolve({ code: 1, stdoutTail: '', stderrTail: '' }),
          { once: true }
        );
      });

    const internals = manager as unknown as { tick: () => Promise<void>; tickRunning: boolean };
    internals.tickRunning = true;
    await internals.tick().finally(() => {
      internals.tickRunning = false;
    });
    await startedPromise;
    expect(existsSync(cancelledPart)).toBe(true);

    manager.cancel(cancelCase.job.id);
    const cancelled = await driveUntilStatus(cancelCase.job.id, ['cancelled']);
    expect(cancelled.status).toBe('cancelled');
    expect(existsSync(cancelledPart), 'huỷ tác vụ phải xoá .part như cũ').toBe(false);
  });

  it('người dùng xoá video lỗi hoặc xoá cả danh sách → .part vừa giữ được dọn ngay', async () => {
    stepHandler = ({ partPath }) => {
      writeFileSync(partPath, 'giu-cho-thu-lai', 'utf8');
      return Promise.resolve({
        code: 1,
        stdoutTail: '',
        stderrTail: 'ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 503: Service Unavailable'
      });
    };

    // 1) Xoá riêng video khỏi Hàng đợi (queue.remove)
    const single = createProjectAndJob('XoaVideo', 'RmViDeO0001');
    await driveUntilStatus(single.job.id, ['failed']);
    const singleWork = downloadWorkFolder(single.project.tempFolder, single.project.id);
    expect(existsSync(singleWork)).toBe(true);
    await manager.remove(single.job.id);
    expect(existsSync(singleWork), 'xoá video khỏi hàng đợi phải dọn luôn .part của nó').toBe(false);

    // 2) Xoá cả danh sách (queue.removeProject)
    const wholeList = createProjectAndJob('XoaDanhSach', 'RmLiSt00002');
    await driveUntilStatus(wholeList.job.id, ['failed']);
    const listWork = downloadWorkFolder(wholeList.project.tempFolder, wholeList.project.id);
    expect(existsSync(listWork)).toBe(true);
    await manager.removeProject(wholeList.project.id);
    expect(existsSync(listWork), 'xoá danh sách phải dọn luôn thư mục làm việc chứa .part').toBe(false);

    // 3) Dọn tiến trình đã kết thúc (queue.clearFinished)
    const clearedList = createProjectAndJob('DonTienTrinh', 'ClEaR000003');
    await driveUntilStatus(clearedList.job.id, ['failed']);
    const clearedWork = downloadWorkFolder(clearedList.project.tempFolder, clearedList.project.id);
    expect(existsSync(clearedWork)).toBe(true);
    expect(manager.clearFinished(clearedList.project.id)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(existsSync(clearedWork), 'dọn mục đã kết thúc phải dọn luôn .part của mục lỗi vừa xoá').toBe(false);
  });
});
