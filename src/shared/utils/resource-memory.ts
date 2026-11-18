const MEBIBYTE = 1024 ** 2;

export const EMERGENCY_FREE_MEMORY_FLOOR_BYTES = 256 * MEBIBYTE;
export const LOW_MEMORY_WAITING_CODE = 'LOW_MEMORY_WAITING';
export const LOW_MEMORY_WAITING_TITLE = 'RAM trống quá thấp, Tubmedia đang tạm chờ để tránh đơ máy';

/**
 * A profile's reserve is an upper preference, not an absolute requirement.
 * Fixed multi-gigabyte reserves can permanently starve otherwise healthy
 * 4–16 GB user machines, so cap the effective reserve to 15% of installed RAM.
 */
export function effectiveMemoryReserveBytes(configuredBytes: number, totalBytes: number): number {
  const configured = Number.isFinite(configuredBytes) ? Math.max(0, configuredBytes) : 0;
  const total = Number.isFinite(totalBytes) ? Math.max(0, totalBytes) : 0;
  if (total === 0) return configured;

  const adaptiveCeiling = Math.max(768 * MEBIBYTE, Math.floor(total * 0.15));
  return Math.min(configured, adaptiveCeiling);
}

/**
 * V8 (1.7.7): Khi chưa có tiến trình nào chạy (activeJobsCount === 0), cho phép mở tối thiểu 1 việc
 * miễn máy còn trên sàn khẩn cấp 256 MiB RAM trống; chỉ áp mức dự trữ đầy đủ từ việc thứ 2 trở đi.
 */
export function requiredFreeMemoryBytesForStart(
  configuredBytes: number,
  totalBytes: number,
  activeJobsCount: number
): number {
  const reserve = effectiveMemoryReserveBytes(configuredBytes, totalBytes);
  if (reserve <= 0) return 0;
  if (activeJobsCount <= 0) {
    return Math.min(reserve, EMERGENCY_FREE_MEMORY_FLOOR_BYTES);
  }
  return reserve;
}
