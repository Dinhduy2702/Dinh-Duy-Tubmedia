import type { CSSProperties } from 'react';

/**
 * Kiểu inline cho phần tô của thanh tiến độ: dùng `transform: scaleX()` thay vì `width`, vì scale là
 * thuộc tính compositor-only (không gây tính lại bố cục/vẽ lại), đúng hệ chuyển động GĐ 2a
 * (chỉ animate transform/opacity). `.progress > span` có `width: 100%; transform-origin: left` sẵn
 * trong CSS (xem motion.css); hàm này chỉ trả về phần scale theo phần trăm.
 */
export function progressFillStyle(percent: number): CSSProperties {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return { transform: `scaleX(${(clamped / 100).toFixed(4)})` };
}
