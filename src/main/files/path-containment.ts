import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * `candidate` nằm trong `folder` (hoặc chính là `folder`)? So sánh theo đường dẫn đã chuẩn hóa nên
 * `..`, dấu gạch chéo lẫn lộn và khác hoa/thường trên Windows đều được xử lý. Tên bắt đầu bằng hai
 * dấu chấm (ví dụ tiêu đề "...và công lý") vẫn là tệp bên trong, không bị nhầm với `..`.
 */
export function isInside(folder: string, candidate: string): boolean {
  const child = relative(resolve(folder), resolve(candidate));
  if (child === '') return true;
  if (isAbsolute(child)) return false;
  return child !== '..' && !child.startsWith(`..${sep}`);
}

/**
 * Đường dẫn tệp do tiến trình ngoài (yt-dlp) báo về chỉ được tin khi nằm hẳn bên trong thư mục
 * đích. Trả về đúng chuỗi đã nhận nếu hợp lệ, ngược lại null (bị từ chối).
 */
export function acceptPathInside(folder: string, reported: string): string | null {
  const value = reported.trim();
  if (!value || value.includes('\0')) return null;
  if (relative(resolve(folder), resolve(value)) === '') return null;
  return isInside(folder, value) ? reported : null;
}
