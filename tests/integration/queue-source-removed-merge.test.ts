import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { SourceRemovedError } from '@shared/errors/app-errors.js';
import type { Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

type ExecuteAccess = { execute: (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void> };

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let items: ItemRepository;
let queue: QueueRepository;
let sources: MediaSourceRepository;
let manager: QueueManager;
let downloaderRun: ReturnType<typeof vi.fn>;
let merge: ReturnType<typeof vi.fn>;
let logger: {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

const resource = builtInResourceProfiles[0]!;
const execute = (job: QueueJob): Promise<void> =>
  (manager as unknown as ExecuteAccess).execute.call(manager, job, resource, new AbortController().signal);

const makeProject = (): Project =>
  projects.create({
    name: 'Merge_Removed_Test',
    sourceFolder: join(folder, 'nguon'),
    tempFolder: join(folder, 'tam'),
    outputFolder: join(folder, 'thanh-pham'),
    finalFileName: 'Merge_Removed_Test',
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: resource.id
  });

const addItem = (
  project: Project,
  position: number,
  videoId: string,
  file: string | null,
  clip: { start: number; end: number } | null = null
): { itemId: string; sourceId: string; url: string } => {
  const sourceId = randomUUID();
  const itemId = randomUUID();
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,'youtube','youtube',?,?,NULL,?,'default','valid',NULL,?,?)`
    )
    .run(
      sourceId,
      `youtube:youtube:${videoId}::project:${project.id}`,
      url,
      url,
      videoId,
      `Video_${position}`,
      file,
      now,
      now
    );
  database.db
    .prepare(
      `INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
       VALUES(?,?,NULL,?,?,?,?,'youtube','youtube',?,?,?,?,'','default','valid','[]','[]',NULL,1,?,?)`
    )
    .run(itemId, project.id, position, url, url, url, videoId, sourceId, clip?.start ?? null, clip?.end ?? null, now, now);
  return { itemId, sourceId, url };
};

const writeVideo = (path: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(4096, 5));
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-source-removed-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  items = new ItemRepository(database.db);
  queue = new QueueRepository(database.db);
  sources = new MediaSourceRepository(database.db);
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  downloaderRun = vi.fn();
  merge = vi.fn((_job: QueueJob, inputs: Array<{ path: string; label: string }>, outputFolder: string) =>
    Promise.resolve({
      video: join(outputFolder, 'Merge_Removed_Test.mp4'),
      recoveryMode: 'fresh',
      reusedExisting: false,
      warnings: [],
      visualBoundaryTransitions: [],
      timeline: { txt: null, itemCount: inputs.length, totalDuration: 10, rows: [] }
    })
  );
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
    { run: downloaderRun } as never,
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

describe('#12 — SOURCE_REMOVED chỉ bỏ qua clip của nguồn bị xóa, vẫn ghép các video hợp lệ còn lại', () => {
  it('khi 1 trong 2 video bị SOURCE_REMOVED, chỉ skip download + clip của mục đó và vẫn ghép mục hợp lệ còn lại kèm cảnh báo', async () => {
    const project = makeProject();
    const validFile = join(project.sourceFolder, 'Video_2.mp4');
    writeVideo(validFile);

    const removedItem = addItem(project, 1, 'dQw4w9WgXc1', null, { start: 0, end: 5 });
    addItem(project, 2, 'dQw4w9WgXc2', validFile);

    const jobs = manager.enqueueProject(project.id);
    const dl1 = jobs.find((j) => j.type === 'download' && j.sourceId === removedItem.sourceId)!;
    const clip1 = jobs.find((j) => j.type === 'clip' && j.itemId === removedItem.itemId)!;
    const dl2 = jobs.find((j) => j.type === 'download' && j.sourceId !== removedItem.sourceId)!;
    const mergeJob = jobs.find((j) => j.type === 'merge')!;

    downloaderRun.mockRejectedValueOnce(new SourceRemovedError());
    await execute(dl1);

    expect(queue.get(dl1.id)?.status).toBe('skipped');
    expect(queue.get(clip1.id)?.status).toBe('skipped');
    expect(queue.get(clip1.id)?.input.sourceRemovedDependency).toBe(true);
    // Merge job KHÔNG được bị skip vì vẫn còn video 2 hợp lệ!
    expect(queue.get(mergeJob.id)?.status).toBe('pending');

    // Video 2 tải xong
    downloaderRun.mockImplementationOnce(
      (
        _job: QueueJob,
        _profile: ResourceProfile,
        _signal: AbortSignal,
        onProgress: (p: { percent: number; speed: string | null; etaSeconds: number | null; stage: 'downloading' }) => void
      ) => {
        onProgress({ percent: 50, speed: null, etaSeconds: null, stage: 'downloading' });
        return Promise.resolve({
          outputPath: validFile,
          skipped: false,
          resultMessage: 'Đã tải xong.'
        });
      }
    );
    await execute(dl2);
    expect(queue.get(dl2.id)?.status).toBe('completed');

    // Chạy merge → chỉ ghép Video_2, không fail và không requeue Video_1
    await execute(queue.get(mergeJob.id)!);

    expect(merge).toHaveBeenCalledTimes(1);
    const passedInputs = merge.mock.calls[0]![1] as Array<{ path: string; label: string }>;
    expect(passedInputs).toHaveLength(1);
    expect(passedInputs[0]!.path).toBe(validFile);

    const finishedMerge = queue.get(mergeJob.id)!;
    expect(finishedMerge.status).toBe('completed');
    const resultMessage =
      typeof finishedMerge.input.resultMessage === 'string' ? finishedMerge.input.resultMessage : '';
    expect(resultMessage).toMatch(/bỏ qua|bị xóa/i);
    expect(Array.isArray(finishedMerge.input.mergeWarnings)).toBe(true);
    expect((finishedMerge.input.mergeWarnings as string[]).some((w) => /bị xóa|bỏ qua/i.test(w))).toBe(true);
  });

  it('khi TẤT CẢ video trong dự án ghép đều bị SOURCE_REMOVED thì mới bỏ qua tác vụ ghép', async () => {
    const project = makeProject();
    const onlyItem = addItem(project, 1, 'dQw4w9WgXc9', null);
    const jobs = manager.enqueueProject(project.id);
    const dl1 = jobs.find((j) => j.type === 'download' && j.sourceId === onlyItem.sourceId)!;
    const mergeJob = jobs.find((j) => j.type === 'merge')!;

    downloaderRun.mockRejectedValueOnce(new SourceRemovedError());
    await execute(dl1);

    expect(queue.get(dl1.id)?.status).toBe('skipped');
    expect(queue.get(mergeJob.id)?.status).toBe('skipped');
    expect(queue.get(mergeJob.id)?.input.sourceRemovedDependency).toBe(true);
  });
});
