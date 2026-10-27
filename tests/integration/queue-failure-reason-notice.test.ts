import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import { DownloadFailedError } from '@shared/errors/app-errors.js';
import type { AttentionNotice, QueueJob, ResourceProfile } from '@shared/types/domain.js';

// 2026-10-27 (người dùng yêu cầu): thông báo lỗi nêu nguyên nhân ngay, đúng tên nền tảng gốc. Chạy QueueManager.execute()
// thật trên CSDL thật; bộ tải giả ném đúng lỗi bộ tải thật ném khi video không còn trên nền tảng.

type ExecuteAccess = { execute: (job: QueueJob, profile: ResourceProfile, signal: AbortSignal) => Promise<void> };

let folder = '';
let database: AppDatabase;
let projects: ProjectRepository;
let queue: QueueRepository;
let manager: QueueManager;
let notices: AttentionNotice[];
let failure: Error;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-failure-reason-'));
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  queue = new QueueRepository(database.db);
  notices = [];
  manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    { get: () => defaultAppSettings, profiles: () => ({ qualities: builtInQualityProfiles, resources: builtInResourceProfiles }) } as never,
    { run: vi.fn(() => Promise.reject(failure)) } as never,
    {} as never,
    {} as never,
    {} as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never
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

const run = async (url: string): Promise<AttentionNotice | undefined> => {
  const project = projects.create({
    name: 'Danh sách tải 3',
    sourceFolder: join(folder, 'nguon'),
    tempFolder: join(folder, 'tam'),
    outputFolder: join(folder, 'tp'),
    finalFileName: 'x',
    qualityProfileId: builtInQualityProfiles[0]!.id,
    resourceProfileId: builtInResourceProfiles[0]!.id
  });
  const job = queue.create({ projectId: project.id, type: 'download', input: { url } });
  await (manager as unknown as ExecuteAccess).execute.call(manager, job, builtInResourceProfiles[0]!, new AbortController().signal);
  return notices.find((notice) => notice.jobId === job.id && notice.reason);
};

describe('thông báo lỗi tác vụ mang nguyên nhân', () => {
  it('video Facebook không còn → "Video đã bị xoá khỏi Facebook"', async () => {
    failure = new DownloadFailedError('Video không khả dụng.', false, {
      failureSubtype: 'unavailable',
      technicalSummary: "ERROR: [facebook] 123: This content isn't available right now"
    });
    expect((await run('https://www.facebook.com/watch/?v=1589967605531745'))?.reason).toBe('Video đã bị xoá khỏi Facebook');
  });

  it('video YouTube riêng tư → "Video ở chế độ riêng tư trên YouTube"', async () => {
    failure = new DownloadFailedError('Video không khả dụng.', false, {
      failureSubtype: 'unavailable',
      technicalSummary: 'ERROR: [youtube] BAydFXOIuvo: Video unavailable. This video is private'
    });
    expect((await run('https://www.youtube.com/watch?v=BAydFXOIuvo'))?.reason).toBe('Video ở chế độ riêng tư trên YouTube');
  });
});
