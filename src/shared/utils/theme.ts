import type { AppSettings } from '../types/domain.js';

/**
 * Giao diện đang dùng có phải màu sáng không — tính từ cài đặt và Windows (Đợt 5 mục 10). Chưa nạp cài đặt thì tối
 * (mặc định của app).
 */
export function isLightTheme(theme: AppSettings['theme'] | undefined, windowsPrefersLight: boolean): boolean {
  return theme === 'light' || (theme === 'system' && windowsPrefersLight);
}
