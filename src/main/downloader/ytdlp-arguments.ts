/**
 * Mọi lần gọi yt-dlp với một URL phải đi qua đây:
 *  - `--ignore-config` để tệp cấu hình yt-dlp trên máy (có thể chứa `--exec`, `--proxy`...) không tự chèn tùy chọn;
 *  - URL luôn đứng cuối, sau `--`, nên dù giá trị bắt đầu bằng `-` (ví dụ `--exec ...` lọt vào từ
 *    backup hoặc cơ sở dữ liệu) vẫn chỉ bị hiểu là một địa chỉ, không bao giờ là tùy chọn.
 */
export const YTDLP_IGNORE_CONFIG = '--ignore-config';
export const YTDLP_END_OF_OPTIONS = '--';

export function withIgnoredConfig(options: readonly string[]): string[] {
  return [YTDLP_IGNORE_CONFIG, ...options.filter((option) => option !== YTDLP_IGNORE_CONFIG)];
}

export function withEndOfOptionsUrl(options: readonly string[], url: string): string[] {
  return [...options.filter((option) => option !== YTDLP_END_OF_OPTIONS), YTDLP_END_OF_OPTIONS, url];
}

export function buildSafeYtDlpArguments(options: readonly string[], url: string): string[] {
  return withEndOfOptionsUrl(withIgnoredConfig(options), url);
}
