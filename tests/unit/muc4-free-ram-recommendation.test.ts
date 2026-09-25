import { describe, expect, it } from 'vitest';
import type { HardwareProfile } from '@shared/types/domain.js';
import { HardwareService } from '@main/settings/hardware-service.js';
import { recommendDownloadConcurrency } from '@shared/utils/hardware-recommendation.js';

function fakeHardware(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    platform: 'win32',
    release: '10.0',
    architecture: 'x64',
    hostname: 'test',
    physicalCpuCount: 16,
    logicalCpuCount: 32,
    cpuModel: 'CPU giả lập',
    totalMemoryBytes: 64 * 1024 ** 3,
    freeMemoryBytes: 64 * 1024 ** 3,
    gpuAdapters: [],
    disks: [],
    detectedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('Vấn đề 2 mục 4 (2026-09-22) — đề xuất số luồng theo RAM CÒN TRỐNG, không theo RAM tổng', () => {
  it('recommendDownloadConcurrency: máy có RAM TỔNG lớn nhưng RAM TRỐNG thấp phải nhận đề xuất của máy yếu, không phải máy mạnh', () => {
    const richTotalButBusy = fakeHardware({
      logicalCpuCount: 40,
      totalMemoryBytes: 128 * 1024 ** 3,
      freeMemoryBytes: 8 * 1024 ** 3 // đang dùng gần hết RAM cho việc khác (VD: edit video)
    });
    const recommendation = recommendDownloadConcurrency(richTotalButBusy);
    // RAM trống 8GB rơi vào tier "cấu hình thấp" (<=16GB) dù CPU tới 40 lõi và RAM TỔNG 128GB.
    expect(recommendation.recommendedGlobalWorkers).toBeLessThanOrEqual(2);
    expect(recommendation.summary).toContain('cấu hình thấp');
  });

  it('recommendDownloadConcurrency: máy có RAM TRỐNG dồi dào (dù RAM tổng vừa phải) được đề xuất mạnh hơn máy đang bận', () => {
    const freeAndAvailable = fakeHardware({
      logicalCpuCount: 40,
      totalMemoryBytes: 128 * 1024 ** 3,
      freeMemoryBytes: 100 * 1024 ** 3 // đang rảnh thật sự
    });
    const recommendation = recommendDownloadConcurrency(freeAndAvailable);
    expect(recommendation.recommendedGlobalWorkers).toBeGreaterThanOrEqual(4);
    expect(recommendation.summary).toContain('Workstation mạnh');
  });

  it('HardwareService.recommend(): số worker/luồng cũng giảm theo RAM trống, mô tả vẫn nêu rõ cả RAM tổng lẫn RAM trống lúc quét', () => {
    const service = new HardwareService();
    const busyMachine = fakeHardware({
      logicalCpuCount: 40,
      totalMemoryBytes: 128 * 1024 ** 3,
      freeMemoryBytes: 8 * 1024 ** 3
    });
    const recommended = service.recommend(busyMachine);
    expect(recommended.normalizeWorkers).toBe(1); // tier thấp
    expect(recommended.description).toContain('128 GB RAM');
    expect(recommended.description).toContain('còn trống 8 GB lúc quét');
  });
});
