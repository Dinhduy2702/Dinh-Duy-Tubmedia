import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';

type RequeueAccess = {
  requeueAfterDelay: (
    jobId: string,
    signal: AbortSignal,
    delayMs: number,
    patch: { errorCode?: string | null; errorMessage?: string | null },
    inputPatch: Record<string, unknown>
  ) => Promise<void>;
};

let folder = '';
const openDatabases: AppDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function setup(): { queue: QueueRepository; requeue: RequeueAccess['requeueAfterDelay']; jobId: string } {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-queue-'));
  const database = new AppDatabase(join(folder, 'db.sqlite'));
  openDatabases.push(database);
  const projects = new ProjectRepository(database.db);
  const queue = new QueueRepository(database.db);
  const project = projects.create({
    name: 'Thử lại',
    sourceFolder: join(folder, 'source'),
    tempFolder: join(folder, 'temp'),
    outputFolder: join(folder, 'out'),
    finalFileName: 'thanh-pham',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manager = new QueueManager(
    queue,
    projects,
    new ItemRepository(database.db),
    new MediaSourceRepository(database.db),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never
  );
  const job = queue.create({ projectId: project.id, type: 'download', input: {} });
  queue.update(job.id, { status: 'analyzing' });
  queue.update(job.id, { status: 'retrying' });
  return {
    queue,
    jobId: job.id,
    requeue: (manager as unknown as RequeueAccess).requeueAfterDelay.bind(manager)
  };
}

describe('chờ rồi đưa tác vụ thử lại về hàng đợi', () => {
  it('đưa tác vụ đang retrying về pending sau thời gian chờ', async () => {
    const { queue, requeue, jobId } = setup();
    await requeue(jobId, new AbortController().signal, 5, {}, { resumeStatus: null });
    expect(queue.get(jobId)?.status).toBe('pending');
  });

  it('giữ nguyên trạng thái tạm dừng nếu người dùng bấm Tạm dừng trong lúc chờ', async () => {
    const { queue, requeue, jobId } = setup();
    const waiting = requeue(jobId, new AbortController().signal, 40, {}, { resumeStatus: null });
    queue.update(jobId, { status: 'paused' });
    await waiting;
    expect(queue.get(jobId)?.status).toBe('paused');
  });

  it('hủy ngay khi bị abort và đánh dấu cancelled thay vì kẹt ở retrying', async () => {
    const { queue, requeue, jobId } = setup();
    const controller = new AbortController();
    const startedAt = Date.now();
    const waiting = requeue(jobId, controller.signal, 60_000, {}, { resumeStatus: null });
    controller.abort();
    await waiting;
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(queue.get(jobId)?.status).toBe('cancelled');
  });

  it('không ghi đè trạng thái interrupted khi ứng dụng đóng ở chế độ giữ lại', async () => {
    const { queue, requeue, jobId } = setup();
    const controller = new AbortController();
    const waiting = requeue(jobId, controller.signal, 60_000, {}, { resumeStatus: null });
    queue.update(jobId, { status: 'interrupted' });
    controller.abort();
    await waiting;
    expect(queue.get(jobId)?.status).toBe('interrupted');
  });

  it('chuẩn hóa trạng thái đang chạy (do Tiếp tục sớm) về pending', async () => {
    const { queue, requeue, jobId } = setup();
    // Người dùng Tạm dừng rồi Tiếp tục ngay trong lúc chờ: resume đặt lại một pha "đang chạy".
    queue.update(jobId, { status: 'paused' });
    queue.update(jobId, { status: 'analyzing' });
    await requeue(jobId, new AbortController().signal, 5, {}, { resumeStatus: null });
    expect(queue.get(jobId)?.status).toBe('pending');
  });
});
