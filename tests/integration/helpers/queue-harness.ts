import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';
import type { AppSettings, JobStatus, Project, QueueJob } from '@shared/types/domain.js';

export interface QueueHarness {
  folder: string;
  database: AppDatabase;
  queue: QueueRepository;
  projects: ProjectRepository;
  project: Project;
  manager: QueueManager;
  settings: AppSettings;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  downloader: { run: ReturnType<typeof vi.fn> };
  /** Tạo QueueManager mới trên CÙNG CSDL — mô phỏng một lần mở ứng dụng mới. */
  relaunch: () => QueueManager;
  /** Tạo tác vụ tải và đưa nó tới đúng trạng thái mong muốn qua các bước chuyển hợp lệ. */
  jobIn: (status: JobStatus, extra?: { errorCode?: string; errorMessage?: string; input?: Record<string, unknown> }) => QueueJob;
  cleanup: () => void;
}

const PATHS: Partial<Record<JobStatus, JobStatus[]>> = {
  pending: [],
  analyzing: ['analyzing'],
  downloading: ['downloading'],
  downloaded: ['downloading', 'downloaded'],
  verifying: ['verifying'],
  normalizing: ['normalizing'],
  processing: ['processing'],
  merging: ['merging'],
  retrying: ['analyzing', 'retrying'],
  interrupted: ['analyzing', 'interrupted'],
  paused: ['paused'],
  failed: ['failed'],
  completed: ['downloading', 'completed']
};

export function createQueueHarness(settingsOverrides: Partial<AppSettings> = {}): QueueHarness {
  const folder = mkdtempSync(join(tmpdir(), 'tubmedia-queue-harness-'));
  const database = new AppDatabase(join(folder, 'db.sqlite'));
  const projects = new ProjectRepository(database.db);
  const queue = new QueueRepository(database.db);
  const project = projects.create({
    name: 'Danh sách thử',
    sourceFolder: join(folder, 'source'),
    tempFolder: join(folder, 'temp'),
    outputFolder: join(folder, 'out'),
    finalFileName: 'thanh-pham',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
  const settings: AppSettings = {
    ...defaultAppSettings,
    cookiesFilePath: '',
    cookiesBrowser: 'none',
    ...settingsOverrides
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const downloader = { run: vi.fn() };
  const settingsService = { get: () => settings, profiles: () => ({ resources: builtInResourceProfiles, qualities: [] }) };
  const build = (): QueueManager =>
    new QueueManager(
      queue,
      projects,
      new ItemRepository(database.db),
      new MediaSourceRepository(database.db),
      settingsService as never,
      downloader as never,
      {} as never,
      {} as never,
      { count: () => 0, pauseByJob: vi.fn(() => Promise.resolve(0)), resumeByJob: vi.fn(() => Promise.resolve()) } as never,
      logger as never
    );
  const harness: QueueHarness = {
    folder,
    database,
    queue,
    projects,
    project,
    manager: build(),
    settings,
    logger,
    downloader,
    relaunch: () => {
      harness.manager = build();
      return harness.manager;
    },
    jobIn: (status, extra = {}) => {
      const job = queue.create({
        projectId: project.id,
        type: 'download',
        input: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', ...(extra.input ?? {}) }
      });
      for (const step of PATHS[status] ?? [status]) queue.update(job.id, { status: step });
      if (extra.errorCode || extra.errorMessage) {
        queue.update(job.id, { errorCode: extra.errorCode ?? null, errorMessage: extra.errorMessage ?? null });
      }
      return queue.get(job.id)!;
    },
    cleanup: () => {
      harness.manager.stop(false).catch(() => undefined);
      database.close();
      rmSync(folder, { recursive: true, force: true });
    }
  };
  return harness;
}
