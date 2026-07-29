import { describe, expect, it } from 'vitest';
import type { QueueJob } from '../../src/shared/types/domain.js';
import {
  mergeSourceDownloadLimit,
  queueExecutionLane
} from '../../src/shared/utils/queue-lane.js';

function job(type: QueueJob['type'], workflow?: string): Pick<QueueJob, 'type' | 'input'> {
  return { type, input: workflow ? { workflow } : {} };
}

describe('independent queue execution lanes', () => {
  it('keeps list downloads separate from merge source downloads', () => {
    expect(queueExecutionLane(job('download', 'download-only'))).toBe('download-list');
    expect(queueExecutionLane(job('download', 'download-merge'))).toBe('merge-workflow');
    expect(queueExecutionLane(job('clip'))).toBe('merge-workflow');
    expect(queueExecutionLane(job('merge'))).toBe('merge-workflow');
  });

  it('gives active merge workflows their own parallel source-download capacity', () => {
    expect(mergeSourceDownloadLimit({ maxGlobalMergeJobs: 1 }, { downloadWorkers: 2 })).toBe(2);
    expect(mergeSourceDownloadLimit({ maxGlobalMergeJobs: 2 }, { downloadWorkers: 2 })).toBe(4);
  });
});
