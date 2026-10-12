import { describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_MAX_AUTO_ROUNDS,
  RATE_LIMIT_STRIKE_RESET_WINDOW_MS,
  RATE_LIMIT_WAIT_STEPS_MS,
  formatAutoResumeEta,
  formatRateLimitCountdown,
  nextRateLimitStrikes,
  rateLimitPlatformLabel,
  rateLimitWaitMs
} from '@shared/utils/rate-limit-backoff.js';

// Hướng B (kế hoạch 429 đã duyệt 2026-10-10): dính 429 thì cả app nghỉ với nền tảng đó, chờ lâu dần 2 → 5 → 15 phút (có
// ngẫu nhiên một chút) rồi tự tiếp tục; sau 3 vòng vẫn bị chặn thì dừng hẳn, chờ người dùng xác minh như trước.

describe('nextRateLimitStrikes', () => {
  it('starts a fresh streak at strike 1 when the platform never hit 429 before', () => {
    expect(nextRateLimitStrikes(0, null, 1_000)).toBe(1);
  });

  it('increments the streak when the previous 429 was recent', () => {
    const now = 10_000_000;
    expect(nextRateLimitStrikes(1, now - 60_000, now)).toBe(2);
    expect(nextRateLimitStrikes(2, now - 60_000, now)).toBe(3);
  });

  it('resets the streak once the reset window has fully elapsed', () => {
    const now = 10_000_000;
    expect(nextRateLimitStrikes(5, now - RATE_LIMIT_STRIKE_RESET_WINDOW_MS - 1, now)).toBe(1);
  });

  it('stays within the reset window at the boundary', () => {
    const now = 10_000_000;
    expect(nextRateLimitStrikes(3, now - RATE_LIMIT_STRIKE_RESET_WINDOW_MS + 1, now)).toBe(4);
  });
});

describe('rateLimitWaitMs — 2 → 5 → 15 phút, rồi dừng hẳn', () => {
  it('đúng lịch đã duyệt khi không có ngẫu nhiên', () => {
    expect(RATE_LIMIT_WAIT_STEPS_MS).toEqual([2 * 60_000, 5 * 60_000, 15 * 60_000]);
    expect(RATE_LIMIT_MAX_AUTO_ROUNDS).toBe(3);
    expect(rateLimitWaitMs(1, () => 0.5)).toBe(2 * 60_000);
    expect(rateLimitWaitMs(2, () => 0.5)).toBe(5 * 60_000);
    expect(rateLimitWaitMs(3, () => 0.5)).toBe(15 * 60_000);
  });

  it('ngẫu nhiên ±15% để các máy/danh sách không cùng bật dậy một lúc', () => {
    expect(rateLimitWaitMs(1, () => 0)).toBe(Math.round(2 * 60_000 * 0.85));
    expect(rateLimitWaitMs(1, () => 1)).toBe(Math.round(2 * 60_000 * 1.15));
    for (let i = 0; i < 50; i += 1) {
      const wait = rateLimitWaitMs(2)!;
      expect(wait).toBeGreaterThanOrEqual(Math.round(5 * 60_000 * 0.85));
      expect(wait).toBeLessThanOrEqual(Math.round(5 * 60_000 * 1.15));
    }
  });

  it('lần thứ 4 liên tiếp (sau 3 vòng tự thử) → null: dừng hẳn, không tự thử lại vô hạn', () => {
    expect(rateLimitWaitMs(4, () => 0.5)).toBeNull();
    expect(rateLimitWaitMs(50, () => 0.5)).toBeNull();
  });

  it('số lần dưới 1 được coi là lần 1', () => {
    expect(rateLimitWaitMs(0, () => 0.5)).toBe(2 * 60_000);
  });

  it('thời gian chờ thay thế (chỉ dùng cho e2e) áp cho mọi vòng, vẫn dừng sau 3 vòng', () => {
    expect(rateLimitWaitMs(1, () => 0.5, 3_000)).toBe(3_000);
    expect(rateLimitWaitMs(3, () => 0.9, 3_000)).toBe(3_000);
    expect(rateLimitWaitMs(4, () => 0.5, 3_000)).toBeNull();
  });
});

describe('formatAutoResumeEta / formatRateLimitCountdown', () => {
  it('làm tròn lên ít nhất 1 phút, không bao giờ báo "0 phút"', () => {
    const now = 1_000_000;
    expect(formatAutoResumeEta(now + 10_000, now)).toBe('khoảng 1 phút');
    expect(formatAutoResumeEta(now + 60_000, now)).toBe('khoảng 1 phút');
    expect(formatAutoResumeEta(now + 5 * 60_000 + 1, now)).toBe('khoảng 6 phút');
  });

  it('đếm ngược dạng phút:giây cho huy hiệu', () => {
    expect(formatRateLimitCountdown(0)).toBe('0:00');
    expect(formatRateLimitCountdown(-5_000)).toBe('0:00');
    expect(formatRateLimitCountdown(4 * 60_000 + 7_400)).toBe('4:08');
    expect(formatRateLimitCountdown(15 * 60_000)).toBe('15:00');
  });
});

describe('rateLimitPlatformLabel', () => {
  it('tên nền tảng dễ đọc cho thông báo và huy hiệu', () => {
    expect(rateLimitPlatformLabel('youtube')).toBe('YouTube');
    expect(rateLimitPlatformLabel('tiktok')).toBe('TikTok');
    expect(rateLimitPlatformLabel('facebook')).toBe('Facebook');
    expect(rateLimitPlatformLabel('x-twitter')).toBe('X (Twitter)');
    expect(rateLimitPlatformLabel('google-drive')).toBe('Google Drive');
    expect(rateLimitPlatformLabel('cdn.example.com')).toBe('cdn.example.com');
  });
});
