import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('Lưu cài đặt: lỗi cố định của lần lưu trước không che thông báo thành công', () => {
  it('gỡ lỗi cũ trước khi báo "Đã lưu cài đặt", và chỉ khi lần lưu trước thất bại', async () => {
    const page = await source('src/renderer/src/pages/SettingsPage.tsx');
    const start = page.indexOf('const save = async');
    const end = page.indexOf('const detect = async');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const save = page.slice(start, end);

    const clearStale = save.indexOf('if (lastSaveFailed.current)');
    const clearCall = save.indexOf('setError(null)');
    const success = save.indexOf("createUiEventId('settings-save')");
    expect(clearStale).toBeGreaterThan(-1);
    expect(clearCall).toBeGreaterThan(clearStale);
    expect(success).toBeGreaterThan(clearCall);

    // Lần lưu thất bại phải đánh dấu để lần lưu thành công sau đó biết cần gỡ lỗi cũ.
    const failure = save.slice(save.indexOf('catch (error)'));
    expect(failure).toContain('lastSaveFailed.current = true');
    expect(failure.indexOf('lastSaveFailed.current = true')).toBeLessThan(failure.indexOf('setError(messageOf(error))'));
  });

  it('không gỡ lỗi của tác vụ khác khi lưu thành công lần đầu', async () => {
    const page = await source('src/renderer/src/pages/SettingsPage.tsx');
    expect(page).toContain('const lastSaveFailed = useRef(false);');
    // Cờ chỉ được đặt trong nhánh catch của save; các hàm khác không được tự ý gỡ lỗi chung.
    expect(page.match(/lastSaveFailed\.current = true/g)).toHaveLength(1);
  });
});
