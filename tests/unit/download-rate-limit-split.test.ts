import { describe, expect, it } from 'vitest';
import { splitRateLimitPerStream } from '@shared/utils/download-pacing.js';

describe('V11 — chia giới hạn băng thông rateLimit theo số luồng tải thực tế', () => {
  it('giữ nguyên rateLimit khi chỉ có 1 luồng tải', () => {
    expect(splitRateLimitPerStream('10M', 1)).toBe('10M');
    expect(splitRateLimitPerStream('500K', 1)).toBe('500K');
  });

  it('chia đều rateLimit khi có nhiều luồng tải đồng thời để không vượt giới hạn tổng', () => {
    // 10M = 10240K / 4 = 2560K
    expect(splitRateLimitPerStream('10M', 4)).toBe('2560K');
    // 4M = 4096K / 2 = 2048K
    expect(splitRateLimitPerStream('4M', 2)).toBe('2048K');
    // 1000K / 4 = 250K
    expect(splitRateLimitPerStream('1000K', 4)).toBe('250K');
  });

  it('kẹp sàn an toàn tối thiểu 50K và trả undefined khi rỗng', () => {
    expect(splitRateLimitPerStream('100K', 10)).toBe('50K');
    expect(splitRateLimitPerStream('', 3)).toBeUndefined();
    expect(splitRateLimitPerStream(undefined, 3)).toBeUndefined();
  });
});
