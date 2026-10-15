import { describe, expect, it } from 'vitest';
import {
  planForListCount,
  recommendConcurrentListsForHardware,
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
  // Ô "Tự động theo máy (N)" ở Cài đặt hiện recommendedConcurrentLists của bảng này — phải trùng số hàng đợi thật sự dùng.
  it('số danh sách khuyến nghị trùng mức tự động của hàng đợi ở mọi cấu hình', () => {
    for (const [cores, ram] of [[2, 4], [4, 8], [8, 16], [12, 24], [16, 32], [24, 48], [36, 102], [72, 128], [72, 12]] as const) {
      const profile = hardware(cores, ram);
      expect(recommendDownloadConcurrency(profile).recommendedConcurrentLists, `${cores} lõi / ${ram} GB`).toBe(
        recommendConcurrentListsForHardware(profile)
      );
    }
  });

  it('keeps low-end machines conservative', () => {
    expect(recommendDownloadConcurrency(hardware(8, 16))).toMatchObject({
      recommendedConcurrentLists: 2,
      recommendedPerListWorkers: 1,
      recommendedGlobalWorkers: 2,
      recommendedConcurrentFragments: 1
    });
  });

  it('recommends two active lists for a strong workstation', () => {
    const recommendation = recommendDownloadConcurrency(hardware(72, 128));
    expect(recommendation).toMatchObject({
      recommendedConcurrentLists: 6,
      recommendedPerListWorkers: 2,
      recommendedSingleListWorkers: 4,
      recommendedGlobalWorkers: 4,
      maximumSafeGlobalWorkers: 8,
      recommendedConcurrentFragments: 2
    });
    // A1 (2026-09-25): tăng từ 4 lên 6 quy trình song song — bảng đề xuất theo phần cứng phải phủ đủ
    // 6 mức (1..6), không còn dừng ở 4.
    expect(recommendation.plans).toHaveLength(6);
    expect(recommendation.plans.map((item) => item.listCount)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reduces global concurrency when whole-file verification is enabled', () => {
    const recommendation = recommendDownloadConcurrency(hardware(72, 128));
    expect(planForListCount(recommendation, 4, true)).toMatchObject({
      listCount: 4,
      workersPerList: 1,
      globalWorkers: 2
    });
  });

  // A1 (2026-09-25): xác nhận thật 2 mức mới (5, 6) có số liệu hợp lý cho cả 4 hồ sơ phần cứng, không
  // chỉ đúng số lượng phần tử — mỗi mức phải có ghi chú riêng (không rỗng) và workersPerList hợp lý (≥1).
  it.each([
    [hardware(4, 8), 'máy yếu'],
    [hardware(12, 24), 'máy phổ thông'],
    [hardware(20, 40), 'máy khá'],
    [hardware(72, 128), 'workstation mạnh']
  ])('có đủ đề xuất hợp lý cho quy trình thứ 5 và 6 (%s)', (profile) => {
    const recommendation = recommendDownloadConcurrency(profile);
    for (const listCount of [5, 6] as const) {
      const plan = planForListCount(recommendation, listCount, false);
      expect(plan.listCount).toBe(listCount);
      expect(plan.workersPerList).toBeGreaterThanOrEqual(1);
      expect(plan.globalWorkers).toBeGreaterThanOrEqual(1);
      expect(plan.note.length).toBeGreaterThan(0);
    }
  });
});
