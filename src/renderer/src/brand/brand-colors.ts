/**
 * Màu nhận diện đo từ logo-tubmedia.png (xem docs/brand/BO_NHAN_DIEN.md).
 * Mã màu ghi KHÔNG kèm '#': chỉ để HIỂN THỊ; màu thật luôn đi qua biến CSS (cssVar, định nghĩa trong brand.css).
 */
export const BRAND_COLORS = [
  { id: 'red', name: 'Đỏ logo', hex: 'DB2B23', cssVar: '--logo-red', use: 'Chỉ huy hiệu trong logo. Không dùng làm màu báo lỗi hay màu nhấn.' },
  { id: 'play', name: 'Nút play', hex: 'F9F9F9', cssVar: '--logo-play', use: 'Tam giác trong huy hiệu.' },
  { id: 'paper', name: 'Trắng chữ', hex: 'FAFAF9', cssVar: '--logo-paper', use: 'Chữ và thanh của logo — chỉ trên nền tối.' },
  { id: 'ink', name: 'Đen logo', hex: '262626', cssVar: '--logo-ink', use: 'Chữ và thanh của logo trên nền sáng; bản một màu đen than.' },
  { id: 'charcoal', name: 'Đen than giao diện', hex: '1C1C1E', cssVar: '--logo-charcoal', use: 'Nền thanh bên và nền tối chuẩn để đặt logo chữ trắng.' }
] as const;

/** Đỏ báo lỗi của giao diện (khác đỏ logo): luôn kèm biểu tượng ⊗ và nhãn "Lỗi". */
export const ERROR_RED_HEX = 'B3261E';

/** Cỡ tối thiểu (px) đã kiểm bằng ảnh kích thước nhỏ. */
export const LOGO_MIN_SIZE = { markWidth: 16, horizontalHeight: 32, verticalHeight: 96 } as const;
