/** Excel chỉ đọc đúng tiếng Việt trong CSV UTF-8 khi tệp bắt đầu bằng BOM. */
export const CSV_UTF8_BOM = '﻿';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Một ô CSV: bọc trong dấu nháy kép, nhân đôi dấu nháy bên trong, và chặn chèn công thức
 * (giá trị bắt đầu bằng = + - @ tab CR sẽ được Excel/Sheets thực thi, ví dụ =HYPERLINK(...)) bằng
 * cách thêm dấu nháy đơn phía trước theo khuyến nghị của OWASP.
 */
export function escapeCsvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Ghép các hàng thành nội dung CSV UTF-8 có BOM, dòng kết thúc CRLF (chuẩn RFC 4180, Excel đọc tốt). */
export function buildCsv(rows: readonly (readonly string[])[]): string {
  return CSV_UTF8_BOM + rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}
