/**
 * Auto-resume backoff cho danh sách bị tạm dừng vì SOURCE_RATE_LIMITED (HTTP 429).
 *
 * Trước đây, khi một nền tảng trả 429, Tubmedia tạm dừng cả danh sách và CHỜ người
 * dùng tự bấm "Tiếp tục" — không có cơ chế tự thử lại. Nếu người dùng không có mặt,
 * danh sách đứng im vô thời hạn dù giới hạn phía nền tảng có thể đã được gỡ từ lâu.
 *
 * Các hàm dưới đây là phần tính toán thuần (không side effect) cho cơ chế tự thử lại:
 * mỗi lần một danh sách dính 429, số "lần liên tiếp" (strikes) tăng lên và thời gian
 * chờ trước khi tự tiếp tục giãn ra theo cấp số nhân (có jitter để tránh nhiều danh
 * sách cùng retry đúng một thời điểm), tối đa ở một trần hợp lý. Nếu danh sách không
 * dính 429 nào trong một khoảng đủ lâu, lần dính tiếp theo được tính lại từ đầu.
 */

/** Thời gian chờ cơ sở cho lần dính 429 đầu tiên. */
export const RATE_LIMIT_BASE_DELAY_MS = 2 * 60_000; // 2 phút

/** Trần thời gian chờ, dù đã dính 429 liên tiếp nhiều lần. */
export const RATE_LIMIT_MAX_DELAY_MS = 20 * 60_000; // 20 phút

/** Quá khoảng này kể từ lần dính 429 gần nhất thì coi là chuỗi mới, tính lại từ strike 1. */
export const RATE_LIMIT_STRIKE_RESET_WINDOW_MS = 2 * 60 * 60_000; // 2 giờ

/** Trần cho số strike dùng khi tính backoff, tránh số mũ tăng vô hạn. */
const MAX_STRIKES_FOR_BACKOFF = 6;

/**
 * Tính số strike (lần dính 429 liên tiếp) tiếp theo của một danh sách.
 *
 * @param previousStrikes Số strike trước đó (0 nếu danh sách chưa từng dính 429).
 * @param lastHitAtMs Thời điểm (epoch ms) của lần dính 429 gần nhất, hoặc null nếu chưa từng.
 * @param nowMs Thời điểm hiện tại (epoch ms).
 */
export function nextRateLimitStrikes(
  previousStrikes: number,
  lastHitAtMs: number | null,
  nowMs: number
): number {
  if (lastHitAtMs === null || nowMs - lastHitAtMs > RATE_LIMIT_STRIKE_RESET_WINDOW_MS) return 1;
  return Math.max(1, previousStrikes) + 1;
}

/**
 * Thời gian chờ (ms) trước khi tự động thử tiếp tục danh sách, theo số strike hiện tại.
 * Có jitter ngẫu nhiên 75%–125% để các danh sách/dự án khác nhau không cùng bật dậy
 * retry trong cùng một thời điểm (tránh lại gây dồn yêu cầu).
 */
export function rateLimitBackoffMs(strikes: number): number {
  const effectiveStrikes = Math.min(Math.max(1, Math.trunc(strikes)), MAX_STRIKES_FOR_BACKOFF);
  const exponential = Math.min(
    RATE_LIMIT_MAX_DELAY_MS,
    RATE_LIMIT_BASE_DELAY_MS * 2 ** (effectiveStrikes - 1)
  );
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

/**
 * Câu tiếng Việt ngắn gọn báo thời điểm sẽ tự động thử lại, dùng trong thông báo
 * SOURCE_RATE_LIMITED. Luôn làm tròn lên ít nhất 1 phút để không báo "0 phút".
 */
export function formatAutoResumeEta(resumeAtMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.ceil((resumeAtMs - nowMs) / 60_000));
  return minutes === 1
    ? 'Tubmedia sẽ tự thử tiếp tục sau khoảng 1 phút.'
    : `Tubmedia sẽ tự thử tiếp tục sau khoảng ${minutes} phút.`;
}
