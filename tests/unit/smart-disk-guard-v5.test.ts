import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaInfo, ParsedInputLine, QueueJob, ResourceProfile } from '@shared/types/domain.js';

const GIB = 1024 ** 3;
let mockedFreeBytes = 500 * GIB;

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => join(tmpdir(), `tubmedia-v5-elec-${key}`))
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    statfs: vi.fn(async (targetPath: string) => {
      await actual.stat(targetPath);
      return {
        bavail: BigInt(Math.floor(mockedFreeBytes / 4096)),
        bsize: 4096n,
        blocks: 0n,
        bfree: 0n,
        files: 0n,
        ffree: 0n,
        type: 0n
      };
    })
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
const { QuickDownloadService } = await import('@main/download/quick-download-service.js');
const { NormalizeEngine } = await import('@main/normalize/normalize-engine.js');
const { ClipEngine } = await import('@main/clips/clip-engine.js');
const { MergeEngine } = await import('@main/merge/merge-engine.js');
const { LocalCutService } = await import('@main/media/local-cut-service.js');

const interactiveProfile: ResourceProfile = builtInResourceProfiles.find(
  (profile) => profile.id === 'resource-interactive'
)!;

const sampleMediaInfo = (fileSize: number): MediaInfo => ({
  duration: 600,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.0',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  fileSize
});

function makeParsedLine(index: number, mediaId: string): ParsedInputLine {
  const url = `https://www.youtube.com/watch?v=${mediaId}`;
  return {
    id: randomUUID(),
    lineNumber: index,
    originalText: url,
    url,
    normalizedUrl: url,
    platform: 'youtube',
    extractorKey: 'youtube',
    mediaId,
    timestampStartSeconds: null,
    timestampEndSeconds: null,
    note: '',
    audioMode: 'keep',
    validity: 'valid',
    warnings: [],
    errors: []
  };
}

const tempRoots: string[] = [];
const openDbs: Array<{ close: () => void }> = [];

function createSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tubmedia-v5-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  mockedFreeBytes = 500 * GIB;
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe('V5 — Ngưỡng ổ trống thông minh + nhận diện đầy ổ giữa chừng (DISK_FULL)', () => {
  it('1) Tải nhanh 1 video khi ổ C: / ổ lưu còn 8 GiB trống → cho phép chạy thay vì chặn cứng 25 GiB', async () => {
    const sandbox = createSandbox();
    const outDir = join(sandbox, 'out');
    const tempDir = join(sandbox, 'temp');
    mkdirSync(outDir, { recursive: true });
    mkdirSync(tempDir, { recursive: true });
    mockedFreeBytes = 8 * GIB;

    const settingsStub = {
      get: () => ({ ...defaultAppSettings, defaultResourceProfileId: 'resource-interactive' }),
      profiles: () => ({ resources: builtInResourceProfiles, qualities: builtInQualityProfiles })
    };
    const service = new QuickDownloadService(
      { run: vi.fn(), hasJob: vi.fn(() => false) } as never,
      { get: vi.fn(() => ({ available: true, executablePath: 'ffmpeg.exe' })) } as never,
      {} as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      join(sandbox, 'state'),
      settingsStub as never
    );

    const checkDisk = service as unknown as {
      assertQuickDiskSpace: (paths: readonly string[]) => Promise<void>;
    };
    await expect(checkDisk.assertQuickDiskSpace([outDir, tempDir])).resolves.toBeUndefined();
  });

  it('2) Ghép tổng nguồn 20 GiB trên ổ chỉ còn 15 GiB → chặn sớm ở trạng thái paused (DISK_FULL) và nêu rõ cần 30.0 GB', async () => {
    const sandbox = createSandbox();
    const database = new AppDatabase(join(sandbox, 'db.sqlite'));
    openDbs.push(database);
    const queue = new QueueRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const items = new ItemRepository(database.db);
    const sources = new MediaSourceRepository(database.db);

    const sourceFolder = join(sandbox, 'sources');
    const tempFolder = join(sandbox, 'temp');
    const outputFolder = join(sandbox, 'output');
    mkdirSync(sourceFolder, { recursive: true });
    mkdirSync(tempFolder, { recursive: true });
    mkdirSync(outputFolder, { recursive: true });

    const project = projects.create({
      name: 'Ghép 20 GiB',
      sourceFolder,
      tempFolder,
      outputFolder,
      finalFileName: 'merged-20gb',
      qualityProfileId: 'quality-source-size',
      resourceProfileId: 'resource-interactive'
    });

    const imported = items.import(
      project.id,
      [makeParsedLine(1, 'vid1_10gb00'), makeParsedLine(2, 'vid2_10gb00')],
      'replace'
    );
    imported.forEach((item, idx) => {
      const filePath = join(sourceFolder, `part-${idx + 1}.mp4`);
      writeFileSync(filePath, 'stub');
      sources.setFile(item.sourceId!, filePath, sampleMediaInfo(10 * GIB), 'valid');
    });

    mockedFreeBytes = 15 * GIB;
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

    const mergeJob = queue.create({ projectId: project.id, type: 'merge', input: {} });
    const access = manager as unknown as {
      resourcesAllow: (job: QueueJob, profile: ResourceProfile, cpuPercent: number) => Promise<boolean>;
    };

    expect(await access.resourcesAllow(mergeJob, interactiveProfile, 0)).toBe(false);
    const updated = queue.get(mergeJob.id)!;
    expect(updated.status).toBe('paused');
    expect(updated.errorCode).toBe('DISK_FULL');
    expect(updated.errorMessage).toContain('15.0 GB');
    expect(updated.errorMessage).toContain('30.0 GB');

    // Kể cả khi còn 26 GiB (> mức cứng 25 GiB cũ) nhưng vẫn dưới 1.5 × 20 GiB = 30 GiB → vẫn chặn an toàn
    const mergeJob26 = queue.create({ projectId: project.id, type: 'merge', input: {} });
    mockedFreeBytes = 26 * GIB;
    expect(await access.resourcesAllow(mergeJob26, interactiveProfile, 0)).toBe(false);
    expect(queue.get(mergeJob26.id)!.errorCode).toBe('DISK_FULL');
  });

  it('3) ffmpeg báo "No space left on device" ở Normalize / Clip / Merge → ném DISK_FULL và QueueManager chuyển job sang paused (không sang failed)', async () => {
    const sandbox = createSandbox();
    const database = new AppDatabase(join(sandbox, 'db.sqlite'));
    openDbs.push(database);
    const queue = new QueueRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const items = new ItemRepository(database.db);
    const sources = new MediaSourceRepository(database.db);

    const sourceFolder = join(sandbox, 'sources');
    const tempFolder = join(sandbox, 'temp');
    const outputFolder = join(sandbox, 'output');
    mkdirSync(sourceFolder, { recursive: true });
    mkdirSync(tempFolder, { recursive: true });
    mkdirSync(outputFolder, { recursive: true });

    const inputPath = join(sourceFolder, 'clip1.mp4');
    writeFileSync(inputPath, 'video-bytes');

    const tools = {
      get: vi.fn((name: string) => ({ name, available: true, executablePath: `${name}.exe`, version: '8.1' }))
    };
    const diskFullProcesses = {
      run: vi.fn(() =>
        Promise.resolve({
          code: 1,
          stdoutTail: '',
          stderrTail:
            'av_interleaved_write_frame(): No space left on device\nError writing trailer: No space left on device',
          durationMs: 15
        })
      ),
      logEvent: vi.fn(),
      killByJob: vi.fn(() => Promise.resolve(undefined)),
      pauseByJob: vi.fn(() => Promise.resolve(0)),
      resumeByJob: vi.fn(() => Promise.resolve(0))
    };
    const quarantine = { move: vi.fn((p: string) => Promise.resolve(p)) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const verifier = {
      verify: vi.fn(() => Promise.resolve({ ok: true, level: 'deep', duration: 10, reasons: [] })),
      decodeStreamFailure: vi.fn(() => Promise.resolve(null))
    };
    const analyzer = {
      analyze: vi.fn(() =>
        Promise.resolve({
          ...sampleMediaInfo(1024 * 1024),
          duration: 10
        })
      ),
      forget: vi.fn()
    };

    const normalizer = new NormalizeEngine(
      tools as never,
      diskFullProcesses as never,
      analyzer as never,
      verifier as never,
      quarantine as never,
      logger as never
    );

    const dummyJob = { id: 'job-norm', projectId: 'proj-1' } as QueueJob;
    await expect(
      normalizer.normalizeToTarget(
        dummyJob,
        inputPath,
        { ...sampleMediaInfo(1024 * 1024), videoCodec: 'vp9' },
        join(tempFolder, '_normalized-cache'),
        {
          width: 1920,
          height: 1080,
          fps: 30,
          videoCodec: 'h264',
          pixelFormat: 'yuv420p',
          hdr: false,
          audioCodec: 'aac',
          sampleRate: 48_000,
          channels: 2
        },
        interactiveProfile,
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'DISK_FULL' });
    expect(quarantine.move).not.toHaveBeenCalled();

    const clipEngine = new ClipEngine(
      tools as never,
      diskFullProcesses as never,
      verifier as never,
      quarantine as never
    );
    await expect(
      clipEngine.create(
        dummyJob,
        {
          id: 'item-1',
          lineNumber: 1,
          originalText: inputPath,
          url: null,
          projectId: 'proj-1',
          position: 1,
          sourceId: null,
          clipFile: null,
          enabled: true,
          createdAt: '',
          updatedAt: '',
          kind: 'local_file',
          normalizedUrl: null,
          platform: null,
          extractorKey: null,
          mediaId: null,
          timestampStartSeconds: 1,
          timestampEndSeconds: 5,
          note: '',
          audioMode: 'keep',
          validity: 'valid',
          warnings: [],
          errors: []
        } as never,
        inputPath,
        tempFolder,
        interactiveProfile,
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'DISK_FULL' });

    const mergeEngine = new MergeEngine(
      tools as never,
      diskFullProcesses as never,
      analyzer as never,
      verifier as never,
      normalizer,
      {} as never,
      quarantine as never
    );

    const project = projects.create({
      name: 'Merge hết ổ giữa chừng',
      sourceFolder,
      tempFolder,
      outputFolder,
      finalFileName: 'out-enospc',
      qualityProfileId: 'quality-source-size',
      resourceProfileId: 'resource-interactive'
    });
    const imported = items.import(project.id, [makeParsedLine(1, 'enospc1_vid')], 'replace');
    sources.setFile(imported[0]!.sourceId!, inputPath, { ...sampleMediaInfo(1024 * 1024), duration: 10 }, 'valid');

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
      clipEngine,
      mergeEngine,
      diskFullProcesses as never,
      logger as never
    );

    const mergeJob = queue.create({ projectId: project.id, type: 'merge', input: {} });
    const execAccess = manager as unknown as {
      execute: (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void>;
    };
    await execAccess.execute(mergeJob, interactiveProfile, new AbortController().signal);

    const afterMerge = queue.get(mergeJob.id)!;
    expect(afterMerge.errorMessage ?? '', `errorCode=${afterMerge.errorCode}`).toContain('đã hết dung lượng trống');
    expect(afterMerge.status).toBe('paused');
    expect(afterMerge.errorCode).toBe('DISK_FULL');
    expect(afterMerge.attempts).toBe(0);
  });

  it('4) Cắt tệp có sẵn (LocalCutService) trên ổ chỉ còn 2 GiB trống → chặn sớm trước khi gọi ffmpeg', async () => {
    const sandbox = createSandbox();
    const outDir = join(sandbox, 'cut-out');
    mkdirSync(outDir, { recursive: true });
    const srcFile = join(sandbox, 'local.mp4');
    writeFileSync(srcFile, 'video-local');
    mockedFreeBytes = 2 * GIB;

    const runSpy = vi.fn((opts: { args: string[] }) => {
      writeFileSync(opts.args.at(-1)!, 'cut-bytes');
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '', durationMs: 5 });
    });
    const localCut = new LocalCutService(
      { run: runSpy, hasJob: vi.fn(() => false) } as never,
      { get: vi.fn(() => ({ name: 'ffmpeg', available: true, executablePath: 'ffmpeg.exe' })) } as never,
      { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 10 })) } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      () => Promise.resolve(60)
    );

    const started = await localCut.start({
      filePath: srcFile,
      outputDirectory: outDir,
      startTime: '0',
      endTime: '10',
      accurateCut: false
    });

    const deadline = Date.now() + 3_000;
    let finalStatus = localCut.status(started.taskId);
    while (finalStatus && !['completed', 'cancelled', 'failed'].includes(finalStatus.phase) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      finalStatus = localCut.status(started.taskId);
    }

    expect(finalStatus?.phase).toBe('failed');
    expect(finalStatus?.error).toMatch(/dung lượng trống|5\.0 GB/i);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
