/**
 * Rà soát toàn diện (2026-09-24) — mục 2.2: logic dựng tham số cookie cho yt-dlp trước đây lặp lại giống
 * hệt ở 3 nơi (download-engine.ts, quick-download-command.ts, preview-frame-command.ts) — dễ sửa một nơi
 * quên nơi khác. Gộp thành MỘT hàm dùng chung ở đây; chỉ tổ chức lại code, KHÔNG đổi hành vi hiện có (đã
 * xác nhận bằng test dựng đúng tham số như trước khi gộp, cho cả 3 luồng, trước khi sửa).
 */
import type { AppSettings } from '@shared/types/domain.js';

export type CookieArgumentSettings = Pick<
  AppSettings,
  'cookiesFilePath' | 'cookiesBrowser' | 'cookiesBrowserProfile'
>;

/**
 * Ưu tiên tệp cookies Netscape nếu có; nếu không thì lấy từ trình duyệt (kèm hồ sơ nếu có, nối bằng
 * ':'); nếu không có gì (hoặc không truyền `settings`) thì không thêm tham số nào.
 */
/**
 * Tên hồ sơ mặc định của Chromium (Chrome/Edge) — Firefox không dùng các tên thư mục này.
 * Nếu cài đặt cũ nâng cấp từ ≤1.8.0 còn sót `Default` / `Profile N` sau khi đổi sang Firefox, bỏ qua tên hồ sơ
 * để yt-dlp tự chọn hồ sơ Firefox thật thay vì lỗi `could not find firefox cookies database`.
 */
const CHROMIUM_ONLY_PROFILE_NAME = /^(?:default|profile\s+\d+)$/i;

export function buildCookieArguments(settings?: CookieArgumentSettings): string[] {
  if (!settings) return [];
  if (settings.cookiesFilePath) return ['--cookies', settings.cookiesFilePath];
  if (settings.cookiesBrowser !== 'none') {
    const rawProfile = settings.cookiesBrowserProfile.trim();
    const effectiveProfile =
      settings.cookiesBrowser === 'firefox' && CHROMIUM_ONLY_PROFILE_NAME.test(rawProfile) ? '' : rawProfile;
    const spec = effectiveProfile ? `${settings.cookiesBrowser}:${effectiveProfile}` : settings.cookiesBrowser;
    return ['--cookies-from-browser', spec];
  }
  return [];
}
