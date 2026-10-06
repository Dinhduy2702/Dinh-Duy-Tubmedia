const GB = 1024 ** 3;

/**
 * Hai con số trong câu "chỉ còn X, thấp hơn mức an toàn Y". Làm tròn thường (toFixed) có thể ra hai số bằng nhau
 * — nhật ký thật ghi "chỉ còn 20.0 GB, thấp hơn mức an toàn 20.0 GB" khi còn 19,96 GB (khám phá bản cài #8).
 * Còn trống làm tròn XUỐNG, mức an toàn làm tròn LÊN tới 0,1 GB, nên còn trống < mức an toàn thì số hiện ra
 * cũng luôn nhỏ hơn.
 */
export function formatDiskShortfall(freeBytes: number, requiredBytes: number): { free: string; required: string } {
  return { free: formatGb(freeBytes, Math.floor), required: formatGb(requiredBytes, Math.ceil) };
}

function formatGb(bytes: number, round: (value: number) => number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB';
  return `${(round((bytes / GB) * 10) / 10).toFixed(1)} GB`;
}
