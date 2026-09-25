import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveTextTypeFor, withRequiredExtension } from '../../src/main/files/save-text-file-policy.js';

describe('Hộp thoại lưu tệp văn bản: đuôi tệp theo loại đang xuất', () => {
  it.each([
    ['tubmedia-history-2026-09-21.csv', 'csv', 'Tệp CSV'],
    ['tubmedia-history-2026-09-21.json', 'json', 'Tệp JSON'],
    ['Timeline Ghép.txt', 'txt', 'Tệp văn bản'],
    ['TIMELINE.TXT', 'txt', 'Tệp văn bản'],
    ['Lịch sử.CSV', 'csv', 'Tệp CSV']
  ])('%s → %s', (name, extension, filterName) => {
    expect(saveTextTypeFor(name)).toEqual({ extension, filterName });
  });

  it.each(['payload.exe', 'run.bat', 'evil.ps1', 'a.js', 'a.lnk', 'khong-co-duoi', '', '   ', 'a.csv.exe', '.'])(
    'tên gợi ý không an toàn hoặc không có đuôi (%j) vẫn rơi về .txt, không tạo tệp thực thi',
    (name) => {
      expect(saveTextTypeFor(name).extension).toBe('txt');
    }
  );

  it('không thêm đuôi lần hai khi tên đã đúng đuôi (không còn ".csv.txt")', () => {
    expect(withRequiredExtension('D:\\Báo cáo\\lịch sử.csv', 'csv')).toBe('D:\\Báo cáo\\lịch sử.csv');
    expect(withRequiredExtension('D:\\Báo cáo\\lịch sử.JSON', 'json')).toBe('D:\\Báo cáo\\lịch sử.JSON');
  });

  it('thêm đuôi đúng loại khi người dùng gõ tên không có đuôi', () => {
    expect(withRequiredExtension('D:\\Báo cáo\\lịch sử', 'csv')).toBe('D:\\Báo cáo\\lịch sử.csv');
    expect(withRequiredExtension('D:\\a\\b.txt', 'json')).toBe('D:\\a\\b.txt.json');
  });

  it('handler dùng chính sách này thay vì ép .txt', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/ipc/register-ipc.ts'), 'utf8');
    const start = source.indexOf('IPC.dialogs.saveTextFile');
    const block = source.slice(start, start + 900);
    expect(block).toContain('saveTextTypeFor(defaultName)');
    expect(block).toContain('withRequiredExtension(result.filePath, type.extension)');
    expect(block).not.toContain("extensions: ['txt']");
  });
});
