import { describe, expect, it } from 'vitest';
import type { HardwareProfile } from '@shared/types/domain.js';
import { builtInResourceProfiles } from '@main/settings/defaults.js';
import { HardwareService } from '@main/settings/hardware-service.js';

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

describe('Vấn đề 2 mục 3 (2026-09-22) — mọi hồ sơ dựng sẵn đều dùng below_normal', () => {
  it('không còn hồ sơ nào dùng processPriority khác below_normal', () => {
    expect(builtInResourceProfiles.length).toBeGreaterThan(0);
    for (const profile of builtInResourceProfiles) {
      expect(profile.processPriority, `hồ sơ "${profile.name}" phải dùng below_normal`).toBe('below_normal');
    }
  });

  it('HardwareService.recommend() cũng luôn tạo hồ sơ below_normal', () => {
    const service = new HardwareService();
    const recommended = service.recommend(fakeHardware());
    expect(recommended.processPriority).toBe('below_normal');
  });
});
