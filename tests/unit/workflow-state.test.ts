import { describe, expect, it } from 'vitest';
import { resolveWorkflowState } from '@shared/utils/job-state-machine.js';

describe('#12 — resolveWorkflowState không báo nhầm completed khi mọi tác vụ đều cancelled', () => {
  it('trả idle khi tất cả tác vụ bị hủy (cancelled)', () => {
    expect(resolveWorkflowState([{ status: 'cancelled' }, { status: 'cancelled' }])).toBe('idle');
  });

  it('trả completed khi có tác vụ completed/skipped và không còn tác vụ hoạt động/lỗi/tạm dừng', () => {
    expect(resolveWorkflowState([{ status: 'completed' }, { status: 'skipped' }])).toBe('completed');
    expect(resolveWorkflowState([{ status: 'completed' }, { status: 'cancelled' }])).toBe('completed');
  });

  it('ưu tiên running > paused > failed > completed > idle', () => {
    expect(resolveWorkflowState([{ status: 'downloading' }, { status: 'failed' }])).toBe('running');
    expect(resolveWorkflowState([{ status: 'paused' }, { status: 'failed' }])).toBe('paused');
    expect(resolveWorkflowState([{ status: 'failed' }, { status: 'completed' }])).toBe('failed');
    expect(resolveWorkflowState([])).toBe('idle');
  });
});
