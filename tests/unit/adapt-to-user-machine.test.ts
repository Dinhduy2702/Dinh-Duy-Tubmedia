import { describe, expect, it } from 'vitest';
import { diskTypeOf, diskTypesByDriveLetter } from '../../src/main/settings/hardware-service.js';
import {
  automaticGlobalDownloadCap,
  effectiveConcurrentFragments,
  recommendDownloadConcurrency,
  recommendedConcurrentFragments,
  recommendedConcurrentLists
} from '../../src/shared/utils/hardware-recommendation.js';
import type { HardwareProfile } from '../../src/shared/types/domain.js';

// 2026-10-24 (nguyên tắc người dùng: mọi phần của app tự dò đúng máy đang chạy, không bê số của máy dev 36 lõi/128 GB).
const GB = 1024 ** 3;

function hardware(logicalCpuCount: number, totalGb: number, freeGb: number): HardwareProfile {
  return {
    platform: 'win32',
    release: 'test',
    architecture: 'x64',
    hostname: 'test',
    physicalCpuCount: Math.max(1, Math.floor(logicalCpuCount / 2)),
    logicalCpuCount,
    cpuModel: 'Test CPU',
    totalMemoryBytes: totalGb * GB,
    freeMemoryBytes: freeGb * GB,
    gpuAdapters: [],
    disks: [],
    detectedAt: new Date(0).toISOString()
  };
}

describe('dò loại ổ đĩa (trước đây mọi ổ luôn "unknown")', () => {
  it('nhận HDD/SSD theo ổ vật lý, NVMe không báo loại vẫn là SSD, còn lại để chưa rõ', () => {
    expect(diskTypeOf('HDD', 'SATA')).toBe('hdd');
    expect(diskTypeOf('SSD', 'NVMe')).toBe('ssd');
    expect(diskTypeOf('SCM', '')).toBe('ssd');
    expect(diskTypeOf('Unspecified', 'NVMe')).toBe('ssd');
    expect(diskTypeOf(3, 11)).toBe('hdd');
    expect(diskTypeOf(4, 11)).toBe('ssd');
    expect(diskTypeOf('Unspecified', 'USB')).toBe('unknown');
    expect(diskTypeOf('', '')).toBe('unknown');
    expect(diskTypeOf(undefined, undefined)).toBe('unknown');
  });

  it('ghép theo ký tự ổ — đúng kết quả thật của Windows trên máy 1 SSD NVMe + 1 HDD SATA', () => {
    const rows = [
      { DriveLetter: 'C', MediaType: 'SSD', BusType: 'NVMe' },
      { DriveLetter: 'e', MediaType: 'HDD', BusType: 'SATA' },
      { DriveLetter: '', MediaType: 'SSD', BusType: 'NVMe' }
    ];
    expect([...diskTypesByDriveLetter(rows)]).toEqual([
      ['C', 'ssd'],
      ['E', 'hdd']
    ]);
  });
});

describe('số mảnh tải mỗi video tự dò theo máy', () => {
  it('máy rất yếu (≤4 luồng hoặc ≤8 GB RAM) → 1; còn lại → 2 như mọi máy vẫn chạy trước đây', () => {
    expect(recommendedConcurrentFragments(2, 4 * GB)).toBe(1);
    expect(recommendedConcurrentFragments(4, 16 * GB)).toBe(1);
    expect(recommendedConcurrentFragments(8, 8 * GB)).toBe(1);
    expect(recommendedConcurrentFragments(8, 16 * GB)).toBe(2);
    expect(recommendedConcurrentFragments(36, 128 * GB)).toBe(2);
  });

  it('theo RAM TỔNG, không theo RAM trống lúc đo (để số mảnh không nhảy qua lại)', () => {
    const busy = hardware(8, 16, 1);
    expect(recommendDownloadConcurrency(busy).recommendedConcurrentFragments).toBe(2);
  });

  it('tự động → theo máy; tự chọn → đúng số đã chọn (giới hạn 1–8)', () => {
    expect(effectiveConcurrentFragments({ downloadFragmentsAuto: true, downloadConcurrentFragments: 8 }, 4, 8 * GB)).toBe(1);
    expect(effectiveConcurrentFragments({ downloadFragmentsAuto: true, downloadConcurrentFragments: 8 }, 16, 32 * GB)).toBe(2);
    expect(effectiveConcurrentFragments({ downloadFragmentsAuto: false, downloadConcurrentFragments: 6 }, 4, 8 * GB)).toBe(6);
    expect(effectiveConcurrentFragments({ downloadFragmentsAuto: false, downloadConcurrentFragments: 50 }, 4, 8 * GB)).toBe(8);
  });

  it('ô ở Cài đặt hiện đúng số bộ tải dùng', () => {
    for (const [cores, total, free] of [[2, 4, 2], [4, 8, 6], [8, 16, 10], [36, 128, 82]] as const) {
      const profile = hardware(cores, total, free);
      expect(recommendDownloadConcurrency(profile).recommendedConcurrentFragments).toBe(
        recommendedConcurrentFragments(cores, total * GB)
      );
    }
  });
});

describe('trần tổng video tải cùng lúc tự dò theo máy', () => {
  it('= 2 × số danh sách tự động của trần 6 mức: máy yếu 2 … máy rất mạnh 12', () => {
    expect(automaticGlobalDownloadCap(4, 6 * GB)).toBe(2);
    expect(automaticGlobalDownloadCap(8, 12 * GB)).toBe(4);
    expect(automaticGlobalDownloadCap(16, 30 * GB)).toBe(8);
    expect(automaticGlobalDownloadCap(36, 82 * GB)).toBe(12);
    // Máy mạnh nhưng RAM trống còn ít (đang dựng video) → trần hạ theo.
    expect(automaticGlobalDownloadCap(36, 7 * GB)).toBe(2);
  });

  it('không thấp hơn số video máy đã chạy khi để tự động (danh sách tự động × 2 luồng)', () => {
    for (const [cores, free] of [[2, 2], [8, 16], [12, 24], [24, 48], [72, 100]] as const) {
      expect(automaticGlobalDownloadCap(cores, free * GB)).toBe(2 * recommendedConcurrentLists(cores, free * GB));
    }
  });

  it('"Tối đa an toàn" ở Cài đặt = đúng trần hàng đợi áp dụng', () => {
    const profile = hardware(12, 32, 20);
    expect(recommendDownloadConcurrency(profile).maximumSafeGlobalWorkers).toBe(automaticGlobalDownloadCap(12, 20 * GB));
  });
});
