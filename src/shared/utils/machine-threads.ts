import type { ResourceProfile } from '../types/domain.js';

/**
 * 1.7.5 (sửa A) + 1.7.6 (việc A0, người dùng duyệt 2026-11-07): MỌI tham số luồng của ffmpeg theo máy đang chạy — số luồng
 * giải mã/mã hoá (-threads), bộ lọc (-filter_threads) và bộ lọc phức (-filter_complex_threads). Hồ sơ có sẵn ghi cố định
 * 6/3/3 cho mọi máy; số thật dùng = min(số gốc của hồ sơ, max(1, nửa số luồng logic của máy)). Trường nào người dùng đã tự
 * chỉnh (khác số gốc) hoặc hồ sơ tự tạo → giữ đúng số người dùng chọn.
 */
export const FFMPEG_THREAD_FIELDS = ['ffmpegThreads', 'filterThreads', 'filterComplexThreads'] as const;
type ThreadField = (typeof FFMPEG_THREAD_FIELDS)[number];
type ThreadValues = Pick<ResourceProfile, ThreadField>;

/**
 * Số luồng gốc của các hồ sơ có sẵn — PHẢI khớp src/main/settings/defaults.ts (bài kiểm machine-threads-a0 so khớp). Ở đây để
 * giao diện cũng tính được số thật mà không phải đọc mã tiến trình chính.
 */
export const BUILT_IN_RESOURCE_THREADS: Readonly<Record<string, ThreadValues>> = {
  'resource-low': { ffmpegThreads: 3, filterThreads: 1, filterComplexThreads: 1 },
  'resource-balanced': { ffmpegThreads: 5, filterThreads: 2, filterComplexThreads: 2 },
  'resource-interactive': { ffmpegThreads: 6, filterThreads: 3, filterComplexThreads: 3 },
  'resource-full': { ffmpegThreads: 6, filterThreads: 3, filterComplexThreads: 3 }
};

/** Trần số luồng theo máy: một nửa số luồng logic, ít nhất 1. */
export function machineThreadCap(logicalCpus: number): number {
  return Math.max(1, Math.floor(Math.max(0, logicalCpus) / 2));
}

export function withMachineThreads<T extends ResourceProfile>(profile: T, logicalCpus: number): T {
  const original = profile.builtIn ? BUILT_IN_RESOURCE_THREADS[profile.id] : undefined;
  if (!original) return profile;
  const cap = machineThreadCap(logicalCpus);
  let changed = false;
  const next = { ...profile };
  for (const field of FFMPEG_THREAD_FIELDS) {
    if (profile[field] !== original[field]) continue; // người dùng đã tự chỉnh trường này
    const value = Math.min(original[field], cap);
    if (value !== profile[field]) {
      next[field] = value;
      changed = true;
    }
  }
  return changed ? next : profile;
}

/** Số luồng ffmpeg thật sự dùng trên máy này — cho chữ "FFmpeg N luồng" trên giao diện. */
export function effectiveFfmpegThreads(profile: ResourceProfile, logicalCpus: number): number {
  return withMachineThreads(profile, logicalCpus).ffmpegThreads;
}
