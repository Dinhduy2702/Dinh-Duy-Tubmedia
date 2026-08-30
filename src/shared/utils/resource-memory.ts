const MEBIBYTE = 1024 ** 2;

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
