import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSV_UTF8_BOM, buildCsv, escapeCsvCell } from '../../src/shared/utils/csv.js';

describe('CSV xuất từ Lịch sử', () => {
  it('bắt đầu bằng BOM UTF-8 để Excel đọc đúng tiếng Việt', () => {
    const csv = buildCsv([['Thời gian', 'Dự án']]);
    expect(csv.startsWith(CSV_UTF8_BOM)).toBe(true);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('bọc ô trong nháy kép và nhân đôi nháy bên trong', () => {
    expect(escapeCsvCell('a "b" c')).toBe('"a ""b"" c"');
    expect(escapeCsvCell('xuống\ndòng, có dấu phẩy')).toBe('"xuống\ndòng, có dấu phẩy"');
    expect(escapeCsvCell('')).toBe('""');
  });

  it.each([
    '=HYPERLINK("http://evil.example","bấm vào")',
    '=1+1',
    '+SUM(A1:A9)',
    '-2+3',
    '@SUM(1+1)',
    '\t=cmd|calc',
    '\r=cmd|calc'
  ])('chặn chèn công thức: %j', (value) => {
    const cell = escapeCsvCell(value);
    expect(cell.startsWith('"\'')).toBe(true);
    expect(cell).not.toMatch(/^"[=+\-@\t\r]/);
  });

  it.each(['2026-09-21T09:14:23.844Z', 'C:\\Users\\Hi\\Videos\\clip.mp4', 'https://example.com/v', 'Toàn ứng dụng', 'completed'])(
    'không đổi nội dung bình thường: %s',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"${value}"`);
    }
  );

  it('ghép hàng bằng dấu phẩy và CRLF', () => {
    expect(buildCsv([['a', 'b'], ['c', '=d']])).toBe(`${CSV_UTF8_BOM}"a","b"\r\n"c","'=d"`);
  });

  it('trang Lịch sử dùng buildCsv chung, không còn hàm escape riêng', async () => {
    const page = await readFile(join(process.cwd(), 'src/renderer/src/pages/HistoryPage.tsx'), 'utf8');
    expect(page).toContain('buildCsv([header, ...rows])');
    expect(page).not.toContain('function escapeCsv');
  });
});
