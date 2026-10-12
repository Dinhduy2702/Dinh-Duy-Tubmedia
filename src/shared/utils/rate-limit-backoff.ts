/**
 * Hướng B của kế hoạch 429 (đã duyệt 2026-10-10): khi một nền tảng trả HTTP 429, cả ứng dụng nghỉ với nền tảng đó (không bắt
 * đầu video mới của nền tảng đó ở mọi danh sách, kể cả làn ghép; video đang tải dở vẫn chạy tiếp), chờ lâu dần rồi tự tiếp
 * tục với ít luồng và tăng dần. Sau 3 vòng tự thử mà vẫn bị chặn thì dừng hẳn, chờ người dùng xác minh như trước.
 *
 * Trước đây: dính 429 thì tạm dừng đúng danh sách và chờ người dùng bấm "Tiếp tục" vô thời hạn, trong khi các danh sách
 * khác cùng nền tảng vẫn gửi yêu cầu và lần lượt bị chặn theo dây chuyền.
 *
 * Các hàm ở đây là phần tính toán thuần (không side effect); trạng thái theo nền tảng nằm ở PlatformRateLimitGate (main).
 */

/** Thời gian chờ trước mỗi vòng tự tiếp tục: lần dính thứ 1, 2, 3 trong cùng một chuỗi. */
export const RATE_LIMIT_WAIT_STEPS_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000] as const;

/** Số vòng tự tiếp tục tối đa; lần dính kế tiếp thì dừng hẳn. */
export const RATE_LIMIT_MAX_AUTO_ROUNDS = RATE_LIMIT_WAIT_STEPS_MS.length;

/** Quá khoảng này kể từ lần dính 429 gần nhất thì coi là chuỗi mới, tính lại từ lần 1. */
export const RATE_LIMIT_STRIKE_RESET_WINDOW_MS = 2 * 60 * 60_000; // 2 giờ

/** Sau khi tự tiếp tục: bắt đầu 1 video một lúc, mỗi video tải xong thêm 1; đạt mức này thì bỏ hẳn giới hạn tạm. */
export const RATE_LIMIT_RAMP_CLEAR_AT = 6;

/** Biên ngẫu nhiên ±15% để nhiều máy/danh sách không cùng bật dậy đúng một thời điểm. */
const RATE_LIMIT_JITTER = 0.15;

/**
 * Số lần dính 429 liên tiếp tiếp theo của một nền tảng.
 *
 * @param previousStrikes Số lần trước đó (0 nếu chưa từng dính).
 * @param lastHitAtMs Thời điểm (epoch ms) lần dính gần nhất, hoặc null nếu chưa từng.
 */
export function nextRateLimitStrikes(previousStrikes: number, lastHitAtMs: number | null, nowMs: number): number {
  if (lastHitAtMs === null || nowMs - lastHitAtMs > RATE_LIMIT_STRIKE_RESET_WINDOW_MS) return 1;
  return Math.max(1, previousStrikes) + 1;
}

/**
 * Thời gian chờ (ms) trước khi tự tiếp tục, theo số lần dính trong chuỗi; null = đã hết số vòng tự thử, phải dừng hẳn.
 *
 * @param overrideMs Thời gian chờ thay thế cho mọi vòng (chỉ bài e2e dùng, không ngẫu nhiên).
 */
export function rateLimitWaitMs(strikes: number, random: () => number = Math.random, overrideMs?: number): number | null {
  const strike = Math.max(1, Math.trunc(strikes));
  if (strike > RATE_LIMIT_MAX_AUTO_ROUNDS) return null;
  if (overrideMs !== undefined) return overrideMs;
  const base = RATE_LIMIT_WAIT_STEPS_MS[strike - 1]!;
  return Math.round(base * (1 - RATE_LIMIT_JITTER + random() * 2 * RATE_LIMIT_JITTER));
}

/** "khoảng N phút" tới lúc tự tiếp tục; luôn làm tròn lên ít nhất 1 phút để không báo "0 phút". */
export function formatAutoResumeEta(resumeAtMs: number, nowMs: number): string {
  return `khoảng ${Math.max(1, Math.ceil((resumeAtMs - nowMs) / 60_000))} phút`;
}

/** Đếm ngược "phút:giây" cho huy hiệu ở thanh trên. */
export function formatRateLimitCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  'x-twitter': 'X (Twitter)',
  'google-drive': 'Google Drive',
  vimeo: 'Vimeo',
  reddit: 'Reddit',
  dailymotion: 'Dailymotion',
  twitch: 'Twitch',
  soundcloud: 'SoundCloud'
};

/** Tên nền tảng dễ đọc (khóa nền tảng của detectPlatform; nền tảng lạ thì là tên miền). */
export function rateLimitPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
