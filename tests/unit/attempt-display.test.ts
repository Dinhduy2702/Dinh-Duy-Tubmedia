import { describe, expect, it } from 'vitest';
import { displayedAttempt } from '@shared/utils/attempt-display.js';

describe('hiển thị "Lần thử N/M" theo cách đếm mới (attempts = số lượt đã thất bại)', () => {
  it('lượt đầu đang chạy hiện 1/3, không phải 0/3', () => {
    expect(displayedAttempt({ status: 'downloading', attempts: 0, maxAttempts: 3 })).toBe(1);
  });

  it('đã thất bại hẳn sau 3 lượt hiện 3/3', () => {
    expect(displayedAttempt({ status: 'failed', attempts: 3, maxAttempts: 3 })).toBe(3);
  });

  it('đang chờ thử lại sau 1 lượt lỗi hiện 1/3; hoàn tất ở lượt 2 hiện 2/3', () => {
    expect(displayedAttempt({ status: 'retrying', attempts: 1, maxAttempts: 3 })).toBe(1);
    expect(displayedAttempt({ status: 'completed', attempts: 1, maxAttempts: 3 })).toBe(2);
  });

  it('không bao giờ vượt quá giới hạn (dữ liệu cũ 4/3 không làm hiện 5/3)', () => {
    expect(displayedAttempt({ status: 'downloading', attempts: 3, maxAttempts: 3 })).toBe(3);
  });
});
