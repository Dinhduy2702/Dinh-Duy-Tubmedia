import type * as FsPromises from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FsPromisesModule = typeof FsPromises;

const fsMocks = vi.hoisted(() => ({
  onLink: null as null | ((existingPath: string, newPath: string, realLink: FsPromisesModule['link']) => Promise<void>),
  onRename: null as null | ((oldPath: string, newPath: string, realRename: FsPromisesModule['rename']) => Promise<void>),
  copyFileCalls: 0
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<FsPromisesModule>();
  return {
    ...actual,
    link: vi.fn(async (existingPath: Parameters<FsPromisesModule['link']>[0], newPath: Parameters<FsPromisesModule['link']>[1]) => {
      if (fsMocks.onLink) {
        return await fsMocks.onLink(String(existingPath), String(newPath), actual.link);
      }
      return await actual.link(existingPath, newPath);
    }),
    rename: vi.fn(async (oldPath: Parameters<FsPromisesModule['rename']>[0], newPath: Parameters<FsPromisesModule['rename']>[1]) => {
      if (fsMocks.onRename) {
        return await fsMocks.onRename(String(oldPath), String(newPath), actual.rename);
      }
      return await actual.rename(oldPath, newPath);
    }),
    copyFile: vi.fn(async (...args: Parameters<FsPromisesModule['copyFile']>) => {
      fsMocks.copyFileCalls += 1;
      return await actual.copyFile(...args);
    })
  };
});

import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as nonConflictingPathModule from '../../src/main/files/non-conflicting-path.js';
import { ClipEngine } from '../../src/main/clips/clip-engine.js';
import { DownloadEngine } from '../../src/main/downloader/download-engine.js';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import { downloadPolicyForWorkflow } from '../../src/shared/utils/download-quality.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { MediaInfo, ProjectItem, QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

interface RecordedRetryEvent {
  operation: string;
  fileName: string;
  errorCode: string;
  retryAttempt: number;
  maxRetries: number;
  delayMs: number;
}

function makeErrno(code: string, syscall: string, targetPath: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: simulated transient lock during ${syscall} '${targetPath}'`) as NodeJS.ErrnoException;
  err.code = code;
  err.syscall = syscall;
  err.path = targetPath;
  return err;
}

const folders: string[] = [];
let retryEvents: RecordedRetryEvent[] = [];

const optionalHook = nonConflictingPathModule as unknown as {
  setFileLockRetryLogger?: (fn: ((event: RecordedRetryEvent) => void) | null) => void;
  renameWithRetry?: (sourcePath: string, destinationPath: string) => Promise<void>;
};

beforeEach(() => {
  fsMocks.onLink = null;
  fsMocks.onRename = null;
  fsMocks.copyFileCalls = 0;
  retryEvents = [];
  optionalHook.setFileLockRetryLogger?.((event) => {
    retryEvents.push(event);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  optionalHook.setFileLockRetryLogger?.(null);
  fsMocks.onLink = null;
  fsMocks.onRename = null;
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

function createClipFixture(folder: string) {
  const resource = { ffmpegThreads: 2, filterThreads: 1, processPriority: 'below_normal' } as ResourceProfile;
  const job = { id: 'job-v2', projectId: 'proj-v2' } as QueueJob;
  const item = {
    id: 'item-1',
    position: 1,
    timestampStartSeconds: null,
    timestampEndSeconds: null,
    audioMode: 'mute'
  } as ProjectItem;
  const processes = {
    run: async (options: ProcessRunOptions) => {
      await writeFile(options.args.at(-1)!, 'verified-clip-bytes', 'utf8');
      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
    }
  } as unknown as ProcessManager;
  const verifier = {
    verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard', reasons: [], duration: 5 })
  } as unknown as FileVerifier;
  const quarantine = {
    move: (path: string) => Promise.resolve(path)
  } as unknown as QuarantineService;
  const engine = new ClipEngine(
    { get: () => ({ available: true, executablePath: join(folder, 'ffmpeg.exe') }) } as unknown as ToolManager,
    processes,
    verifier,
    quarantine
  );
  return { engine, job, item, resource };
}

describe('Chốt tệp thành phẩm gặp khoá tạm Antivirus — giữ nguyên hành vi cũ (V2)', () => {
  it('commitFileWithoutOverwrite (link): ném EBUSY 2 lần rồi thành công ở lần 3, không ghi đè tệp đích đã có và ghi nhật ký từng lần thử lại', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-link-ebusy-'));
    folders.push(folder);
    const desired = join(folder, 'video.mp4');
    const pending = join(folder, 'video.pending.mp4');
    await writeFile(desired, 'existing-user-video', 'utf8');
    await writeFile(pending, 'new-verified-video', 'utf8');

    let candidateLinkCalls = 0;
    let desiredLinkCalls = 0;
    fsMocks.onLink = async (existingPath, newPath, realLink) => {
      if (newPath === desired) {
        desiredLinkCalls += 1;
        return await realLink(existingPath, newPath);
      }
      candidateLinkCalls += 1;
      if (candidateLinkCalls <= 2) {
        throw makeErrno('EBUSY', 'link', newPath);
      }
      return await realLink(existingPath, newPath);
    };

    const committed = await nonConflictingPathModule.commitFileWithoutOverwrite(pending, desired);

    expect(desiredLinkCalls, 'EEXIST trên tệp đã có không được thử lại').toBe(1);
    expect(candidateLinkCalls).toBe(3);
    expect(fsMocks.copyFileCalls).toBe(0);
    expect(committed).toBe(join(folder, 'video (2).mp4'));
    expect(await readFile(desired, 'utf8')).toBe('existing-user-video');
    expect(await readFile(committed, 'utf8')).toBe('new-verified-video');

    expect(retryEvents).toHaveLength(2);
    expect(retryEvents[0]).toMatchObject({
      operation: 'link',
      fileName: 'video (2).mp4',
      errorCode: 'EBUSY',
      retryAttempt: 1
    });
    expect(retryEvents[1]).toMatchObject({
      operation: 'link',
      fileName: 'video (2).mp4',
      errorCode: 'EBUSY',
      retryAttempt: 2
    });
  });

  it('commitFileWithoutOverwrite (link): ném EPERM 2 lần rồi thành công ở lần 3 trên NTFS mà không rơi sớm sang copyFile', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-link-eperm-'));
    folders.push(folder);
    const desired = join(folder, 'output.mp4');
    const pending = join(folder, 'output.pending.mp4');
    await writeFile(pending, 'verified-data', 'utf8');

    let linkCalls = 0;
    fsMocks.onLink = async (existingPath, newPath, realLink) => {
      linkCalls += 1;
      if (linkCalls <= 2) {
        throw makeErrno('EPERM', 'link', newPath);
      }
      return await realLink(existingPath, newPath);
    };

    const committed = await nonConflictingPathModule.commitFileWithoutOverwrite(pending, desired);

    expect(linkCalls).toBe(3);
    expect(fsMocks.copyFileCalls).toBe(0);
    expect(committed).toBe(desired);
    expect(await readFile(committed, 'utf8')).toBe('verified-data');
    expect(retryEvents.map((e) => [e.fileName, e.errorCode, e.retryAttempt])).toEqual([
      ['output.mp4', 'EPERM', 1],
      ['output.mp4', 'EPERM', 2]
    ]);
  });

  it('ClipEngine.create (rename): ném EPERM và EBUSY 2 lần rồi thành công ở lần 3, ghi nhật ký tên tệp + mã lỗi + số lần', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-clip-rename-'));
    folders.push(folder);
    const input = join(folder, 'source.mp4');
    await writeFile(input, 'source-bytes', 'utf8');
    const { engine, job, item, resource } = createClipFixture(folder);

    let pendingRenameCalls = 0;
    fsMocks.onRename = async (oldPath, newPath, realRename) => {
      if (oldPath.includes('.pending')) {
        pendingRenameCalls += 1;
        if (pendingRenameCalls === 1) throw makeErrno('EPERM', 'rename', newPath);
        if (pendingRenameCalls === 2) throw makeErrno('EBUSY', 'rename', newPath);
      }
      return await realRename(oldPath, newPath);
    };

    const output = await engine.create(job, item, input, folder, resource, new AbortController().signal, () => undefined);

    expect(pendingRenameCalls).toBe(3);
    expect(await readFile(output, 'utf8')).toBe('verified-clip-bytes');
    expect(retryEvents.map((e) => [e.operation, e.fileName, e.errorCode, e.retryAttempt])).toEqual([
      ['rename', basename(output), 'EPERM', 1],
      ['rename', basename(output), 'EBUSY', 2]
    ]);
  });

  it('ENOENT và EXDEV phải lỗi ngay lập tức, không chờ và không thử lại', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-nonretryable-'));
    folders.push(folder);
    const missingPending = join(folder, 'missing.pending.mp4');
    const desired = join(folder, 'final.mp4');

    let linkCalls = 0;
    fsMocks.onLink = async (existingPath, newPath, realLink) => {
      linkCalls += 1;
      return await realLink(existingPath, newPath);
    };

    const startEnoent = Date.now();
    await expect(nonConflictingPathModule.commitFileWithoutOverwrite(missingPending, desired)).rejects.toMatchObject({
      code: 'ENOENT'
    });
    const elapsedEnoent = Date.now() - startEnoent;
    expect(linkCalls).toBe(1);
    expect(elapsedEnoent).toBeLessThan(150);
    expect(retryEvents).toHaveLength(0);

    const input = join(folder, 'source.mp4');
    await writeFile(input, 'source', 'utf8');
    const { engine, job, item, resource } = createClipFixture(folder);
    let renameCalls = 0;
    fsMocks.onRename = (oldPath, newPath, realRename) => {
      if (oldPath.includes('.pending')) {
        renameCalls += 1;
        return Promise.reject(makeErrno('EXDEV', 'rename', newPath));
      }
      return realRename(oldPath, newPath);
    };

    const startExdev = Date.now();
    await expect(
      engine.create(job, item, input, folder, resource, new AbortController().signal, () => undefined)
    ).rejects.toMatchObject({ code: 'EXDEV' });
    const elapsedExdev = Date.now() - startExdev;
    expect(renameCalls).toBe(1);
    expect(elapsedExdev).toBeLessThan(150);
    expect(retryEvents).toHaveLength(0);
  });

  it('hết lượt thử lại (giới hạn tổng thời gian chờ ~2 giây) phải ném lại đúng đối tượng lỗi gốc', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-exhausted-'));
    folders.push(folder);
    const input = join(folder, 'source.mp4');
    await writeFile(input, 'source', 'utf8');
    const { engine, job, item, resource } = createClipFixture(folder);

    const rootError = makeErrno('EBUSY', 'rename', join(folder, 'clip.mp4'));
    let renameCalls = 0;
    fsMocks.onRename = (oldPath, _newPath, realRename) => {
      if (oldPath.includes('.pending')) {
        renameCalls += 1;
        return Promise.reject(rootError);
      }
      return realRename(oldPath, _newPath);
    };

    const startedAt = Date.now();
    let caught: unknown = null;
    try {
      await engine.create(job, item, input, folder, resource, new AbortController().signal, () => undefined);
    } catch (error) {
      caught = error;
    }
    const elapsedMs = Date.now() - startedAt;

    expect(caught).toBe(rootError);
    expect(renameCalls).toBeGreaterThanOrEqual(4);
    expect(elapsedMs).toBeGreaterThanOrEqual(1_600);
    expect(elapsedMs).toBeLessThan(3_200);
    expect(retryEvents.length).toBe(renameCalls - 1);
  });

  it('renameWithRetry ghi đè tệp đích đã có sẵn giống rename cũ và thử lại khi gặp EBUSY', async () => {
    expect(typeof optionalHook.renameWithRetry, 'cần xuất hàm renameWithRetry').toBe('function');
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-rename-overwrite-'));
    folders.push(folder);
    const pending = join(folder, 'output.pending.mp4');
    const existingTarget = join(folder, 'output.mp4');
    await writeFile(pending, 'new-pending-video', 'utf8');
    await writeFile(existingTarget, 'old-target-video', 'utf8');

    let calls = 0;
    fsMocks.onRename = async (oldPath, newPath, realRename) => {
      calls += 1;
      if (calls <= 2) throw makeErrno('EBUSY', 'rename', newPath);
      return await realRename(oldPath, newPath);
    };

    const doRename = optionalHook.renameWithRetry ?? ((src: string, dst: string) => rename(src, dst));
    await doRename(pending, existingTarget);

    expect(calls).toBe(3);
    expect(await readFile(existingTarget, 'utf8')).toBe('new-pending-video');
    expect(existsSync(pending)).toBe(false);
    expect(retryEvents).toHaveLength(2);
  });

  it('NormalizeEngine commitCacheFile khi final đã tồn tại → thay một bước duy nhất (không có rename(final, ...), final không bao giờ biến mất)', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-norm-cache-'));
    folders.push(folder);
    const input = join(folder, 'source.mp4');
    const cacheDir = join(folder, 'cache');
    await writeFile(input, 'source-fixture', 'utf8');

    const sourceInfo: MediaInfo = {
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      videoProfile: 'High',
      videoLevel: '4.1',
      pixelFormat: 'yuv420p',
      bitDepth: 8,
      timeBase: '1/90000',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
      colorSpace: 'bt709',
      hdr: false,
      audioCodec: 'aac',
      videoBitrate: 5_000_000,
      audioBitrate: 192_000,
      sampleRate: 44_100,
      channels: 2,
      channelLayout: 'stereo',
      formatName: 'mov,mp4',
      fileSize: 1000
    };
    const normTarget: NormalizeTarget = {
      width: 1920,
      height: 1080,
      fps: 30,
      hdr: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      sampleRate: 48_000,
      channels: 2
    };
    const normProfile: QualityProfile = {
      id: 'ref',
      name: 'Ref',
      description: '',
      mode: 'custom',
      maxWidth: 1920,
      maxHeight: 1080,
      allowUpscale: true,
      fpsMode: '30',
      customFps: null,
      videoCodec: 'h264',
      encoder: 'libx264',
      crf: 18,
      cq: 20,
      preset: 'veryfast',
      pixelFormat: 'yuv420p',
      hdrMode: 'tonemap_sdr',
      audioMode: 'aac_256',
      sampleRate: 48_000,
      forceStereo: true,
      builtIn: true
    };
    const normResource: ResourceProfile = {
      id: 'res',
      name: 'Res',
      description: '',
      downloadWorkers: 1,
      analyzeWorkers: 1,
      normalizeWorkers: 1,
      remuxWorkers: 1,
      clipWorkers: 1,
      ffmpegThreads: 2,
      filterThreads: 1,
      filterComplexThreads: 1,
      processPriority: 'below_normal',
      cpuSoftLimitPercent: 85,
      memoryFreeMinimumBytes: 1,
      diskFreeMinimumBytes: 1,
      gpuJobs: 0,
      builtIn: true
    };
    const makeJob = (id: string): QueueJob => ({
      id,
      projectId: 'proj',
      type: 'normalize',
      status: 'normalizing',
      priority: 0,
      sourceId: null,
      itemId: null,
      input: {},
      progress: 0,
      speed: null,
      etaSeconds: null,
      attempts: 0,
      maxAttempts: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
      startedAt: null,
      finishedAt: null
    });

    let cachedFinalPath = '';
    let runVersion = 0;
    const engine = new NormalizeEngine(
      { get: () => ({ available: true, executablePath: 'ffmpeg', capabilities: ['libx264'] }) } as unknown as ToolManager,
      {
        run: async (options: ProcessRunOptions) => {
          runVersion += 1;
          if (runVersion === 2 && cachedFinalPath) {
            // Mô phỏng danh sách A vừa chốt xong bản đệm dùng chung đúng lúc danh sách B đang mã hoá pending.
            await writeFile(cachedFinalPath, 'concurrent-project-a-cache', 'utf8');
          }
          await writeFile(options.args.at(-1)!, `normalized-v${runVersion}`, 'utf8');
          return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
        }
      } as unknown as ProcessManager,
      {} as MediaAnalyzer,
      {
        decodeStreamFailure: () => Promise.resolve(null),
        verify: (path: string) =>
          Promise.resolve({
            ok: path !== cachedFinalPath,
            path,
            level: 'standard' as const,
            reasons: path === cachedFinalPath ? ['corrupt-old-cache'] : [],
            duration: sourceInfo.duration
          })
      } as unknown as FileVerifier,
      { move: (p: string) => Promise.resolve(p) } as unknown as QuarantineService,
      { info: () => undefined, warn: () => undefined } as unknown as Logger
    );

    const first = await engine.normalizeToTarget(
      makeJob('job-1'),
      input,
      sourceInfo,
      cacheDir,
      normTarget,
      normResource,
      new AbortController().signal,
      () => undefined,
      normProfile
    );
    cachedFinalPath = first;
    expect(await readFile(cachedFinalPath, 'utf8')).toBe('normalized-v1');

    const renameCalls: Array<{ from: string; to: string; finalExistedBeforeCall: boolean }> = [];
    fsMocks.onRename = async (oldPath, newPath, realRename) => {
      renameCalls.push({
        from: oldPath,
        to: newPath,
        finalExistedBeforeCall: existsSync(cachedFinalPath)
      });
      return await realRename(oldPath, newPath);
    };

    const second = await engine.normalizeToTarget(
      makeJob('job-2'),
      input,
      sourceInfo,
      cacheDir,
      normTarget,
      normResource,
      new AbortController().signal,
      () => undefined,
      normProfile
    );

    expect(second).toBe(cachedFinalPath);
    expect(await readFile(cachedFinalPath, 'utf8')).toBe('normalized-v2');
    expect(renameCalls, 'chỉ được gọi đúng 1 lệnh rename(pending, final)').toHaveLength(1);
    expect(renameCalls[0]!.from).not.toBe(cachedFinalPath);
    expect(renameCalls[0]!.to).toBe(cachedFinalPath);
    expect(renameCalls[0]!.finalExistedBeforeCall, 'final luôn tồn tại trước lúc thay nguyên tử').toBe(true);
  });

  it('DownloadEngine bản CapCut (2 tệp) khi tệp output đã có sẵn → vẫn ghi đè thành công như mã trước V2', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-v2-capcut-overwrite-'));
    folders.push(folder);
    const masterPath = join(folder, 'Video goc [ABC123DEF45] [LINK_112233445566].webm');
    await writeFile(masterPath, 'master-vp9', 'utf8');

    const fixedTimestamp = 1799999999000;
    const preExistingEdit = join(folder, `Video goc [ABC123DEF45] [LINK_112233445566].capcut-edit-${fixedTimestamp}.mp4`);
    await writeFile(preExistingEdit, 'stale-edit-copy', 'utf8');

    const settings = {
      ...defaultAppSettings,
      downloadCompatibilityMode: 'source' as const,
      downloadEditCopyMode: 'capcut_sdr_1080p' as const
    };
    const policy = downloadPolicyForWorkflow(settings, 'download-only');
    const vp9Info: MediaInfo = {
      duration: 15,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'vp9',
      videoProfile: '0',
      videoLevel: null,
      pixelFormat: 'yuv420p',
      bitDepth: 8,
      timeBase: '1/1000',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
      colorSpace: 'bt709',
      hdr: false,
      audioCodec: 'opus',
      videoBitrate: 4_000_000,
      audioBitrate: 128_000,
      sampleRate: 48_000,
      channels: 2,
      channelLayout: 'stereo',
      formatName: 'matroska,webm',
      fileSize: 5000
    };
    const h264Info: MediaInfo = {
      ...vp9Info,
      videoCodec: 'h264',
      audioCodec: 'aac',
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2'
    };

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp);
    let editWrittenByFfmpeg = false;
    const processes = {
      run: async (options: ProcessRunOptions) => {
        if (options.tool !== 'ffmpeg') {
          throw new Error('Không được tải lại từ mạng khi nguồn master đã có sẵn hợp lệ.');
        }
        nowSpy.mockRestore();
        await writeFile(options.args.at(-1)!, 'fresh-capcut-edit', 'utf8');
        editWrittenByFfmpeg = true;
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
    } as unknown as ProcessManager;

    const downloader = new DownloadEngine(
      processes,
      {
        get: (name: string) => ({
          name,
          available: true,
          executablePath: join(folder, `${name}.exe`),
          capabilities: ['libx264', 'aac']
        })
      } as unknown as ToolManager,
      {
        get: () => ({
          id: 'src-1',
          identity: 'youtube:ABC123DEF45',
          originalUrl: 'https://www.youtube.com/watch?v=ABC123DEF45',
          normalizedUrl: 'https://www.youtube.com/watch?v=ABC123DEF45',
          platform: 'youtube',
          extractorKey: 'youtube',
          mediaId: 'ABC123DEF45',
          title: 'Video goc',
          uploader: 'Kenh',
          sourceFile: masterPath,
          downloadPolicy: policy,
          verificationStatus: 'verified',
          mediaInfoJson: null,
          createdAt: '',
          updatedAt: ''
        }),
        othersUsingFile: () => [],
        setFile: vi.fn(),
        setMetadata: vi.fn(),
        promoteIdentity: vi.fn(),
        updateMediaState: vi.fn(),
        clearFileCache: vi.fn(),
        invalidate: vi.fn()
      } as never,
      {
        get: () => ({
          id: 'proj-1',
          name: 'DS',
          sourceFolder: folder,
          tempFolder: join(folder, 'temp'),
          outputFolder: folder,
          finalFileName: 'out',
          workflowMode: 'download_only',
          qualityProfileId: 'q',
          resourceProfileId: 'r'
        })
      } as never,
      { get: () => settings } as never,
      {
        analyze: (path: string) => Promise.resolve(path.endsWith('.webm') ? vp9Info : h264Info)
      } as unknown as MediaAnalyzer,
      {
        verify: (path: string) =>
          Promise.resolve({
            ok: path === masterPath || editWrittenByFfmpeg,
            path,
            level: 'fast' as const,
            reasons: path === masterPath || editWrittenByFfmpeg ? [] : ['stale-edit'],
            duration: 15
          }),
        measureAudio: () => Promise.resolve({ maxVolumeDb: -3, meanVolumeDb: -16 })
      } as unknown as FileVerifier,
      { move: (p: string) => Promise.resolve(p) } as unknown as QuarantineService,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
    );

    const dlJob: QueueJob = {
      id: 'job-capcut',
      projectId: 'proj-1',
      type: 'download',
      status: 'downloading',
      priority: 0,
      sourceId: 'src-1',
      itemId: null,
      input: {},
      progress: 0,
      speed: null,
      etaSeconds: null,
      attempts: 0,
      maxAttempts: 3,
      errorCode: null,
      errorMessage: null,
      createdAt: '',
      updatedAt: '',
      startedAt: '',
      finishedAt: null
    };
    const dlResource: ResourceProfile = {
      id: 'r',
      name: 'R',
      description: '',
      downloadWorkers: 1,
      analyzeWorkers: 1,
      normalizeWorkers: 1,
      remuxWorkers: 1,
      clipWorkers: 1,
      ffmpegThreads: 2,
      filterThreads: 1,
      filterComplexThreads: 1,
      processPriority: 'below_normal',
      cpuSoftLimitPercent: 85,
      memoryFreeMinimumBytes: 1,
      diskFreeMinimumBytes: 1,
      gpuJobs: 0,
      builtIn: true
    };

    const result = await downloader.run(dlJob, dlResource, new AbortController().signal, () => undefined);

    expect(result.outputPath).toBe(preExistingEdit);
    expect(await readFile(preExistingEdit, 'utf8')).toBe('fresh-capcut-edit');
    expect(await readFile(masterPath, 'utf8')).toBe('master-vp9');
  });
});
