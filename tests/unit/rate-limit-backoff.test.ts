import { describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  RATE_LIMIT_STRIKE_RESET_WINDOW_MS,
  formatAutoResumeEta,
  nextRateLimitStrikes,
  rateLimitBackoffMs
} from '@shared/utils/rate-limit-backoff.js';

describe('nextRateLimitStrikes', () => {
  it('starts a fresh streak at strike 1 when the project never hit 429 before', () => {
    expect(nextRateLimitStrikes(0, null, 1_000)).toBe(1);
  });

  it('increments the streak when the previous 429 was recent', () => {
    const now = 10_000_000;
    expect(nextRateLimitStrikes(1, now - 60_000, now)).toBe(2);
    expect(nextRateLimitStrikes(2, now - 60_000, now)).toBe(3);
  });

  it('resets the streak once the reset window has fully elapsed', () => {
    const now = 10_000_000;
    const longAgo = now - RATE_LIMIT_STRIKE_RESET_WINDOW_MS - 1;
    expect(nextRateLimitStrikes(5, longAgo, now)).toBe(1);
  });

  it('stays within the reset window at the boundary', () => {
    const now = 10_000_000;
    const justInside = now - RATE_LIMIT_STRIKE_RESET_WINDOW_MS + 1;
    expect(nextRateLimitStrikes(3, justInside, now)).toBe(4);
  });
});

describe('rateLimitBackoffMs', () => {
  it('stays within jittered bounds of the base delay on the first strike', () => {
    const delay = rateLimitBackoffMs(1);
    expect(delay).toBeGreaterThanOrEqual(Math.round(RATE_LIMIT_BASE_DELAY_MS * 0.75));
    expect(delay).toBeLessThanOrEqual(Math.round(RATE_LIMIT_BASE_DELAY_MS * 1.25));
  });

  it('grows exponentially with more strikes', () => {
    const first = rateLimitBackoffMs(1);
    const third = rateLimitBackoffMs(3);
    // Even with jitter, strike 3 (4x the exponential base) must clear strike 1's jittered max.
    expect(third).toBeGreaterThan(first);
  });

  it('never exceeds the configured cap, even for very high strike counts', () => {
    const delay = rateLimitBackoffMs(50);
    expect(delay).toBeLessThanOrEqual(Math.round(RATE_LIMIT_MAX_DELAY_MS * 1.25));
  });

  it('treats a strike count below 1 as strike 1', () => {
    const delay = rateLimitBackoffMs(0);
    expect(delay).toBeGreaterThanOrEqual(Math.round(RATE_LIMIT_BASE_DELAY_MS * 0.75));
    expect(delay).toBeLessThanOrEqual(Math.round(RATE_LIMIT_BASE_DELAY_MS * 1.25));
  });
});

describe('formatAutoResumeEta', () => {
  it('rounds up to at least 1 minute so it never reports "0 phút"', () => {
    const now = 1_000_000;
    expect(formatAutoResumeEta(now + 10_000, now)).toBe('Tubmedia sẽ tự thử tiếp tục sau khoảng 1 phút.');
  });

  it('uses singular phrasing for exactly 1 minute', () => {
    const now = 1_000_000;
    expect(formatAutoResumeEta(now + 60_000, now)).toBe('Tubmedia sẽ tự thử tiếp tục sau khoảng 1 phút.');
  });

  it('reports the rounded-up minute count for longer waits', () => {
    const now = 1_000_000;
    expect(formatAutoResumeEta(now + 5 * 60_000 + 1, now)).toBe(
      'Tubmedia sẽ tự thử tiếp tục sau khoảng 6 phút.'
    );
  });
});
