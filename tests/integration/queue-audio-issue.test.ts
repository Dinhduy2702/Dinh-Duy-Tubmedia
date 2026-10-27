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
import type { AttentionNotice, Project, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// P1 (2026-10-10): video tải về không có tiếng hoặc im lặng (do nguồn) phải được báo RÕ cho người dùng: lưu trên tác vụ
// (huy hiệu), một thông báo gộp theo danh sách, và với quy trình ghép thì liệt kê các đoạn không có tiếng trước khi ghép
// và ghi trong kết quả thành phẩm. Chạy QueueManager.execute() thật trên CSDL thật; chỉ giả lập bộ tải và bộ ghép.

type ExecuteAccess = { execute: (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void> };

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let queue: QueueRepository;
let manager: QueueManager;
let downloaderResult: Record<string, unknown>;
let notices: AttentionNotice[];
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

const resource = builtInResourceProfiles[0]!;
const execute = (job: QueueJob): Promise<void> =>
  (manager as unknown as ExecuteAccess).execute.call(manager, job, resource, new AbortController().signal);

const makeProject = (name: string): Project =>
  projects.create({
    name,
    sourceFolder: join(folder, name, 'nguon'),
    tempFolder: join(folder, name, 'tam'),
    outputFolder: join(folder, name, 'thanh-pham'),
    finalFileName: name,
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: resource.id
  });

const addItem = (project: Project, position: number, title: string): { sourceId: string; file: string } => {
  const sourceId = randomUUID();
  const url = `https://www.youtube.com/watch?v=VIDEO${position}`;
  const file = join(project.sourceFolder, `${title} [VIDEO${position}].mp4`);
  mkdirSync(project.sourceFolder, { recursive: true });
  writeFileSync(file, Buffer.alloc(2048, 3));
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
       VALUES(?,?,?,?,'youtube','youtube',?,?,NULL,?,'merge-best-source-multiplatform-v7','valid',NULL,?,?)`
    )
    .run(sourceId, `youtube:youtube:VIDEO${position}::project:${project.id}`, url, url, `VIDEO${position}`, title, file, now, now);
  database.db
    .prepare(
      `INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
       VALUES(?,?,NULL,?,?,?,?,'youtube','youtube',?,?,NULL,NULL,'','default','valid','[]','[]',NULL,1,?,?)`
    )
    .run(randomUUID(), project.id, position, url, url, url, `VIDEO${position}`, sourceId, now, now);
  return { sourceId, file };
};

const downloadJob = (project: Project, sourceId: string | null = null): QueueJob =>
  queue.create({ projectId: project.id, type: 'download', sourceId, input: { url: 'https://www.youtube.com/watch?v=Q7bzbdvwgBU' } });

const finishedDownload = (project: Project, sourceId: string, input: Record<string, unknown>): QueueJob => {
  const job = queue.create({ projectId: project.id, type: 'download', sourceId, input: { workflow: 'download-merge', ...input } });
  queue.update(job.id, { status: 'downloading' });
  return queue.update(job.id, { status: 'completed' });
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-queue-audio-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  notices = [];
  downloaderResult = { outputPath: join(folder, 'video.mp4'), skipped: false, resultMessage: 'Đã tải và kiểm tra hoàn tất.' };
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const settings = {
    get: () => defaultAppSettings,
    profiles: () => ({ qualities: builtInQualityProfiles, resources: builtInResourceProfiles })
  };
  const merge = vi.fn((_job: QueueJob, inputs: unknown[], outputFolder: string) =>
    Promise.resolve({
      video: join(outputFolder, 'thanh-pham.mp4'),
      recoveryMode: 'fresh',
      reusedExisting: false,
      warnings: [],
      visualBoundaryTransitions: [],
      timeline: { txt: null, itemCount: inputs.length, totalDuration: 0, rows: [] }
    })
  );
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    settings as never,
    {
      // Bộ tải giả báo tiến độ như bộ tải thật (analyzing → downloading) rồi trả kết quả.
      run: vi.fn((_job: QueueJob, _profile: unknown, _signal: unknown, onProgress: (progress: { percent: number; speed: null; etaSeconds: null; stage: string }) => void) => {
        onProgress({ percent: 50, speed: null, etaSeconds: null, stage: 'downloading' });
        return Promise.resolve(downloaderResult);
      })
    } as never,
    {} as never,
    { merge, createTimelineOnly: vi.fn() } as never,
    {} as never,
    logger as never
  );
  manager.setWindow({
    isDestroyed: () => false,
    webContents: { send: (_channel: string, payload: unknown) => notices.push(payload as AttentionNotice) }
  } as never);
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

const audioNotices = (): AttentionNotice[] => notices.filter((notice) => notice?.code === 'DOWNLOAD_AUDIO_ISSUE');

describe('P1 — hàng đợi lưu và báo rõ video không có tiếng / im lặng', () => {
  // 2026-10-27 (người dùng yêu cầu): bỏ hẳn thông báo bật lên "Có video không có tiếng" — mỗi video lỗi tiếng lại bật thêm
  // một thông báo, dồn dập. Chỉ giữ huy hiệu "Không có tiếng" / "Tiếng im lặng" trên từng video ở trang Hàng đợi (audioIssue).
  it('tác vụ tải xong mà nguồn im lặng → lưu audioIssue trên tác vụ (cho huy hiệu), KHÔNG bật thông báo', async () => {
    const project = makeProject('Danh sach 1');
    downloaderResult = { ...downloaderResult, audioIssue: 'silent', audioMaxVolumeDb: -91 };
    const first = downloadJob(project);
    const second = downloadJob(project);

    await execute(first);
    downloaderResult = { ...downloaderResult, audioIssue: 'missing', audioMaxVolumeDb: undefined };
    await execute(second);

    expect(queue.get(first.id)?.errorMessage ?? null).toBeNull();
    expect(queue.get(first.id)).toMatchObject({ status: 'completed', input: { audioIssue: 'silent', audioMaxVolumeDb: -91 } });
    expect(queue.get(second.id)?.input.audioIssue).toBe('missing');
    expect(audioNotices(), 'không bật thông báo nào cho video không có tiếng').toEqual([]);
  });

  it('đối chứng: tiếng bình thường → không lưu audioIssue, không thông báo', async () => {
    const project = makeProject('Danh sach 2');
    const job = downloadJob(project);

    await execute(job);

    expect(queue.get(job.id)?.status).toBe('completed');
    expect(queue.get(job.id)?.input.audioIssue ?? null).toBeNull();
    expect(audioNotices()).toEqual([]);
  });

  it('tải lại cùng tác vụ mà lần này có tiếng → xóa audioIssue cũ', async () => {
    const project = makeProject('Danh sach 3');
    const job = queue.create({ projectId: project.id, type: 'download', input: { url: 'https://www.youtube.com/watch?v=Q7bzbdvwgBU', audioIssue: 'silent' } });

    await execute(job);

    expect(queue.get(job.id)?.status).toBe('completed');
    expect(queue.get(job.id)?.input.audioIssue ?? null).toBeNull();
  });
});

// 2026-10-27 (rà soát trước 1.7.3, người dùng duyệt): "Đã giữ bản cũ" từng bật lại sau MỖI video tải lại — cùng kiểu dồn dập
// với thông báo "không có tiếng". Giờ một danh sách chỉ bật MỘT lần cho cả đợt; các video sau chỉ ghi nhật ký.
describe('"Đã giữ bản cũ" không bật lại sau mỗi video', () => {
  it('5 video cùng danh sách giữ bản cũ → 1 thông báo; mỗi video vẫn ghi nhật ký', async () => {
    const project = makeProject('Giu ban cu');
    for (let index = 0; index < 5; index += 1) {
      downloaderResult = {
        ...downloaderResult,
        keptOldVersions: [{ path: join(folder, 'quarantine', `cu-${index}.mp4`), bytes: 1000 }]
      };
      await execute(downloadJob(project));
    }
    const kept = notices.filter((notice) => notice?.code === 'SOURCE_OLD_VERSION_KEPT');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.message).toContain('Dọn dẹp máy');
    expect(logger.info.mock.calls.filter((call) => call[1] === 'SOURCE_OLD_VERSION_KEPT')).toHaveLength(5);
  });

  it('hai danh sách khác nhau → mỗi danh sách một thông báo', async () => {
    for (const name of ['Giu A', 'Giu B']) {
      const project = makeProject(name);
      downloaderResult = { ...downloaderResult, keptOldVersions: [{ path: join(folder, 'q', `${name}.mp4`), bytes: 1 }] };
      await execute(downloadJob(project));
      await execute(downloadJob(project));
    }
    expect(notices.filter((notice) => notice?.code === 'SOURCE_OLD_VERSION_KEPT')).toHaveLength(2);
  });
});

describe('P1 — quy trình ghép liệt kê đoạn không có tiếng trước khi ghép và ghi trong kết quả', () => {
  it('nguồn vị trí 2 im lặng, vị trí 3 không có tiếng → cảnh báo trước khi ghép + kết quả ghi rõ từng vị trí', async () => {
    const project = makeProject('Ghep 1');
    const one = addItem(project, 1, 'Lions Fighting');
    const two = addItem(project, 2, 'hippo roar');
    const three = addItem(project, 3, 'Clip khong tieng');
    const deps = [
      finishedDownload(project, one.sourceId, {}),
      finishedDownload(project, two.sourceId, { audioIssue: 'silent' }),
      finishedDownload(project, three.sourceId, { audioIssue: 'missing' })
    ];
    const merge = queue.create({
      projectId: project.id,
      type: 'merge',
      input: { dependsOn: deps.map((job) => job.id), productName: project.finalFileName, timelineOnly: false },
      priority: 10,
      maxAttempts: 1
    });

    await execute(merge);

    const done = queue.get(merge.id)!;
    expect(done.status).toBe('completed');
    expect(done.input.mergeAudioIssues).toEqual([
      { position: 2, title: 'hippo roar', issue: 'silent' },
      { position: 3, title: 'Clip khong tieng', issue: 'missing' }
    ]);
    expect(String(done.input.resultMessage)).toContain('vị trí 2');
    expect(String(done.input.resultMessage)).toContain('vị trí 3');
    expect(logger.warn.mock.calls.map((call) => String(call[1]))).toContain('MERGE_SOURCE_AUDIO_ISSUES');
    const notice = notices.find((item) => item?.code === 'MERGE_SOURCE_AUDIO_ISSUES');
    expect(notice).toMatchObject({ severity: 'warning', projectId: project.id });
    expect(notice?.message).toContain('hippo roar');
    expect(notice?.message).toContain('vị trí 3');
  });

  it('đối chứng: mọi nguồn có tiếng → không cảnh báo, kết quả không nhắc tới tiếng', async () => {
    const project = makeProject('Ghep 2');
    const one = addItem(project, 1, 'A');
    const deps = [finishedDownload(project, one.sourceId, {})];
    const merge = queue.create({
      projectId: project.id,
      type: 'merge',
      input: { dependsOn: deps.map((job) => job.id), productName: project.finalFileName, timelineOnly: false },
      priority: 10,
      maxAttempts: 1
    });

    await execute(merge);

    expect(queue.get(merge.id)?.input.mergeAudioIssues ?? []).toEqual([]);
    expect(notices.find((item) => item?.code === 'MERGE_SOURCE_AUDIO_ISSUES')).toBeUndefined();
  });
});
