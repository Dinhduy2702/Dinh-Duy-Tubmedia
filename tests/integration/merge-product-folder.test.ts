import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { MergeEngine } from '@main/merge/merge-engine.js';
import { TimelineService } from '@main/merge/timeline-service.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { cleanupTemporaryArtifacts } from '@main/files/temporary-cleanup.js';
import { buildCleanupProtection } from '@main/files/cleanup-protection.js';
import { listResidueFiles } from '@main/system/cleanup-scanner.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { MediaInfo, Project, QualityProfile, QueueJob, ResourceProfile } from '@shared/types/domain.js';

const roots: string[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      // ignore already closed
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeMediaInfo(duration: number, fileSize = 2_000_000): MediaInfo {
  return {
    duration,
    videoStreamDuration: duration,
    audioStreamDuration: duration,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    videoProfile: 'High',
    videoLevel: '4.0',
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    timeBase: '1/90000',
    nominalFps: 30,
    variableFrameRate: false,
    sampleAspectRatio: '1:1',
    displayAspectRatio: '16:9',
    rotation: 0,
    streamStartTime: 0,
    timestampCondition: 'normal',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorSpace: 'bt709',
    colorRange: 'tv',
    hdr: false,
    hdrType: null,
    masteringDisplayMetadata: false,
    audioCodec: 'aac',
    videoBitrate: 4_000_000,
    audioBitrate: 192_000,
    sampleRate: 48_000,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    fileSize
  };
}

const STREAM_COPY_PROFILE: QualityProfile =
  builtInQualityProfiles.find((profile) => profile.mode === 'smart_merge') ?? builtInQualityProfiles[0]!;
const RESOURCE_PROFILE: ResourceProfile = builtInResourceProfiles[0]!;

interface HarnessOptions {
  durationsByFile?: Record<string, number>;
  ffmpegExitCode?: number;
  ffmpegErrorText?: string;
}

async function createMergeHarness(options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-v13-'));
  roots.push(root);
  const sourceFolder = join(root, 'nguon');
  const tempFolder = join(root, 'tam');
  const outputFolder = join(root, 'dau-ra');
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(tempFolder, { recursive: true });
  await mkdir(outputFolder, { recursive: true });

  const durations = new Map<string, number>();
  for (const [name, duration] of Object.entries(options.durationsByFile ?? {})) {
    durations.set(resolve(join(sourceFolder, name)).toLowerCase(), duration);
  }

  const createSourceClip = async (fileName: string, durationSeconds: number, fillByte = 7): Promise<string> => {
    const fullPath = join(sourceFolder, fileName);
    await writeFile(fullPath, Buffer.alloc(16_384, fillByte));
    durations.set(resolve(fullPath).toLowerCase(), durationSeconds);
    return fullPath;
  };

  let concatRuns = 0;
  let aspectRuns = 0;
  let ffmpegExitCode = options.ffmpegExitCode ?? 0;
  const processes = {
    run: vi.fn(async (runOptions: { args: string[]; onStdoutLine?: (line: string) => void }) => {
      const targetOutput = runOptions.args.at(-1)!;
      const isAspectRatio = runOptions.args.includes('-filter_complex');
      if (isAspectRatio) aspectRuns += 1;
      else concatRuns += 1;

      if (ffmpegExitCode !== 0) {
        return {
          code: ffmpegExitCode,
          stdoutTail: '',
          stderrTail: options.ffmpegErrorText ?? 'FFmpeg concat failed',
          durationMs: 5
        };
      }
      await writeFile(targetOutput, Buffer.alloc(131_072, isAspectRatio ? 9 : 11));
      const totalSeconds = [...durations.values()].reduce((sum, value) => sum + value, 0) || 10;
      durations.set(resolve(targetOutput).toLowerCase(), totalSeconds);
      runOptions.onStdoutLine?.(`out_time_ms=${Math.round(totalSeconds * 1_000_000)}`);
      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 5 };
    })
  };

  const analyzer = {
    analyze: vi.fn(async (filePath: string) => {
      const fileStat = await stat(filePath);
      const key = resolve(filePath).toLowerCase();
      const known =
        durations.get(key) ??
        ([...durations.values()].reduce((sum, value) => sum + value, 0) || 10);
      return makeMediaInfo(known, fileStat.size);
    }),
    forget: vi.fn()
  };

  const verifier = {
    verify: vi.fn((filePath: string, _level: string, expectedDuration?: number) => {
      if (!existsSync(filePath)) {
        return Promise.resolve({ ok: false, reasons: ['Tệp không tồn tại'], duration: 0 });
      }
      const key = resolve(filePath).toLowerCase();
      const duration =
        durations.get(key) ??
        expectedDuration ??
        ([...durations.values()].reduce((sum, value) => sum + value, 0) || 10);
      return Promise.resolve({ ok: true, reasons: [], duration });
    }),
    verifyVisualIntegrity: vi.fn(() => Promise.resolve({ ok: true, reasons: [], issues: [] })),
    sourceContainsVisualIssue: vi.fn(() => Promise.resolve(false))
  };

  const quarantine = {
    move: vi.fn(async (filePath: string) => {
      const dest = join(tempFolder, 'quarantine', basename(filePath));
      await mkdir(join(tempFolder, 'quarantine'), { recursive: true });
      await fsPromises.rename(filePath, dest).catch(() => undefined);
      return dest;
    })
  };

  const tools = {
    get: vi.fn((name: string) => ({
      name,
      available: true,
      executablePath: join(root, `${name}.exe`),
      version: '7.1',
      source: 'bundled',
      capabilities: ['libx264', 'aac', 'concat', 'mp4']
    }))
  };

  const timelineService = new TimelineService(analyzer as never);
  const normalizer = {
    normalize: vi.fn((_job: unknown, inputPath: string) => Promise.resolve(inputPath)),
    remuxForConcat: vi.fn((_job: unknown, inputPath: string) => Promise.resolve(inputPath))
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const engine = new MergeEngine(
    tools as never,
    processes as never,
    analyzer as never,
    verifier as never,
    normalizer as never,
    timelineService,
    quarantine as never
  );

  const database = new AppDatabase(join(root, 'studio.sqlite'));
  databases.push(database);
  const projects = new ProjectRepository(database.db);
  const items = new ItemRepository(database.db);
  const queueRepo = new QueueRepository(database.db);
  const sources = new MediaSourceRepository(database.db);
  const settings = {
    get: () => defaultAppSettings,
    profiles: () => ({ qualities: builtInQualityProfiles, resources: builtInResourceProfiles })
  };
  const queueManager = new QueueManager(
    queueRepo,
    projects,
    items,
    sources,
    settings as never,
    {} as never,
    {} as never,
    engine,
    verifier as never,
    logger as never
  );

  const executeJob = (job: QueueJob): Promise<void> =>
    (
      queueManager as unknown as {
        execute: (target: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void>;
      }
    ).execute(job, RESOURCE_PROFILE, new AbortController().signal);

  const seedProjectWithClips = async (
    finalFileName: string,
    clipSpecs: Array<{ fileName: string; duration: number; label: string }>,
    overrides: Partial<{
      outputFolder: string;
      exportTimelineTxt: boolean;
      aspectRatio: Project['aspectRatio'];
    }> = {}
  ): Promise<{ project: Project; sourceIds: string[]; clipPaths: string[] }> => {
    const project = projects.create({
      name: finalFileName,
      sourceFolder,
      tempFolder,
      outputFolder: overrides.outputFolder ?? outputFolder,
      finalFileName,
      qualityProfileId: STREAM_COPY_PROFILE.id,
      resourceProfileId: RESOURCE_PROFILE.id,
      exportTimelineTxt: overrides.exportTimelineTxt ?? false,
      aspectRatio: overrides.aspectRatio ?? 'original'
    });
    const sourceIds: string[] = [];
    const clipPaths: string[] = [];
    const now = new Date().toISOString();
    for (const [idx, spec] of clipSpecs.entries()) {
      const clipPath = await createSourceClip(spec.fileName, spec.duration, idx + 3);
      clipPaths.push(clipPath);
      const sourceId = randomUUID();
      const itemId = randomUUID();
      const position = idx + 1;
      const url = `https://drive.google.com/file/d/CLIP_${project.id}_${position}/view`;
      database.db
        .prepare(
          `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
           VALUES(?,?,?,?,'googledrive','googledrive',?,?,NULL,?,'merge-google-drive-native-download-v7','valid',NULL,?,?)`
        )
        .run(
          sourceId,
          `googledrive:googledrive:${project.id}:${position}`,
          url,
          url,
          `ID_${position}`,
          spec.label,
          clipPath,
          now,
          now
        );
      database.db
        .prepare(
          `INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
           VALUES(?,?,NULL,?,?,?,?,'googledrive','googledrive',?,?,NULL,NULL,'','default','valid','[]','[]',NULL,1,?,?)`
        )
        .run(itemId, project.id, position, url, url, url, `ID_${position}`, sourceId, now, now);
      sourceIds.push(sourceId);
    }
    return { project, sourceIds, clipPaths };
  };

  const enqueueReadyMergeJob = (
    project: Project,
    sourceIds: string[],
    extraInput: Record<string, unknown> = {}
  ): QueueJob => {
    const downloads = sourceIds.map((sourceId) => {
      const dl = queueRepo.create({
        projectId: project.id,
        type: 'download',
        sourceId,
        input: { workflow: 'download-merge' }
      });
      queueRepo.update(dl.id, { status: 'downloading' });
      return queueRepo.update(dl.id, { status: 'completed' });
    });
    return queueRepo.create({
      projectId: project.id,
      type: 'merge',
      input: {
        dependsOn: downloads.map((job) => job.id),
        productName: project.finalFileName,
        outputFolder: project.outputFolder,
        exportTimelineTxt: project.exportTimelineTxt,
        timelineOnly: false,
        ...extraInput
      },
      priority: 10,
      maxAttempts: 1
    });
  };

  return {
    root,
    sourceFolder,
    tempFolder,
    outputFolder,
    database,
    projects,
    items,
    queueRepo,
    sources,
    engine,
    timelineService,
    queueManager,
    executeJob,
    createSourceClip,
    seedProjectWithClips,
    enqueueReadyMergeJob,
    durations,
    getConcatRuns: () => concatRuns,
    getAspectRuns: () => aspectRuns,
    setFfmpegExitCode: (code: number) => {
      ffmpegExitCode = code;
    }
  };
}

describe('V13 — Thư mục riêng cho mỗi thành phẩm ghép (video + timeline.txt)', () => {
  it('(1) & (3) tạo thư mục trùng tên thành phẩm chứa đúng <tên>.mp4 và <tên>.timeline.txt chuẩn CRLF dù exportTimelineTxt=false', async () => {
    const h = await createMergeHarness();
    const { project, sourceIds } = await h.seedProjectWithClips(
      'Duy_KenhA_13.11.26.mp4',
      [
        { fileName: 'v1.mp4', duration: 1850.9, label: 'Phần 1' },
        { fileName: 'v2.mp4', duration: 1874.4, label: 'Phần 2' },
        { fileName: 'v3.mp4', duration: 600.2, label: 'Phần 3' }
      ],
      { exportTimelineTxt: false }
    );

    const job = h.enqueueReadyMergeJob(project, sourceIds);
    await h.executeJob(job);

    const finished = h.queueRepo.get(job.id)!;
    expect(finished.status, finished.errorMessage ?? '').toBe('completed');

    const topEntries = await readdir(h.outputFolder);
    expect(topEntries).toEqual(['Duy_KenhA_13.11.26']);

    const productFolder = join(h.outputFolder, 'Duy_KenhA_13.11.26');
    const innerEntries = (await readdir(productFolder)).sort();
    expect(innerEntries).toEqual([
      'Duy_KenhA_13.11.26.mp4',
      'Duy_KenhA_13.11.26.timeline.txt'
    ]);

    const expectedMp4 = join(productFolder, 'Duy_KenhA_13.11.26.mp4');
    const expectedTxt = join(productFolder, 'Duy_KenhA_13.11.26.timeline.txt');
    expect(finished.input.outputPath).toBe(expectedMp4);
    expect(finished.input.timelineTxt).toBe(expectedTxt);

    // Thoả thuận 3: UTF-8 không BOM, mỗi dòng MM:SS hoặc HH:MM:SS + " Ph Video_00k", làm tròn xuống giây, nối bằng CRLF, không tiêu đề, không "Kết thúc".
    const rawBytes = await readFile(expectedTxt);
    expect(rawBytes.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    const rawText = rawBytes.toString('utf8');
    // Video 1: 0s -> 00:00
    // Video 2: 1850.9s -> floor = 1850s = 30m50s -> 30:50
    // Video 3: 1850.9 + 1874.4 = 3725.3s -> floor = 3725s = 1h02m05s -> 01:02:05
    expect(rawText).toBe(
      '00:00 Ph Video_001\r\n30:50 Ph Video_002\r\n01:02:05 Ph Video_003'
    );
  });

  it('(2) thư mục trùng tên đã có → tạo "<tên> (2)", "(3)" và CẢ 2 tệp bên trong đều mang đúng tên có " (2)", không đụng thư mục cũ', async () => {
    const h = await createMergeHarness();

    // Lần 1: tạo thư mục gốc Duy_KenhA_13.11.26
    const first = await h.seedProjectWithClips('Duy_KenhA_13.11.26', [
      { fileName: 'a1.mp4', duration: 15, label: 'A1' },
      { fileName: 'a2.mp4', duration: 25, label: 'A2' }
    ]);
    const job1 = h.enqueueReadyMergeJob(first.project, first.sourceIds);
    await h.executeJob(job1);

    // Lần 2: danh sách khác cùng tên thành phẩm (nguồn khác nên ghép mới)
    const second = await h.seedProjectWithClips('Duy_KenhA_13.11.26', [
      { fileName: 'b1.mp4', duration: 42, label: 'B1' },
      { fileName: 'b2.mp4', duration: 18, label: 'B2' }
    ]);
    const job2 = h.enqueueReadyMergeJob(second.project, second.sourceIds);
    await h.executeJob(job2);

    // Người dùng tự tạo sẵn thư mục "(3)" rỗng → lần 3 phải nhảy sang "(4)" và không bỏ tệp vào "(3)"
    const userFolder3 = join(h.outputFolder, 'Duy_KenhA_13.11.26 (3)');
    await mkdir(userFolder3);

    const third = await h.seedProjectWithClips('Duy_KenhA_13.11.26', [
      { fileName: 'c1.mp4', duration: 70, label: 'C1' },
      { fileName: 'c2.mp4', duration: 30, label: 'C2' }
    ]);
    const job3 = h.enqueueReadyMergeJob(third.project, third.sourceIds);
    await h.executeJob(job3);

    expect((await readdir(h.outputFolder)).sort()).toEqual([
      'Duy_KenhA_13.11.26',
      'Duy_KenhA_13.11.26 (2)',
      'Duy_KenhA_13.11.26 (3)',
      'Duy_KenhA_13.11.26 (4)'
    ]);

    // Kiểm tra thư mục cũ lần 1 không bị nhét thêm tệp "(2)"
    expect((await readdir(join(h.outputFolder, 'Duy_KenhA_13.11.26'))).sort()).toEqual([
      'Duy_KenhA_13.11.26.mp4',
      'Duy_KenhA_13.11.26.timeline.txt'
    ]);

    // Chốt 1: cả MP4 lẫn .timeline.txt trong "(2)" đều phải mang đúng " (2)"
    const folder2 = join(h.outputFolder, 'Duy_KenhA_13.11.26 (2)');
    expect((await readdir(folder2)).sort()).toEqual([
      'Duy_KenhA_13.11.26 (2).mp4',
      'Duy_KenhA_13.11.26 (2).timeline.txt'
    ]);
    const finished2 = h.queueRepo.get(job2.id)!;
    expect(finished2.input.outputPath).toBe(join(folder2, 'Duy_KenhA_13.11.26 (2).mp4'));
    expect(finished2.input.timelineTxt).toBe(join(folder2, 'Duy_KenhA_13.11.26 (2).timeline.txt'));
    expect(await readFile(join(folder2, 'Duy_KenhA_13.11.26 (2).timeline.txt'), 'utf8')).toBe(
      '00:00 Ph Video_001\r\n00:42 Ph Video_002'
    );

    // Thư mục "(3)" của người dùng vẫn nguyên rỗng, còn lần 3 nằm trong "(4)" với đúng tên "(4)"
    expect(await readdir(userFolder3)).toEqual([]);
    const folder4 = join(h.outputFolder, 'Duy_KenhA_13.11.26 (4)');
    expect((await readdir(folder4)).sort()).toEqual([
      'Duy_KenhA_13.11.26 (4).mp4',
      'Duy_KenhA_13.11.26 (4).timeline.txt'
    ]);
  });

  it('(4) dùng lại thành phẩm đã hậu kiểm (verified-final): giữ nguyên chỗ cũ (cả kiểu phẳng cũ lẫn kiểu thư mục mới), có timeline cạnh MP4 và không đẻ "(2)" khi chạy lại', async () => {
    const h = await createMergeHarness();
    const { project, sourceIds } = await h.seedProjectWithClips('ThanhPham_Cu', [
      { fileName: 'u1.mp4', duration: 20, label: 'U1' },
      { fileName: 'u2.mp4', duration: 35, label: 'U2' }
    ]);

    // Mô phỏng thành phẩm phẳng từ bản trước khi nâng cấp
    const legacyFlatMp4 = join(h.outputFolder, 'ThanhPham_Cu.mp4');
    await writeFile(legacyFlatMp4, Buffer.alloc(32_768, 5));
    h.durations.set(resolve(legacyFlatMp4).toLowerCase(), 55);

    const jobLegacy1 = h.enqueueReadyMergeJob(project, sourceIds, {
      trustedOutputPath: legacyFlatMp4
    });
    await h.executeJob(jobLegacy1);
    const doneLegacy1 = h.queueRepo.get(jobLegacy1.id)!;
    expect(doneLegacy1.status).toBe('skipped');
    expect(doneLegacy1.input.mergeRecoveryMode).toBe('verified-final');
    expect(doneLegacy1.input.outputPath).toBe(legacyFlatMp4);
    expect(doneLegacy1.input.timelineTxt).toBe(join(h.outputFolder, 'ThanhPham_Cu.timeline.txt'));
    expect(h.getConcatRuns()).toBe(0);

    // Chạy lại lần 2 cùng thành phẩm phẳng đó → không được đẻ ThanhPham_Cu.timeline (2).txt
    const jobLegacy2 = h.enqueueReadyMergeJob(project, sourceIds, {
      trustedOutputPath: legacyFlatMp4
    });
    await h.executeJob(jobLegacy2);
    expect((await readdir(h.outputFolder)).sort()).toEqual([
      'ThanhPham_Cu.mp4',
      'ThanhPham_Cu.timeline.txt'
    ]);

    // Kiểu mới (trong thư mục thành phẩm): ghép lần đầu -> chạy lại verified-final -> không đẻ thư mục (2) hay timeline (2)
    const modern = await h.seedProjectWithClips('ThanhPham_Moi', [
      { fileName: 'm1.mp4', duration: 12, label: 'M1' },
      { fileName: 'm2.mp4', duration: 18, label: 'M2' }
    ]);
    const jobModern1 = h.enqueueReadyMergeJob(modern.project, modern.sourceIds);
    await h.executeJob(jobModern1);
    const doneModern1 = h.queueRepo.get(jobModern1.id)!;
    expect(h.getConcatRuns()).toBe(1);

    const jobModern2 = h.enqueueReadyMergeJob(modern.project, modern.sourceIds, {
      trustedOutputPath: doneModern1.input.outputPath
    });
    await h.executeJob(jobModern2);
    const doneModern2 = h.queueRepo.get(jobModern2.id)!;
    expect(doneModern2.status).toBe('skipped');
    expect(doneModern2.input.mergeRecoveryMode).toBe('verified-final');
    expect(h.getConcatRuns()).toBe(1);

    const modernFolder = join(h.outputFolder, 'ThanhPham_Moi');
    expect(await readdir(modernFolder)).toHaveLength(2);
    expect((await readdir(modernFolder)).sort()).toEqual([
      'ThanhPham_Moi.mp4',
      'ThanhPham_Moi.timeline.txt'
    ]);
  });

  it('(5) ghép lỗi giữa chừng hoặc ổ đầy lúc chốt cuối không để lại thư mục rỗng và giữ nguyên checkpoint .pending.mp4 để thử lại', async () => {
    const h = await createMergeHarness({ ffmpegExitCode: 1, ffmpegErrorText: 'Giả lập lỗi FFmpeg' });
    const { project, sourceIds } = await h.seedProjectWithClips('KhongRong', [
      { fileName: 'f1.mp4', duration: 10, label: 'F1' },
      { fileName: 'f2.mp4', duration: 15, label: 'F2' }
    ]);

    const failedJob = h.enqueueReadyMergeJob(project, sourceIds);
    await h.executeJob(failedJob);
    expect(h.queueRepo.get(failedJob.id)?.status).toBe('failed');
    expect(await readdir(h.outputFolder)).toEqual([]);

    // Cho FFmpeg chạy thành công, nhưng giả lập ENOSPC đúng lúc ghi tệp timeline trong thư mục thành phẩm
    h.setFfmpegExitCode(0);
    const writeSpy = vi.spyOn(h.timelineService, 'write').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    );

    const enospcJob = h.enqueueReadyMergeJob(project, sourceIds);
    await h.executeJob(enospcJob);
    expect(h.queueRepo.get(enospcJob.id)?.status).toBe('failed');
    // Không để lại thư mục rỗng hay tệp lẻ trong outputFolder
    expect(await readdir(h.outputFolder)).toEqual([]);

    // Checkpoint .pending.mp4 vẫn phải còn trong merge-checkpoints để dọn ổ xong thử lại không phải ghép lại
    const checkpointDir = join(h.tempFolder, 'Tubmedia', 'merge-checkpoints');
    const checkpoints = (await readdir(checkpointDir)).filter((name) => name.endsWith('.pending.mp4'));
    expect(checkpoints).toHaveLength(1);

    writeSpy.mockRestore();
    const concatBeforeRetry = h.getConcatRuns();
    const retryJob = h.enqueueReadyMergeJob(project, sourceIds);
    await h.executeJob(retryJob);
    const retryDone = h.queueRepo.get(retryJob.id)!;
    expect(retryDone.status).toBe('completed');
    expect(retryDone.input.mergeRecoveryMode).toBe('verified-checkpoint');
    expect(h.getConcatRuns()).toBe(concatBeforeRetry);
    expect((await readdir(join(h.outputFolder, 'KhongRong'))).sort()).toEqual([
      'KhongRong.mp4',
      'KhongRong.timeline.txt'
    ]);
  });

  it('(Chốt 2) kiểm độ dài đường dẫn theo phần dư " (99)": tên vượt giới hạn Windows báo rõ số ký tự; tên dài vừa đủ vẫn ghép thành công', async () => {
    const h = await createMergeHarness();

    // Tính độ dài vừa khít giới hạn Windows 259 ký tự khi cộng cả " (99)" hai lần và ".timeline.txt":
    // resolvedOut.length + 1 + (L + 5) + 1 + (L + 5) + 13 <= 259  =>  2L + resolvedOut.length + 25 <= 259
    const resolvedOut = resolve(h.outputFolder);
    const maxSafeNameLen = Math.floor((259 - resolvedOut.length - 25) / 2);
    expect(maxSafeNameLen).toBeGreaterThan(30);

    const fittingLongName = 'D'.repeat(maxSafeNameLen);
    const okCase = await h.seedProjectWithClips(fittingLongName, [
      { fileName: 'l1.mp4', duration: 8, label: 'L1' },
      { fileName: 'l2.mp4', duration: 12, label: 'L2' }
    ]);
    const okJob = h.enqueueReadyMergeJob(okCase.project, okCase.sourceIds);
    await h.executeJob(okJob);
    expect(h.queueRepo.get(okJob.id)?.status).toBe('completed');
    expect(existsSync(join(h.outputFolder, fittingLongName, `${fittingLongName}.mp4`))).toBe(true);
    expect(existsSync(join(h.outputFolder, fittingLongName, `${fittingLongName}.timeline.txt`))).toBe(true);

    // Dài hơn ngưỡng thật sự -> chặn ngay từ đầu trước khi chạy FFmpeg, báo rõ số ký tự đường dẫn & số ký tự cần rút ngắn
    const tooLongName = 'Q'.repeat(maxSafeNameLen + 6);
    const concatBefore = h.getConcatRuns();
    const badCase = await h.seedProjectWithClips(tooLongName, [
      { fileName: 'l3.mp4', duration: 8, label: 'L3' },
      { fileName: 'l4.mp4', duration: 12, label: 'L4' }
    ]);
    const badJob = h.enqueueReadyMergeJob(badCase.project, badCase.sourceIds);
    await h.executeJob(badJob);

    const failed = h.queueRepo.get(badJob.id)!;
    expect(failed.status).toBe('failed');
    expect(h.getConcatRuns()).toBe(concatBefore);
    expect(failed.errorMessage ?? '').toMatch(/\d+\s*ký tự/);
    expect(failed.errorMessage ?? '').toMatch(/rút ngắn tên/i);
    expect(failed.errorMessage ?? '').toMatch(/thư mục đầu ra/i);
  });

  it('(Chốt 3) xoá tác vụ ghép kèm xoá tệp: xoá sạch thư mục thành phẩm rỗng nhưng TUYỆT ĐỐI không xoá thư mục đầu ra cho thành phẩm kiểu cũ', async () => {
    const h = await createMergeHarness();

    // Ca 1: thư mục thành phẩm kiểu mới -> xoá MP4 + .timeline.txt + rmdir thư mục thành phẩm rỗng, giữ nguyên outputFolder
    const modern = await h.seedProjectWithClips('Xoa_Thu_Muc_Thanh_Pham', [
      { fileName: 'd1.mp4', duration: 10, label: 'D1' },
      { fileName: 'd2.mp4', duration: 10, label: 'D2' }
    ]);
    const modernJob = h.enqueueReadyMergeJob(modern.project, modern.sourceIds);
    await h.executeJob(modernJob);
    const productFolder = join(h.outputFolder, 'Xoa_Thu_Muc_Thanh_Pham');
    expect(existsSync(productFolder)).toBe(true);

    const removedModern = await h.queueManager.remove(modernJob.id, true);
    expect(removedModern.outputDeleted).toBe(true);
    expect(existsSync(productFolder)).toBe(false);
    expect(existsSync(h.outputFolder)).toBe(true);

    // Ca 1b: nếu người dùng có bỏ tệp riêng trong thư mục thành phẩm -> không xoá thư mục thành phẩm
    const withUserFile = await h.seedProjectWithClips('Co_Tep_Rieng', [
      { fileName: 'd3.mp4', duration: 10, label: 'D3' },
      { fileName: 'd4.mp4', duration: 10, label: 'D4' }
    ]);
    const jobWithUserFile = h.enqueueReadyMergeJob(withUserFile.project, withUserFile.sourceIds);
    await h.executeJob(jobWithUserFile);
    const folderWithUserFile = join(h.outputFolder, 'Co_Tep_Rieng');
    const customNote = join(folderWithUserFile, 'ghi-chu-editor.txt');
    await writeFile(customNote, 'giữ lại', 'utf8');
    await h.queueManager.remove(jobWithUserFile.id, true);
    expect(existsSync(join(folderWithUserFile, 'Co_Tep_Rieng.mp4'))).toBe(false);
    expect(existsSync(join(folderWithUserFile, 'Co_Tep_Rieng.timeline.txt'))).toBe(false);
    expect(existsSync(customNote)).toBe(true);

    // Ca 2 (hiểm nhất): thành phẩm kiểu cũ nằm thẳng trong thư mục đầu ra, và chính thư mục đầu ra cũng mang tên trùng với tên MP4!
    const sameNamedOutputRoot = join(h.root, 'Trung_Ten_Dau_Ra');
    await mkdir(sameNamedOutputRoot, { recursive: true });
    const legacy = await h.seedProjectWithClips(
      'Trung_Ten_Dau_Ra',
      [{ fileName: 'd5.mp4', duration: 10, label: 'D5' }],
      { outputFolder: sameNamedOutputRoot }
    );
    const legacyMp4 = join(sameNamedOutputRoot, 'Trung_Ten_Dau_Ra.mp4');
    await writeFile(legacyMp4, Buffer.alloc(4096, 3));
    const legacyJob = h.queueRepo.create({
      projectId: legacy.project.id,
      type: 'merge',
      input: {
        productName: 'Trung_Ten_Dau_Ra',
        outputFolder: sameNamedOutputRoot,
        outputPath: legacyMp4,
        timelineTxt: null
      },
      priority: 10,
      maxAttempts: 1
    });
    h.queueRepo.update(legacyJob.id, { status: 'merging' });
    h.queueRepo.update(legacyJob.id, { status: 'completed' });

    const removedLegacy = await h.queueManager.remove(legacyJob.id, true);
    expect(removedLegacy.outputDeleted).toBe(true);
    expect(existsSync(legacyMp4)).toBe(false);
    // Thư mục đầu ra của danh sách giờ rỗng và trùng tên MP4 nhưng TUYỆT ĐỐI không được bị rmdir!
    expect(existsSync(sameNamedOutputRoot)).toBe(true);
  });

  it('(6) chế độ chỉ-Timeline, bản đổi tỉ lệ 9:16 và bộ quét dọn dẹp máy giữ nguyên hành vi an toàn', async () => {
    const h = await createMergeHarness();

    // Chế độ chỉ tính Timeline, không ghép -> tự lưu <tên>\<tên>.timeline.txt theo đúng quy ước V13 (T1), không tạo MP4
    const tlOnly = await h.seedProjectWithClips('Chi_Timeline', [
      { fileName: 't1.mp4', duration: 14, label: 'T1' },
      { fileName: 't2.mp4', duration: 16, label: 'T2' }
    ]);
    const tlJob = h.enqueueReadyMergeJob(tlOnly.project, tlOnly.sourceIds, { timelineOnly: true });
    await h.executeJob(tlJob);
    const tlDone = h.queueRepo.get(tlJob.id)!;
    expect(tlDone.status).toBe('completed');
    expect(tlDone.input.outputPath).toBeNull();
    expect(tlDone.input.timelineTxt).toBe(join(h.outputFolder, 'Chi_Timeline', 'Chi_Timeline.timeline.txt'));
    expect(await readdir(join(h.outputFolder, 'Chi_Timeline'))).toEqual(['Chi_Timeline.timeline.txt']);

    // Bản đổi tỉ lệ 9:16 -> giữ nguyên hành vi applyAspectRatio cạnh ngoài, thư mục gốc vẫn có đủ 2 tệp
    const portrait = await h.seedProjectWithClips(
      'Video_Doc',
      [
        { fileName: 'p1.mp4', duration: 10, label: 'P1' },
        { fileName: 'p2.mp4', duration: 15, label: 'P2' }
      ],
      { aspectRatio: '9:16' }
    );
    const portraitJob = h.enqueueReadyMergeJob(portrait.project, portrait.sourceIds);
    await h.executeJob(portraitJob);
    const portraitDone = h.queueRepo.get(portraitJob.id)!;
    expect(portraitDone.status).toBe('completed');
    expect(portraitDone.input.outputPath).toBe(join(h.outputFolder, 'Video_Doc [9x16].mp4'));
    expect((await readdir(join(h.outputFolder, 'Video_Doc'))).sort()).toEqual([
      'Video_Doc.mp4',
      'Video_Doc.timeline.txt'
    ]);

    // Dọn dẹp máy & dọn tạm (kể cả lùi mtime 30 ngày và trỏ sourceFolder === outputFolder) KHÔNG coi thư mục thành phẩm là rác
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(join(h.outputFolder, 'Video_Doc', 'Video_Doc.mp4'), thirtyDaysAgo, thirtyDaysAgo);
    await utimes(join(h.outputFolder, 'Video_Doc', 'Video_Doc.timeline.txt'), thirtyDaysAgo, thirtyDaysAgo);

    const residue = await listResidueFiles({
      sourceFolders: [h.outputFolder],
      tempFolders: [h.tempFolder],
      trackedTempFiles: [],
      quickOutputFolders: [h.outputFolder],
      quickTempRoots: []
    });
    expect(residue.matches).toEqual([]);

    const protection = buildCleanupProtection({
      projects: [portrait.project],
      settings: defaultAppSettings,
      jobs: h.queueRepo.list(),
      sourceFiles: portrait.clipPaths
    });
    expect(protection.protectedFiles).toContain(join(h.outputFolder, 'Video_Doc', 'Video_Doc.timeline.txt'));
    await cleanupTemporaryArtifacts(h.tempFolder, [], false, protection);
    expect(existsSync(join(h.outputFolder, 'Video_Doc', 'Video_Doc.mp4'))).toBe(true);
    expect(existsSync(join(h.outputFolder, 'Video_Doc', 'Video_Doc.timeline.txt'))).toBe(true);
  });
});
