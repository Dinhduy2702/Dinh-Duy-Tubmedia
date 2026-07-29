import { describe, expect, it } from 'vitest';
import {
  planForListCount,
  recommendDownloadConcurrency
} from '../../src/shared/utils/hardware-recommendation.js';
import type { HardwareProfile } from '../../src/shared/types/domain.js';

function hardware(logicalCpuCount: number, ramGb: number): HardwareProfile {
  return {
    platform: 'win32',
    release: 'test',
    architecture: 'x64',
    hostname: 'test',
    physicalCpuCount: Math.max(1, Math.floor(logicalCpuCount / 2)),
    logicalCpuCount,
    cpuModel: 'Test CPU',
    totalMemoryBytes: ramGb * 1024 ** 3,
    freeMemoryBytes: Math.floor(ramGb * 0.8) * 1024 ** 3,
    gpuAdapters: [],
    disks: [],
    detectedAt: new Date(0).toISOString()
  };
}

describe('recommendDownloadConcurrency', () => {
  it('keeps low-end machines conservative', () => {
    expect(recommendDownloadConcurrency(hardware(8, 16))).toMatchObject({
      recommendedConcurrentLists: 1,
      recommendedPerListWorkers: 1,
      recommendedGlobalWorkers: 2,
      recommendedConcurrentFragments: 1
    });
  });

  it('recommends two active lists for a strong workstation', () => {
    const recommendation = recommendDownloadConcurrency(hardware(72, 128));
    expect(recommendation).toMatchObject({
      recommendedConcurrentLists: 2,
      recommendedPerListWorkers: 2,
      recommendedSingleListWorkers: 4,
      recommendedGlobalWorkers: 4,
      maximumSafeGlobalWorkers: 8,
      recommendedConcurrentFragments: 2
    });
    expect(recommendation.plans).toHaveLength(4);
  });

  it('reduces global concurrency when whole-file verification is enabled', () => {
    const recommendation = recommendDownloadConcurrency(hardware(72, 128));
    expect(planForListCount(recommendation, 4, true)).toMatchObject({
      listCount: 4,
      workersPerList: 1,
      globalWorkers: 2
    });
  });
});
