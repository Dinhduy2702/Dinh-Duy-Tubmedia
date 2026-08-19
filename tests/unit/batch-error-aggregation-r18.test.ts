import { beforeEach, describe, expect, it } from 'vitest';
import {
  coalesceBatchJobFailureAttention,
  resetBatchErrorNotificationAggregatorForTests
} from '../../src/shared/batch-error-notification-aggregator.js';

function failure(projectId: string, jobId: string, code = 'DOWNLOAD_FAILED') {
  return {
    id: `raw-${jobId}`,
    severity: 'error',
    title: 'Video gặp lỗi',
    message: 'Chi tiết kỹ thuật đã nằm trong Nhật ký.',
    projectId,
    jobId,
    code,
    sticky: false
  };
}

describe('R18 R10 central batch attention aggregation', () => {
  beforeEach(() => {
    resetBatchErrorNotificationAggregatorForTests();
  });

  it('passes unrelated notifications through unchanged', () => {
    const notice = {
      id: 'update-1',
      severity: 'info',
      title: 'Có bản cập nhật',
      message: 'Tubmedia mới đã sẵn sàng.',
      code: 'APP_UPDATE_AVAILABLE'
    };

    expect(coalesceBatchJobFailureAttention(notice)).toBe(notice);
  });

  it('keeps project blockers out of job aggregation', () => {
    const notice = {
      ...failure('p1', 'j1', 'DISK_FULL'),
      severity: 'warning'
    };

    expect(coalesceBatchJobFailureAttention(notice)).toBe(notice);
  });

  it('uses one stable project id and increments the visible failure count', () => {
    const first = coalesceBatchJobFailureAttention(failure('p1', 'j1'));

    const second = coalesceBatchJobFailureAttention(failure('p1', 'j2'));

    expect(first?.id).toBe('batch-job-failures:p1');
    expect(first?.title).toContain('1 video');

    expect(second?.id).toBe('batch-job-failures:p1');
    expect(second?.title).toContain('2 video');
  });

  it('suppresses a repeated failure from the same job', () => {
    expect(coalesceBatchJobFailureAttention(failure('p1', 'same'))).not.toBeNull();

    expect(coalesceBatchJobFailureAttention(failure('p1', 'same'))).toBeNull();
  });

  it('keeps different projects independent', () => {
    const one = coalesceBatchJobFailureAttention(failure('p1', 'j1'));

    const two = coalesceBatchJobFailureAttention(failure('p2', 'j2'));

    expect(one?.id).toBe('batch-job-failures:p1');
    expect(two?.id).toBe('batch-job-failures:p2');
  });

  it('can aggregate a final error-severity job notice even without a code', () => {
    const notice = {
      id: 'raw',
      severity: 'error',
      title: 'Lỗi',
      message: 'Lỗi cuối cùng.',
      projectId: 'p1',
      jobId: 'j1'
    };

    expect(coalesceBatchJobFailureAttention(notice)?.id).toBe('batch-job-failures:p1');
  });
});
