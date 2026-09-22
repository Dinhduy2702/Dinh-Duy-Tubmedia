import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workbenchSource = readFileSync(join(root, 'src/renderer/src/pages/DownloadWorkbenchPage.tsx'), 'utf8');
const mergeSource = readFileSync(join(root, 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');

/** Nội dung hàm (từ dòng khớp `marker` tới `length` ký tự sau đó). */
function block(source: string, marker: string, length = 2_500): string {
  const start = source.indexOf(marker);
  expect(start, `không thấy "${marker}"`).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + length);
}

describe('Vấn đề 1 (GĐ 2b, 2026-09-22) — đổi số danh sách/quy trình không còn bắn thông báo nổi', () => {
  it('"Tải danh sách": changeLaneCount không còn gọi notify() khi đổi số danh sách thành công', () => {
    const fn = block(workbenchSource, 'const changeLaneCount = async');
    expect(fn).toContain("window.desktop.settings.update({ downloadLaneCount: nextCount })");
    // Đúng NGUYÊN VẸN vẫn lưu cài đặt (không đổi logic) — chỉ bỏ thông báo nổi thành công.
    expect(fn).toContain('setSettings(nextSettings);');
    expect(fn).not.toMatch(/setSettings\(nextSettings\);\s*notify\(/);
    expect(fn).not.toContain('Đã thay đổi số danh sách');
    // Cảnh báo THẬT (danh sách sắp ẩn vẫn đang chạy) vẫn phải còn — đây là sự kiện cần biết, không phải spam.
    expect(fn).toContain("showNotice('warning', 'Danh sách đang chạy'");
  });

  it('"Ghép theo Timeline": changeLaneCount không còn gọi notify() khi đổi số quy trình thành công', () => {
    const fn = block(mergeSource, 'const changeLaneCount = async', 2_000);
    expect(fn).toContain('window.desktop.settings.update({ mergeLaneCount: nextCount })');
    expect(fn).toContain('setSettings(next);');
    expect(fn).not.toMatch(/setSettings\(next\);\s*notify\(/);
    expect(fn).not.toContain('Đã thay đổi số quy trình ghép');
    expect(fn).toContain("'Quy trình ghép đang chạy'");
  });

  it('các thông báo cho hành động rõ ràng của người dùng (bắt đầu/tạm dừng/xóa/áp dụng đề xuất) vẫn còn nguyên', () => {
    // Không xóa nhầm các notify() hợp lệ khác trong cùng file — chỉ bỏ đúng 2 chỗ đổi số danh sách/quy trình.
    expect(workbenchSource).toContain('Đã áp dụng đề xuất theo máy');
    expect(mergeSource).toContain('Đã áp dụng giới hạn ghép theo máy');
  });
});
