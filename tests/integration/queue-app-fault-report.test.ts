import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAppFaultMessage } from '@shared/utils/user-action-message.js';
import { jobFriendlyIssue } from '@shared/utils/ui-error.js';
import type { QueueJob } from '@shared/types/domain.js';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

/**
 * 1.8.0: tác vụ sập vì lỗi của ứng dụng (lưới an toàn handleExecutorCrash) → tự lưu báo cáo lỗi, câu lỗi của tác vụ nói rõ
 * "Lỗi của ứng dụng" (không đổ cho người dùng), chi tiết kỹ thuật giữ ở phần Chi tiết.
 */
let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe('QueueManager — tác vụ sập vì lỗi của ứng dụng', () => {
  it('tự lưu báo cáo + câu lỗi dạng "Lỗi của ứng dụng"', () => {
    harness = createQueueHarness();
    const report = vi.fn();
    harness.manager.setAppFaultReporter(report);
    const job = harness.jobIn('downloading');
    const crash = new TypeError("Cannot read properties of undefined (reading 'sourceFolder')");
    (harness.manager as unknown as { handleExecutorCrash(job: QueueJob, error: unknown): void }).handleExecutorCrash(job, crash);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toMatchObject({
      source: 'queue-executor',
      error: crash,
      jobId: job.id,
      projectId: harness.project.id
    });
    const saved = harness.queue.get(job.id)!;
    expect(saved.status).toBe('failed');
    expect(saved.errorCode).toBe('UNHANDLED_ERROR');
    expect(parseAppFaultMessage(saved.errorMessage ?? '')?.technical).toContain("reading 'sourceFolder'");
    const issue = jobFriendlyIssue(saved);
    expect(issue.kind).toBe('app-fault');
    expect(issue.message).not.toContain('sourceFolder');
  });

  it('không có bộ lưu báo cáo (bài kiểm cũ / công cụ khác) vẫn chạy như trước', () => {
    harness = createQueueHarness();
    const job = harness.jobIn('downloading');
    (harness.manager as unknown as { handleExecutorCrash(job: QueueJob, error: unknown): void }).handleExecutorCrash(job, new Error('x'));
    expect(harness.queue.get(job.id)!.errorCode).toBe('UNHANDLED_ERROR');
  });
});
