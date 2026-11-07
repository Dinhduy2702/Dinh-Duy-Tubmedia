import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtInResourceProfiles } from '@main/settings/defaults.js';
import { withMachineFfmpegThreads } from '@main/settings/resource-machine-threads.js';
import { HardwareService } from '@main/settings/hardware-service.js';
import { BUILT_IN_RESOURCE_THREADS, effectiveFfmpegThreads } from '@shared/utils/machine-threads.js';
import type { HardwareProfile, ResourceProfile } from '@shared/types/domain.js';

// 1.7.6 việc A0 (người dùng duyệt 2026-11-07): 1.7.5 chỉ cho -threads theo máy; -filter_threads / -filter_complex_threads
// vẫn lấy thẳng hồ sơ (3/3 cho mọi máy, kể cả máy 2 luồng); hồ sơ "Tự động theo máy" cho máy ≤ 8 luồng đặt ffmpeg
// max(2, nửa) = 2 luồng trên máy 2 luồng; giao diện in "FFmpeg 6 luồng" theo số gốc của hồ sơ, không phải số thật.

const full = builtInResourceProfiles.find((profile) => profile.id === 'resource-full')!;

function hardware(logical: number, freeGb = 8): HardwareProfile {
  return {
    platform: 'win32',
    release: '10',
    architecture: 'x64',
    hostname: 'may-thu',
    physicalCpuCount: Math.max(1, Math.floor(logical / 2)),
    logicalCpuCount: logical,
    cpuModel: 'CPU thử',
    totalMemoryBytes: 16 * 1024 ** 3,
    freeMemoryBytes: freeGb * 1024 ** 3,
    gpuAdapters: [],
    disks: [],
    detectedAt: new Date(0).toISOString()
  };
}

describe('A0: mọi tham số luồng ffmpeg theo máy', () => {
  it.each([
    [2, 1, 1, 1],
    [4, 2, 2, 2],
    [6, 3, 3, 3],
    [8, 4, 3, 3],
    [72, 6, 3, 3]
  ])('hồ sơ có sẵn (6/3/3) trên máy %i luồng → ffmpeg %i, bộ lọc %i, bộ lọc phức %i', (logical, ffmpeg, filter, complex) => {
    const result = withMachineFfmpegThreads(full, logical);
    expect([result.ffmpegThreads, result.filterThreads, result.filterComplexThreads]).toEqual([ffmpeg, filter, complex]);
  });

  it('người dùng tự chỉnh riêng số luồng bộ lọc → giữ đúng số đó, các số khác vẫn theo máy', () => {
    const edited: ResourceProfile = { ...full, filterThreads: 5 };
    const result = withMachineFfmpegThreads(edited, 2);
    expect(result.filterThreads).toBe(5);
    expect(result.ffmpegThreads).toBe(1);
    expect(result.filterComplexThreads).toBe(1);
  });

  it('hồ sơ "Tự động theo máy" trên máy 2 luồng không đặt quá nửa số luồng của máy', () => {
    const recommended = new HardwareService().recommend(hardware(2));
    expect(recommended.ffmpegThreads).toBe(1);
    expect(recommended.filterThreads).toBe(1);
    expect(recommended.filterComplexThreads).toBe(1);
  });

  it('chữ "FFmpeg N luồng" lấy số thật theo máy (hồ sơ 6 luồng: máy 4 luồng → 2; máy 72 luồng → 6)', () => {
    expect(effectiveFfmpegThreads(full, 4)).toBe(2);
    expect(effectiveFfmpegThreads(full, 72)).toBe(6);
    expect(effectiveFfmpegThreads({ ...full, ffmpegThreads: 4 }, 2), 'người dùng tự chỉnh thì hiện đúng số đã chỉnh').toBe(4);
  });

  it('bảng số luồng gốc dùng chung khớp đúng các hồ sơ có sẵn', () => {
    for (const profile of builtInResourceProfiles) {
      expect(BUILT_IN_RESOURCE_THREADS[profile.id], profile.id).toEqual({
        ffmpegThreads: profile.ffmpegThreads,
        filterThreads: profile.filterThreads,
        filterComplexThreads: profile.filterComplexThreads
      });
    }
    expect(Object.keys(BUILT_IN_RESOURCE_THREADS).sort()).toEqual(builtInResourceProfiles.map((profile) => profile.id).sort());
  });

  it('các trang hiện số luồng dùng số thật theo máy', () => {
    expect(readFileSync('src/renderer/src/pages/DownloadMergePage.tsx', 'utf8')).not.toContain('FFmpeg {profile.ffmpegThreads} luồng');
    expect(readFileSync('src/renderer/src/pages/ProjectsPage.tsx', 'utf8')).not.toContain("String(resource?.ffmpegThreads??0)");
  });
});
