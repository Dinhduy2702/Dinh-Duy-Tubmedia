import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

type ManagerInternals = {
  rateLimits: {
    recordHit: (platform: string, startedAtMs: number, now: number) => unknown;
    isStopped: (platform: string) => boolean;
    hasAny: () => boolean;
  };
  repeatedFailures: Map<string, number[]>;
  diskSpaceStateForJobs: (jobs: unknown[]) => Promise<{
    ready: boolean;
    folder: string | null;
    freeBytes: number;
    requiredBytes: number;
  }>;
};

let harness: QueueHarness;

const internals = (): ManagerInternals => harness.manager as unknown as ManagerInternals;

beforeEach(() => {
  harness = createQueueHarness();
});

afterEach(() => {
  harness.cleanup();
});

describe('#14 — resume(jobId) và retry(jobId) tự mở khóa và khôi phục trạng thái liên quan', () => {
  it('resume(jobId) tự mở khóa rateLimits của nền tảng liên quan', async () => {
    const job = harness.jobIn('paused', {
      errorCode: 'SOURCE_RATE_LIMITED',
      errorMessage: 'YouTube giới hạn tạm thời.',
      input: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    });
    const now = Date.now();
    // Đẩy nền tảng youtube vào trạng thái cooldown / stopped
    internals().rateLimits.recordHit('youtube', now, now);
    expect(harness.manager.rateLimitWaits().some((item) => item.platform === 'youtube')).toBe(true);

    await harness.manager.resume(job.id);

    expect(harness.queue.get(job.id)?.status).toBe('pending');
    expect(harness.manager.rateLimitWaits().some((item) => item.platform === 'youtube')).toBe(false);
  });

  it('resume(jobId) từ chối tiếp tục khi tác vụ đang bị DISK_FULL mà ổ đĩa vẫn chưa đủ dung lượng', async () => {
    const job = harness.jobIn('paused', {
      errorCode: 'DISK_FULL',
      errorMessage: 'Ổ đĩa đầy.'
    });
    internals().diskSpaceStateForJobs = vi.fn(() =>
      Promise.resolve({
        ready: false,
        folder: harness.project.sourceFolder,
        freeBytes: 200 * 1024 * 1024,
        requiredBytes: 3 * 1024 * 1024 * 1024
      })
    );

    await expect(harness.manager.resume(job.id)).rejects.toThrow(/chưa đủ dung lượng/i);
    expect(harness.queue.get(job.id)?.status).toBe('paused');
  });

  it('retry(jobId) tự khôi phục job con DEPENDENCY_FAILED, xóa repeatedFailures và đặt dự án về active', () => {
    const dl = harness.jobIn('failed', {
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'Mạng chập chờn.'
    });
    const clip = harness.queue.create({
      projectId: harness.project.id,
      type: 'clip',
      input: { dependsOn: [dl.id] }
    });
    harness.queue.update(clip.id, {
      status: 'failed',
      errorCode: 'DEPENDENCY_FAILED',
      errorMessage: 'Tác vụ phụ thuộc thất bại.'
    });
    const merge = harness.queue.create({
      projectId: harness.project.id,
      type: 'merge',
      input: { dependsOn: [clip.id] }
    });
    harness.queue.update(merge.id, {
      status: 'failed',
      errorCode: 'DEPENDENCY_FAILED',
      errorMessage: 'Tác vụ phụ thuộc thất bại.'
    });

    internals().repeatedFailures.set(harness.project.id, [Date.now(), Date.now()]);
    harness.projects.setStatus(harness.project.id, 'error');

    harness.manager.retry(dl.id);

    expect(harness.queue.get(dl.id)?.status).toBe('pending');
    expect(harness.queue.get(clip.id)?.status).toBe('pending');
    expect(harness.queue.get(clip.id)?.errorCode).toBeNull();
    expect(harness.queue.get(merge.id)?.status).toBe('pending');
    expect(harness.queue.get(merge.id)?.errorCode).toBeNull();
    expect(internals().repeatedFailures.has(harness.project.id)).toBe(false);
    expect(harness.projects.get(harness.project.id)?.status).toBe('active');
  });
});
