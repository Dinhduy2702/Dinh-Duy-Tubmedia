import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('groups recoverable network warnings without presenting them as errors', () => {
    const warning = (jobId: string) => ({
      ...failure('p1', jobId, 'HTTP_ERROR'),
      severity: 'warning'
    });

    const first = coalesceBatchJobFailureAttention(warning('j1'));
    const second = coalesceBatchJobFailureAttention(warning('j2'));

    expect(first?.severity).toBe('warning');
    expect(first?.title).toContain('chưa tải được');
    expect(second?.id).toBe('batch-job-failures:p1');
    expect(second?.title).toContain('2 video');
    expect(second?.message).toContain('.part');
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

// Khám phá bản cài 1.5.0 (2026-10-05) #10: Trung tâm thông báo ghi "Có 1 video gặp lỗi trong danh sách này" —
// thông báo nằm chung một chỗ với mọi danh sách nên "danh sách này" không cho biết là danh sách nào.
describe('#10 — thông báo gom lỗi nêu đúng tên danh sách', () => {
  beforeEach(() => {
    resetBatchErrorNotificationAggregatorForTests();
  });

  it('có tên danh sách → nêu tên trong tiêu đề', () => {
    const first = coalesceBatchJobFailureAttention(failure('project-2', 'job-1'), 'Danh sách tải 2');
    expect(first?.title).toBe('Có 1 video gặp lỗi trong "Danh sách tải 2"');
    const second = coalesceBatchJobFailureAttention(failure('project-2', 'job-2'), 'Danh sách tải 2');
    expect(second?.title).toBe('Có 2 video gặp lỗi trong "Danh sách tải 2"');
  });

  it('cảnh báo phục hồi cũng nêu tên', () => {
    const notice = coalesceBatchJobFailureAttention({ ...failure('project-3', 'job-9', 'SOURCE_TEMPORARY'), severity: 'warning' }, 'Kênh A');
    expect(notice?.title).toBe('Có 1 video trong "Kênh A" chưa tải được sau khi tự thử lại');
  });

  it('không có tên → không còn câu "danh sách này"', () => {
    const notice = coalesceBatchJobFailureAttention(failure('project-4', 'job-1'));
    expect(notice?.title).toBe('Có 1 video gặp lỗi trong một danh sách tải');
  });

  it('nơi nhận sự kiện tra tên danh sách theo projectId rồi truyền vào', () => {
    const source = readFileSync('src/renderer/src/hooks/use-desktop-events.ts', 'utf8');
    expect(source).toMatch(/coalesceBatchJobFailureAttention\(\s*notice,\s*\w+/);
  });

  it('thông báo bắt đầu / tạm dừng / tiếp tục / hủy ở trang Tải danh sách dùng tên thật, không dùng số ô', () => {
    const source = readFileSync('src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'utf8');
    expect(source).not.toContain('`Danh sách ${laneNumber(slot)} đã bắt đầu`');
    expect(source).not.toContain('`Danh sách ${laneNumber(slot)} ${label}`');
  });
});
