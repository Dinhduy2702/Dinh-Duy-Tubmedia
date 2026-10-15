import { describe, expect, it } from 'vitest';
import { downloadPacingArgs } from '../../src/shared/utils/download-pacing.js';

// Hướng C kế hoạch 429 (2026-10-13): trước đây yt-dlp không nghỉ giữa các yêu cầu dù nhiều video cùng nền tảng tải song song.

const busy = (samePlatformActive: number, rateLimitStrikes = 0) => ({ samePlatformActive, rateLimitStrikes });
const BUSY = ['--sleep-requests', '1', '--sleep-interval', '1', '--max-sleep-interval', '3'];
const AFTER_429 = ['--sleep-requests', '2', '--sleep-interval', '3', '--max-sleep-interval', '8'];

describe('giãn nhịp chủ động với nền tảng (hướng C 429)', () => {
  it('một video lẻ không bị nghỉ; từ 2 video cùng nền tảng thì nghỉ ~1 s giữa yêu cầu và 1–3 s trước mỗi lần tải', () => {
    expect(downloadPacingArgs('youtube', busy(1))).toEqual([]);
    expect(downloadPacingArgs('youtube', busy(2))).toEqual(BUSY);
    expect(downloadPacingArgs('youtube', busy(6))).toEqual(BUSY);
    expect(downloadPacingArgs('facebook', busy(4))).toEqual(BUSY);
  });

  it('nền tảng vừa dính 429: nghỉ lâu hơn, kể cả với một video lẻ', () => {
    expect(downloadPacingArgs('youtube', busy(1, 1))).toEqual(AFTER_429);
    expect(downloadPacingArgs('tiktok', busy(5, 3))).toEqual(AFTER_429);
  });

  it('link tệp trực tiếp (máy chủ thường) và khi chưa rõ nền tảng: không nghỉ như cũ', () => {
    for (const platform of ['cdn.example.com', '127.0.0.1:8080', null]) {
      expect(downloadPacingArgs(platform, busy(6, 2))).toEqual([]);
    }
  });

  it('không có thông tin từ hàng đợi thì coi như một video lẻ', () => {
    expect(downloadPacingArgs('youtube', undefined)).toEqual([]);
  });
});
