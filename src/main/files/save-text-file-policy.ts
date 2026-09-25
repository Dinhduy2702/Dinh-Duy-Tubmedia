import { extname } from 'node:path';

/**
 * Hộp thoại "Lưu tệp văn bản" chỉ được ghi ba loại đuôi an toàn. Đuôi lấy từ tên gợi ý của giao diện
 * (ví dụ tubmedia-history-2026-09-21.csv) để bộ lọc và đuôi tệp khớp với thứ đang xuất; mọi tên
 * khác (kể cả .exe, .bat...) rơi về .txt như trước, nên kênh này không thể tạo tệp thực thi.
 */
const SAVE_TEXT_TYPES = {
  '.txt': 'Tệp văn bản',
  '.csv': 'Tệp CSV',
  '.json': 'Tệp JSON'
} as const;

export type SaveTextExtension = 'txt' | 'csv' | 'json';

export interface SaveTextType {
  extension: SaveTextExtension;
  filterName: string;
}

export function saveTextTypeFor(defaultName: string): SaveTextType {
  const suggested = extname(defaultName.trim()).toLowerCase();
  const key: keyof typeof SAVE_TEXT_TYPES = suggested in SAVE_TEXT_TYPES ? (suggested as keyof typeof SAVE_TEXT_TYPES) : '.txt';
  return { extension: key.slice(1) as SaveTextExtension, filterName: SAVE_TEXT_TYPES[key] };
}

/** Thêm đuôi bắt buộc nếu người dùng gõ tên không có đuôi; không thêm lần hai nếu đã đúng đuôi. */
export function withRequiredExtension(filePath: string, extension: SaveTextExtension): string {
  return filePath.toLowerCase().endsWith(`.${extension}`) ? filePath : `${filePath}.${extension}`;
}
