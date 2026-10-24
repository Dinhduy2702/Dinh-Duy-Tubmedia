/**
 * Hướng C kế hoạch 429 (2026-10-13): giãn nhịp từ trước với nền tảng. Trước đây yt-dlp không nghỉ giữa các yêu cầu, nên
 * nhiều video cùng một nền tảng tải song song dồn yêu cầu tới cùng máy chủ.
 *
 * Chỉ giãn nhịp — KHÔNG đụng số kết nối: đo bằng yt-dlp + aria2c thật, cờ `--downloader http,https:<aria2c>` bị yt-dlp bỏ
 * qua nên app vẫn tải bằng bộ tải nội bộ của yt-dlp (ít kết nối); người dùng chọn giữ đúng thực tế đó.
 *
 * Chỉ áp cho nền tảng có tên (YouTube, TikTok…) — link tệp trực tiếp (máy chủ thường) giữ nguyên như cũ.
 */
export const PACED_PLATFORMS: ReadonlySet<string> = new Set([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'x-twitter',
  'google-drive',
  'vimeo',
  'reddit',
  'dailymotion',
  'twitch',
  'soundcloud'
]);

/** Tình trạng nền tảng lúc video bắt đầu tải — hàng đợi cung cấp. */
export interface DownloadPacingContext {
  /** Số video CÙNG nền tảng đang tải trên toàn ứng dụng, tính cả video này. */
  samePlatformActive: number;
  /** Số lần dính 429 liên tiếp gần đây của nền tảng (0 = không). */
  rateLimitStrikes: number;
  /** Đề xuất A: số mảnh hàng đợi đã tính cho video này (tự tận dụng phần trống). Không có → bộ tải dùng ô Cài đặt. */
  concurrentFragments?: number;
}

/** Nghỉ ~1 s giữa các yêu cầu và 1–3 s trước mỗi lần tải khi từ 2 video cùng nền tảng tải song song. */
const BUSY_SLEEP_ARGS = ['--sleep-requests', '1', '--sleep-interval', '1', '--max-sleep-interval', '3'] as const;
/** Nền tảng vừa dính 429: nghỉ lâu hơn (2 s giữa các yêu cầu, 3–8 s trước mỗi lần tải), kể cả với một video lẻ. */
const AFTER_RATE_LIMIT_SLEEP_ARGS = ['--sleep-requests', '2', '--sleep-interval', '3', '--max-sleep-interval', '8'] as const;

/** Tham số giãn nhịp thêm cho yt-dlp; [] = không nghỉ (một video lẻ, link trực tiếp hoặc chưa rõ nền tảng). */
export function downloadPacingArgs(platform: string | null, context: DownloadPacingContext | undefined): string[] {
  if (!platform || !PACED_PLATFORMS.has(platform)) return [];
  const active = Math.max(1, Math.trunc(context?.samePlatformActive ?? 1));
  const strikes = Math.max(0, Math.trunc(context?.rateLimitStrikes ?? 0));
  if (strikes > 0) return [...AFTER_RATE_LIMIT_SLEEP_ARGS];
  return active >= 2 ? [...BUSY_SLEEP_ARGS] : [];
}
