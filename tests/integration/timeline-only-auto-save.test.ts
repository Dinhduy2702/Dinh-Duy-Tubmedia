import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { MergeEngine } from '@main/merge/merge-engine.js';
import { TimelineService } from '@main/merge/timeline-service.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { buildCleanupProtection } from '@main/files/cleanup-protection.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { MediaInfo, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

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

const RESOURCE_PROFILE: ResourceProfile = builtInResourceProfiles[0]!;

async function createTimelineHarness() {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-t1-timeline-'));
  roots.push(root);
  const sourceFolder = join(root, 'nguon');
  const tempFolder = join(root, 'tam');
  const outputFolder = join(root, 'dau-ra');
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(tempFolder, { recursive: true });
  await mkdir(outputFolder, { recursive: true });

  const durations = new Map<string, number>();
  const createSourceClip = async (fileName: string, durationSeconds: number): Promise<string> => {
    const fullPath = join(sourceFolder, fileName);
    await writeFile(fullPath, Buffer.alloc(8_192, 5));
    durations.set(resolve(fullPath).toLowerCase(), durationSeconds);
    return fullPath;
  };

  const analyzer = {
    analyze: vi.fn(async (filePath: string) => {
      const fileStat = await stat(filePath);
      const duration = durations.get(resolve(filePath).toLowerCase()) ?? 10;
      return makeMediaInfo(duration, fileStat.size);
    }),
    forget: vi.fn()
  };

  const verifier = {
    verify: vi.fn((filePath: string, _level: string, expectedDuration?: number) => {
      if (!existsSync(filePath)) {
        return Promise.resolve({ ok: false, reasons: ['Tệp không tồn tại'], duration: 0 });
      }
      const duration = durations.get(resolve(filePath).toLowerCase()) ?? expectedDuration ?? 10;
      return Promise.resolve({ ok: true, reasons: [], duration });
    })
  };

  const tools = {
    get: vi.fn((name: string) => ({
      name,
      available: true,
      executablePath: join(root, `${name}.exe`),
      version: '7.1',
      source: 'bundled',
      capabilities: ['libx264', 'aac']
    }))
  };

  const timelineService = new TimelineService(analyzer as never);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const engine = new MergeEngine(
    tools as never,
    { run: vi.fn() } as never,
    analyzer as never,
    verifier as never,
    {} as never,
    timelineService,
    { move: vi.fn() } as never
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

  const seedTimelineProject = async (
    finalFileName: string,
    specs: Array<{ fileName: string; duration: number; label: string; start?: number | null; end?: number | null }>
  ): Promise<{ project: Project; sourceIds: string[]; clipPaths: string[] }> => {
    const project = projects.create({
      name: finalFileName,
      sourceFolder,
      tempFolder,
      outputFolder,
      finalFileName,
      qualityProfileId: builtInQualityProfiles[0]!.id,
      resourceProfileId: RESOURCE_PROFILE.id,
      exportTimelineTxt: false,
      aspectRatio: 'original'
    });
    const sourceIds: string[] = [];
    const clipPaths: string[] = [];
    const now = new Date().toISOString();
    for (const [idx, spec] of specs.entries()) {
      const clipPath = await createSourceClip(spec.fileName, spec.duration);
      clipPaths.push(clipPath);
      const sourceId = randomUUID();
      const itemId = randomUUID();
      const position = idx + 1;
      const url = `https://drive.google.com/file/d/TL_${project.id}_${position}/view`;
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
           VALUES(?,?,NULL,?,?,?,?,'googledrive','googledrive',?,?,?,?,'','default','valid','[]','[]',NULL,1,?,?)`
        )
        .run(
          itemId,
          project.id,
          position,
          url,
          url,
          url,
          `ID_${position}`,
          sourceId,
          spec.start ?? null,
          spec.end ?? null,
          now,
          now
        );
      sourceIds.push(sourceId);
    }
    return { project, sourceIds, clipPaths };
  };

  const enqueueTimelineOnlyJob = (project: Project, sourceIds: string[]): QueueJob => {
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
        dependsOn: downloads.map((j) => j.id),
        productName: project.finalFileName,
        outputFolder: project.outputFolder,
        exportTimelineTxt: false,
        timelineOnly: true
      },
      priority: 10,
      maxAttempts: 1
    });
  };

  return { outputFolder, queueRepo, queueManager, executeJob, seedTimelineProject, enqueueTimelineOnlyJob };
}

describe('T1 — Chế độ "Chỉ tạo Timeline" tự lưu tệp .timeline.txt theo đúng quy ước thư mục V13', () => {
  it('tạo đúng <tên>\\<tên>.timeline.txt (UTF-8 không BOM, CRLF, không tạo MP4) và ghi đường dẫn vào job.input.timelineTxt + bảo vệ dọn rác', async () => {
    const h = await createTimelineHarness();
    const seeded = await h.seedTimelineProject('Duy_Timeline_18.11.26', [
      { fileName: 'v1.mp4', duration: 65, label: 'Video 1' },
      { fileName: 'v2.mp4', duration: 130, label: 'Video 2', start: 10, end: 100 },
      { fileName: 'v3.mp4', duration: 45, label: 'Video 3' }
    ]);

    const job = h.enqueueTimelineOnlyJob(seeded.project, seeded.sourceIds);
    await h.executeJob(job);

    const done = h.queueRepo.get(job.id)!;
    expect(done.status).toBe('completed');
    expect(done.input.outputPath).toBeNull();

    const expectedFolder = join(h.outputFolder, 'Duy_Timeline_18.11.26');
    const expectedTxt = join(expectedFolder, 'Duy_Timeline_18.11.26.timeline.txt');
    expect(done.input.timelineTxt).toBe(expectedTxt);
    expect(existsSync(expectedTxt)).toBe(true);
    expect(await readdir(expectedFolder)).toEqual(['Duy_Timeline_18.11.26.timeline.txt']);

    const rawBytes = await readFile(expectedTxt);
    // UTF-8 không BOM
    expect(rawBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    // Video 1: 0s -> 00:00; Video 2: +65s -> 01:05 (dài 90s do cắt 10..100); Video 3: 65+90=155s -> 02:35
    expect(rawBytes.toString('utf8')).toBe(
      ['00:00 Ph Video_001', '01:05 Ph Video_002', '02:35 Ph Video_003'].join('\r\n')
    );

    const protection = buildCleanupProtection({
      projects: [seeded.project],
      settings: defaultAppSettings,
      jobs: h.queueRepo.list(),
      sourceFiles: seeded.clipPaths
    });
    expect(protection.protectedFiles).toContain(expectedTxt);
  });

  it('khi thư mục <tên> đã có sẵn → tự sang "<tên> (2)\\<tên> (2).timeline.txt", không ghi đè thư mục cũ; xoá kèm tệp dọn sạch thư mục rỗng', async () => {
    const h = await createTimelineHarness();
    const seeded = await h.seedTimelineProject('Duy_TrungTen', [
      { fileName: 'a.mp4', duration: 30, label: 'A' },
      { fileName: 'b.mp4', duration: 45, label: 'B' }
    ]);

    const job1 = h.enqueueTimelineOnlyJob(seeded.project, seeded.sourceIds);
    await h.executeJob(job1);
    const firstTxt = join(h.outputFolder, 'Duy_TrungTen', 'Duy_TrungTen.timeline.txt');
    expect(existsSync(firstTxt)).toBe(true);

    const job2 = h.enqueueTimelineOnlyJob(seeded.project, seeded.sourceIds);
    await h.executeJob(job2);
    const done2 = h.queueRepo.get(job2.id)!;
    const secondFolder = join(h.outputFolder, 'Duy_TrungTen (2)');
    const secondTxt = join(secondFolder, 'Duy_TrungTen (2).timeline.txt');

    expect(done2.status).toBe('completed');
    expect(done2.input.outputPath).toBeNull();
    expect(done2.input.timelineTxt).toBe(secondTxt);
    expect(existsSync(firstTxt)).toBe(true);
    expect(existsSync(secondTxt)).toBe(true);
    expect(await readdir(secondFolder)).toEqual(['Duy_TrungTen (2).timeline.txt']);
    expect(await readFile(secondTxt, 'utf8')).toBe(
      ['00:00 Ph Video_001', '00:30 Ph Video_002'].join('\r\n')
    );

    // Xoá tác vụ timelineOnly kèm xoá tệp → xoá .timeline.txt và rmdir thư mục thành phẩm rỗng
    const removed = await h.queueManager.remove(job2.id, true);
    expect(removed.removed).toBe(true);
    expect(removed.outputDeleted).toBe(true);
    expect(existsSync(secondTxt)).toBe(false);
    expect(existsSync(secondFolder)).toBe(false);
    // Bản thứ nhất và thư mục gốc của danh sách vẫn an toàn
    expect(existsSync(firstTxt)).toBe(true);
    expect(existsSync(h.outputFolder)).toBe(true);
  });
});
