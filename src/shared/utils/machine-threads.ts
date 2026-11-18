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

/**
 * 1.7.7 (V4): Kẹp số quy trình ghép chạy đồng thời theo sức máy và loại ổ đĩa:
 * khi máy <= 4 luồng hoặc ổ tạm/xuất là HDD, luôn giữ tối đa 1 quy trình ghép để tránh cào chéo ổ và kẹt CPU.
 */
export function effectiveMergeWorkflowCap(
  configuredMaxGlobalMergeJobs: number,
  logicalCpus: number,
  hasHdd = false
): number {
  const base = Math.max(1, Math.min(4, Math.trunc(configuredMaxGlobalMergeJobs || 1)));
  if (hasHdd || (logicalCpus > 0 && logicalCpus <= 4)) return 1;
  return base;
}

/**
 * 1.7.7 (V4): Kẹp số worker chuẩn hoá/remux/phân tích/cắt theo máy yếu và loại ổ HDD.
 */
export function withMachineMergeWorkers<T extends ResourceProfile>(
  profile: T,
  logicalCpus: number,
  hasHdd = false
): T {
  const lowCpu = logicalCpus > 0 && logicalCpus <= 4;
  if (lowCpu || hasHdd) {
    if (
      profile.normalizeWorkers === 1 &&
      profile.remuxWorkers === 1 &&
      profile.analyzeWorkers === 1 &&
      profile.clipWorkers === 1
    ) {
      return profile;
    }
    return {
      ...profile,
      normalizeWorkers: 1,
      remuxWorkers: 1,
      analyzeWorkers: 1,
      clipWorkers: 1
    };
  }
  if (logicalCpus > 4 && logicalCpus <= 8 && profile.analyzeWorkers > 2) {
    return { ...profile, analyzeWorkers: 2 };
  }
  return profile;
}

/**
 * 1.7.7 (V4): Bộ cờ giới hạn luồng chuẩn cho mọi lệnh FFmpeg chưa gắn hồ sơ tài nguyên trực tiếp
 * (`FileVerifier`, `LocalCut`, `cut-suggestion`) hoặc lấy từ hồ sơ đã qua `withMachineThreads`.
 */
export function defaultFfmpegThreadArgs(
  logicalCpus: number,
  profile?: Partial<Pick<ResourceProfile, 'ffmpegThreads' | 'filterThreads' | 'filterComplexThreads'>>
): string[] {
  const cap = machineThreadCap(logicalCpus);
  const threads =
    typeof profile?.ffmpegThreads === 'number' && profile.ffmpegThreads > 0
      ? profile.ffmpegThreads
      : Math.min(6, cap);
  const filterThreads =
    typeof profile?.filterThreads === 'number' && profile.filterThreads > 0
      ? profile.filterThreads
      : Math.min(3, cap);
  const filterComplexThreads =
    typeof profile?.filterComplexThreads === 'number' && profile.filterComplexThreads > 0
      ? profile.filterComplexThreads
      : Math.min(3, cap);
  return [
    '-threads',
    String(threads),
    '-filter_threads',
    String(filterThreads),
    '-filter_complex_threads',
    String(filterComplexThreads)
  ];
}
