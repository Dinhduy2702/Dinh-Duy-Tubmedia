import { describe, expect, it } from 'vitest';
import {
  independentDownloadProjectCanStart,
  mergeSourceDownloadLimit,
  queueExecutionLane
} from '../../src/shared/utils/queue-lane.js';

describe('independent queue execution lanes', () => {
  it('keeps normal list downloads separate from merge source downloads', () => {
    expect(queueExecutionLane({ type: 'download', input: {} })).toBe('download-list');
    expect(queueExecutionLane({ type: 'download', input: { workflow: 'download-merge' } })).toBe(
      'merge-workflow'
    );
    expect(queueExecutionLane({ type: 'normalize', input: {} })).toBe('merge-workflow');
  });

  it('lets every download list start from its own project worker budget', () => {
    expect(independentDownloadProjectCanStart(0, { downloadWorkers: 2 })).toBe(true);
    expect(independentDownloadProjectCanStart(1, { downloadWorkers: 2 })).toBe(true);
    expect(independentDownloadProjectCanStart(2, { downloadWorkers: 2 })).toBe(false);
  });

  it('does not make list three wait for active work in list one or list two', () => {
    const activeInOtherProjects = 8;
    expect(activeInOtherProjects).toBeGreaterThan(0);
    expect(independentDownloadProjectCanStart(0, { downloadWorkers: 2 })).toBe(true);
  });

  it('gives active merge workflows their own parallel source-download capacity', () => {
    expect(mergeSourceDownloadLimit({ maxGlobalMergeJobs: 1 }, { downloadWorkers: 2 })).toBe(2);
    expect(mergeSourceDownloadLimit({ maxGlobalMergeJobs: 2 }, { downloadWorkers: 2 })).toBe(4);
  });
});
