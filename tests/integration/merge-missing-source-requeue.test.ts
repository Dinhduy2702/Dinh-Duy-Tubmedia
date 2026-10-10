import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// S3 (2026-10-10, lỗi ghép "Duy_12_10_2026" ENOENT). Ghép bắt đầu đúng lúc tệp nguồn tạm vắng mặt (danh sách khác đã
// dời nó đi) và báo "ENOENT: no such file or directory, stat ..." thô — mất lượt ghép duy nhất (maxAttempts 1). Bài này
// chạy QueueManager.execute() thật trên CSDL thật và tệp thật trong os.tmpdir(); chỉ giả lập bộ ghép, và bộ ghép giả
// stat() tệp nguồn y như MergeEngine thật (createMergeCheckpointSignature) nên tệp thiếu cho ra đúng lỗi ENOENT thật.

type ExecuteAccess = { execute: (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void> };

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let items: ItemRepository;
let queue: QueueRepository;
let sources: MediaSourceRepository;
let manager: QueueManager;
let merge: ReturnType<typeof vi.fn>;
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

const resource = builtInResourceProfiles[0]!;
const execute = (job: QueueJob): Promise<void> =>
  (manager as unknown as ExecuteAccess).execute.call(manager, job, resource, new AbortController().signal);
const eventCodes = (): string[] =>
  [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].map((call) => String(call[1]));

const makeProject = (): Project =>
  projects.create({
    name: 'Duy_12_10_2026',
    sourceFolder: join(folder, 'nguon'),
    tempFolder: join(folder, 'tam'),
    outputFolder: join(folder, 'thanh-pham'),
    finalFileName: 'Duy_12_10_2026',
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: resource.id
  });

/** Một dòng trong danh sách ghép + bản ghi nguồn của chính danh sách, trỏ tới `file` (có thể chưa/không còn tồn tại). */
const addItem = (
  project: Project,
  position: number,
  file: string,
  clip: { start: number; end: number } | null = null
): { itemId: string; sourceId: string; url: string } => {
  const sourceId = randomUUID();
  const itemId = randomUUID();
  const url = `https://drive.google.com/file/d/TT8${position}_TBN/view`;
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,'googledrive','googledrive',?,?,NULL,?,'merge-google-drive-native-download-v7','valid',NULL,?,?)`
    )
    .run(sourceId, `googledrive:googledrive:TT8${position}::project:${project.id}`, url, url, `TT8${position}`, `TT8${position}_TBN`, file, now, now);
  database.db
    .prepare(
      `INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
       VALUES(?,?,NULL,?,?,?,?,'googledrive','googledrive',?,?,?,?,'','default','valid','[]','[]',NULL,1,?,?)`
    )
    .run(itemId, project.id, position, url, url, url, `TT8${position}`, sourceId, clip?.start ?? null, clip?.end ?? null, now, now);
  return { itemId, sourceId, url };
};

/** Tác vụ tải chạy xong thật qua máy trạng thái (pending → downloading → completed). */
const finish = (jobId: string): QueueJob => {
  queue.update(jobId, { status: 'downloading' });
  return queue.update(jobId, { status: 'completed' });
};

/** Tác vụ ghép như enqueueProject tạo ra, với các tác vụ tải nó phụ thuộc đã xong. */
const mergeJobFor = (project: Project, sourceIds: string[]): QueueJob => {
  const downloads = sourceIds.map((sourceId) => {
    const job = queue.create({ projectId: project.id, type: 'download', sourceId, input: { workflow: 'download-merge' } });
    return finish(job.id);
  });
  return queue.create({
    projectId: project.id,
    type: 'merge',
    input: { dependsOn: downloads.map((job) => job.id), productName: project.finalFileName, timelineOnly: false },
    priority: 10,
    maxAttempts: 1
  });
};

const writeVideo = (path: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(4096, 7));
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-merge-missing-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  items = new ItemRepository(database.db);
  queue = new QueueRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  // Bộ ghép giả: stat() từng tệp nguồn đúng như MergeEngine.createMergeCheckpointSignature() rồi mới "ghép".
  merge = vi.fn(async (_job: QueueJob, inputs: Array<{ path: string; sourcePath?: string }>, outputFolder: string) => {
    for (const input of inputs) await stat(input.sourcePath ?? input.path);
    return {
      video: join(outputFolder, 'Duy_12_10_2026.mp4'),
      recoveryMode: 'fresh',
      reusedExisting: false,
      warnings: [],
      visualBoundaryTransitions: [],
      timeline: { txt: null, itemCount: inputs.length, totalDuration: 0, rows: [] }
    };
  });
  const settings = {
    get: () => defaultAppSettings,
    profiles: () => ({ qualities: builtInQualityProfiles, resources: builtInResourceProfiles })
  };
  manager = new QueueManager(
    queue,
    projects,
    items,
    sources,
    settings as never,
    {} as never,
    {} as never,
    { merge, createTimelineOnly: vi.fn() } as never,
    {} as never,
    logger as never
  );
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('S3 — ghép thấy tệp nguồn bị thiếu: đưa video đó tải lại rồi chờ, không báo ENOENT thô', () => {
  it('tệp nguồn vắng mặt lúc bắt đầu ghép → tạo lại tác vụ tải cho đúng nguồn đó, ghép quay về chờ, không thất bại', async () => {
    const project = makeProject();
    const present = join(project.sourceFolder, 'TT81_TBN [LINK_a].mp4');
    const missing = join(project.sourceFolder, 'TT82_TBN [LINK_b].mp4');
    writeVideo(present);
    const first = addItem(project, 1, present);
    const second = addItem(project, 2, missing);
    const mergeJob = mergeJobFor(project, [first.sourceId, second.sourceId]);

    await execute(mergeJob);

    const after = queue.get(mergeJob.id)!;
    expect(after.status, after.errorMessage ?? '').toBe('pending');
    expect(after.errorMessage).toBeNull();
    expect(after.attempts).toBe(0);
    expect(merge).not.toHaveBeenCalled();
    const redownloads = queue
      .list(project.id)
      .filter((job) => job.type === 'download' && job.status === 'pending');
    expect(redownloads).toHaveLength(1);
    expect(redownloads[0]).toMatchObject({ sourceId: second.sourceId, input: { workflow: 'download-merge', url: second.url } });
    expect(after.input.dependsOn).toEqual([redownloads[0]!.id]);
    expect(String(after.input.progressStage)).toContain('Chờ tải lại');
    expect(eventCodes()).toContain('MERGE_SOURCE_MISSING_REQUEUED');
    expect(eventCodes()).not.toContain('JOB_FAILED');
    expect(projects.get(project.id)?.status).not.toBe('failed');
  });

  it('dòng có cắt đoạn mà tệp nguồn thiếu → tải lại rồi cắt lại; ghép chờ bước cắt', async () => {
    const project = makeProject();
    const missing = join(project.sourceFolder, 'TT83_TBN [LINK_c].mp4');
    const clipped = addItem(project, 1, missing, { start: 2, end: 9 });
    const mergeJob = mergeJobFor(project, [clipped.sourceId]);

    await execute(mergeJob);

    const jobs = queue.list(project.id);
    const download = jobs.find((job) => job.type === 'download' && job.status === 'pending')!;
    const clip = jobs.find((job) => job.type === 'clip' && job.status === 'pending')!;
    expect(download).toBeDefined();
    expect(clip).toMatchObject({ itemId: clipped.itemId, sourceId: clipped.sourceId, input: { dependsOn: [download.id] } });
    expect(queue.get(mergeJob.id)?.input.dependsOn).toEqual([clip.id]);
    expect(merge).not.toHaveBeenCalled();
  });

  it('tải lại xong (tệp đã có lại) → lượt ghép kế tiếp chạy bình thường với đủ nguồn', async () => {
    const project = makeProject();
    const present = join(project.sourceFolder, 'TT81_TBN [LINK_a].mp4');
    const missing = join(project.sourceFolder, 'TT82_TBN [LINK_b].mp4');
    writeVideo(present);
    const first = addItem(project, 1, present);
    const second = addItem(project, 2, missing);
    const mergeJob = mergeJobFor(project, [first.sourceId, second.sourceId]);

    await execute(mergeJob);
    const redownload = queue.list(project.id).find((job) => job.type === 'download' && job.status === 'pending')!;
    writeVideo(missing);
    finish(redownload.id);
    await execute(queue.get(mergeJob.id)!);

    expect(merge).toHaveBeenCalledTimes(1);
    expect((merge.mock.calls[0]![1] as Array<{ sourcePath: string }>).map((input) => input.sourcePath)).toEqual([present, missing]);
    expect(queue.get(mergeJob.id)?.status).toBe('completed');
  });

  it('tải lại rồi mà tệp vẫn biến mất → dừng hẳn với lỗi tiếng Việt nêu đúng tên tệp và vị trí, không lặp vô hạn', async () => {
    const project = makeProject();
    const missing = join(project.sourceFolder, 'TT82_TBN [LINK_b].mp4');
    const second = addItem(project, 2, missing);
    let mergeJob = mergeJobFor(project, [second.sourceId]);

    for (let round = 0; round < 2; round += 1) {
      await execute(mergeJob);
      for (const job of queue.list(project.id).filter((x) => x.type === 'download' && x.status === 'pending')) {
        finish(job.id);
      }
      mergeJob = queue.get(mergeJob.id)!;
      expect(mergeJob.status).toBe('pending');
    }
    const downloadsBefore = queue.list(project.id).filter((job) => job.type === 'download').length;
    await execute(mergeJob);

    const failed = queue.get(mergeJob.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toContain(basename(missing));
    expect(failed.errorMessage).toContain('vị trí 2');
    expect(failed.errorMessage).not.toMatch(/ENOENT|no such file/i);
    expect(queue.list(project.id).filter((job) => job.type === 'download')).toHaveLength(downloadsBefore);
    expect(merge).not.toHaveBeenCalled();
  });
});
