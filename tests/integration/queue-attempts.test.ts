import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';
import type { QueueJob } from '@shared/types/domain.js';

type ExecuteAccess = {
  execute: (job: QueueJob, profile: unknown, signal: AbortSignal) => Promise<void>;
  requeueAfterDelay: (...args: unknown[]) => Promise<void>;
};

let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

const transientFailure = (): Error =>
  Object.assign(new Error('Máy chủ tạm thời từ chối (HTTP 503).'), { code: 'SERVER_BUSY', retryable: true });

/** Chạy đúng một lượt execute() rồi đưa tác vụ đang retrying về pending ngay (bỏ thời gian chờ). */
async function runOnce(h: QueueHarness, jobId: string): Promise<QueueJob> {
  const access = h.manager as unknown as ExecuteAccess;
  access.requeueAfterDelay = vi.fn((id: unknown) => {
    const current = h.queue.get(String(id));
    if (current?.status === 'retrying') h.queue.update(String(id), { status: 'pending' });
    return Promise.resolve();
  });
  await access.execute(h.queue.get(jobId)!, {}, new AbortController().signal);
  return h.queue.get(jobId)!;
}

describe('lượt thử', () => {
  it('thất bại 3 lần rồi bấm Thử lại: tác vụ có lại đủ 3 lượt', async () => {
    harness = createQueueHarness();
    harness.downloader.run.mockRejectedValue(transientFailure());
    const job = harness.jobIn('pending');

    expect((await runOnce(harness, job.id)).status).toBe('pending');
    expect((await runOnce(harness, job.id)).status).toBe('pending');
    const exhausted = await runOnce(harness, job.id);
    expect(exhausted.status).toBe('failed');
    expect(exhausted.attempts).toBe(3);

    harness.manager.retry(job.id);
    expect(harness.queue.get(job.id)?.attempts).toBe(0);

    // Sau Thử lại, lỗi tạm thời đầu tiên phải được TỰ THỬ LẠI (không thất bại ngay như 4/3 trước đây).
    const afterRetry = await runOnce(harness, job.id);
    expect(afterRetry.status).toBe('pending');
    expect(afterRetry.attempts).toBe(1);
  });

  it('"Thử lại danh sách" (retryFailed) cũng đặt lại bộ đếm về 0', async () => {
    harness = createQueueHarness();
    harness.downloader.run.mockRejectedValue(transientFailure());
    const job = harness.jobIn('pending');
    for (let index = 0; index < 3; index += 1) await runOnce(harness, job.id);
    expect(harness.queue.get(job.id)?.status).toBe('failed');

    expect(harness.manager.retryFailed(harness.project.id)).toBe(1);
    const reset = harness.queue.get(job.id)!;
    expect(reset.status).toBe('pending');
    expect(reset.attempts).toBe(0);
  });

  it('lần chạy lại chỉ để gắn cookies không bị tính là một lượt', async () => {
    harness = createQueueHarness();
    harness.downloader.run.mockRejectedValueOnce(
      Object.assign(new Error('Cần xác thực'), { code: 'RETRY_WITH_CONFIGURED_COOKIES' })
    );
    const job = harness.jobIn('pending');

    const afterCookieRetry = await runOnce(harness, job.id);

    expect(afterCookieRetry.status).toBe('pending');
    expect(afterCookieRetry.attempts).toBe(0);
  });

  it('lượt thành công không làm tăng bộ đếm lỗi, và nhật ký vẫn ghi đúng số lượt đang chạy', async () => {
    harness = createQueueHarness();
    // Downloader thật đi qua pha downloading trước khi xong; downloader giả phải làm đúng như vậy.
    harness.downloader.run.mockImplementation((job: QueueJob) => {
      harness!.queue.update(job.id, { status: 'downloading' });
      return Promise.resolve({ outputPath: 'x.mp4', skipped: false, resultMessage: 'ok' });
    });
    const job = harness.jobIn('pending');

    const done = await runOnce(harness, job.id);

    expect(done.status, done.errorMessage ?? '').toBe('completed');
    expect(done.attempts).toBe(0);
    const started = harness.logger.info.mock.calls.find((call) => call[1] === 'JOB_STARTED') as
      | [string, string, string, { metadata?: Record<string, unknown> }]
      | undefined;
    expect(started?.[3].metadata).toMatchObject({ attempt: 1, maxAttempts: 3 });
  });
});
