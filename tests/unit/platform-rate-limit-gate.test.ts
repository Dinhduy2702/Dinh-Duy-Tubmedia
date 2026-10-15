import { describe, expect, it } from 'vitest';
import { PlatformRateLimitGate } from '@main/queue/platform-rate-limit-gate.js';
import { RATE_LIMIT_RAMP_CLEAR_AT } from '@shared/utils/rate-limit-backoff.js';

// Hướng B (kế hoạch 429 đã duyệt 2026-10-10): trạng thái nghỉ theo NỀN TẢNG trên toàn app — một danh sách dính 429 thì mọi
// danh sách (cả làn ghép) ngừng BẮT ĐẦU video mới của nền tảng đó; hết giờ thì tự tiếp tục với 1 video một lúc rồi tăng dần.

const MIN = 60_000;
const gate = (): PlatformRateLimitGate => new PlatformRateLimitGate(() => 0.5);

describe('PlatformRateLimitGate', () => {
  it('chưa dính 429 → không chặn gì', () => {
    const g = gate();
    expect(g.canStart('youtube', 10, 0)).toBe(true);
    expect(g.snapshot(0)).toEqual([]);
  });

  it('dính 429 → chặn MỌI video mới của nền tảng đó (không chỉ một danh sách) tới hết giờ; nền tảng khác không bị ảnh hưởng', () => {
    const g = gate();
    const hit = g.recordHit('youtube', 0, 1_000);
    expect(hit).toEqual({ kind: 'cooldown', strikes: 1, resumeAt: 1_000 + 2 * MIN });
    expect(g.canStart('youtube', 0, 1_000 + 2 * MIN - 1)).toBe(false);
    expect(g.canStart('tiktok', 0, 1_000 + 60_000)).toBe(true);
    expect(g.snapshot(1_000 + MIN)).toEqual([
      { platform: 'youtube', label: 'YouTube', resumeAt: 1_000 + 2 * MIN, stopped: false, strikes: 1, rampLimit: null }
    ]);
  });

  it('hết giờ → tự tiếp tục với 1 video một lúc, mỗi video tải xong thêm 1, đủ mức thì bỏ hẳn giới hạn và xóa chuỗi', () => {
    const g = gate();
    g.recordHit('youtube', 0, 0);
    const resumedAt = 2 * MIN;
    expect(g.canStart('youtube', 0, resumedAt)).toBe(true);
    expect(g.takeResumed()).toEqual(['youtube']);
    expect(g.canStart('youtube', 1, resumedAt + 1)).toBe(false);
    for (let done = 1; done < RATE_LIMIT_RAMP_CLEAR_AT; done += 1) {
      g.recordSuccess('youtube');
      expect(g.canStart('youtube', done, resumedAt + 1)).toBe(true);
      expect(g.canStart('youtube', done + 1, resumedAt + 1)).toBe(false);
    }
    g.recordSuccess('youtube');
    expect(g.canStart('youtube', 99, resumedAt + 1)).toBe(true);
    expect(g.snapshot(resumedAt + 1)).toEqual([]);
    expect(g.recordHit('youtube', resumedAt + 2, resumedAt + 3)).toMatchObject({ kind: 'cooldown', strikes: 1 });
  });

  it('video đang tải dở từ TRƯỚC lúc nghỉ cũng dính 429 → không tính thêm lần, không kéo dài thời gian chờ', () => {
    const g = gate();
    g.recordHit('youtube', 0, 10_000);
    expect(g.recordHit('youtube', 5_000, 12_000)).toEqual({ kind: 'ignored' });
    expect(g.snapshot(12_000)[0]).toMatchObject({ strikes: 1, resumeAt: 10_000 + 2 * MIN });
  });

  it('dính lại sau khi tự tiếp tục → 5 phút, rồi 15 phút, lần thứ 4 → dừng hẳn (không tự thử lại nữa)', () => {
    const g = gate();
    let now = 0;
    expect(g.recordHit('youtube', 0, now)).toMatchObject({ strikes: 1, resumeAt: now + 2 * MIN });
    now += 2 * MIN;
    g.canStart('youtube', 0, now);
    expect(g.recordHit('youtube', now + 1, now + 10)).toMatchObject({ kind: 'cooldown', strikes: 2, resumeAt: now + 10 + 5 * MIN });
    now += 10 + 5 * MIN;
    g.canStart('youtube', 0, now);
    expect(g.recordHit('youtube', now + 1, now + 10)).toMatchObject({ kind: 'cooldown', strikes: 3, resumeAt: now + 10 + 15 * MIN });
    now += 10 + 15 * MIN;
    g.canStart('youtube', 0, now);
    expect(g.recordHit('youtube', now + 1, now + 10)).toEqual({ kind: 'stopped', strikes: 4 });
    expect(g.canStart('youtube', 0, now + 60 * MIN)).toBe(false);
    expect(g.snapshot(now + 11)[0]).toMatchObject({ stopped: true, resumeAt: null });
  });

  it('người dùng bấm Tiếp tục sau khi đã dừng hẳn → xóa trạng thái nền tảng, tải lại bình thường', () => {
    const g = gate();
    g.recordHit('youtube', 0, 0);
    g.clear('youtube');
    expect(g.canStart('youtube', 5, 1)).toBe(true);
    expect(g.snapshot(1)).toEqual([]);
  });

  it('thời gian chờ thay thế (chỉ e2e) áp cho mọi vòng', () => {
    const g = new PlatformRateLimitGate(() => 0.5, 3_000);
    expect(g.recordHit('127.0.0.1', 0, 100)).toEqual({ kind: 'cooldown', strikes: 1, resumeAt: 3_100 });
  });
});
