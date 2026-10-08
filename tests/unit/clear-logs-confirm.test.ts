import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Đợt 3 mục 9 (rà soát bản cài 1.5.0): xóa nhật ký phải hỏi xác nhận trong giao diện (trước đây bấm là xóa ngay).
const read = (path: string): string => readFileSync(path, 'utf8');

describe('xóa nhật ký hỏi xác nhận', () => {
  it.each([
    ['src/renderer/src/pages/LogsPage.tsx', "title={projectId === 'all' ? 'Xóa toàn bộ nhật ký?'"],
    ['src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'Xóa nhật ký danh sách tải ${'],
    ['src/renderer/src/pages/DownloadMergePage.tsx', 'Xóa nhật ký quy trình ghép ${']
  ])('%s: nút xóa mở ConfirmDialog, chỉ xóa khi bấm xác nhận', (path, title) => {
    const page = read(path);
    expect(page).toContain('<ConfirmDialog');
    expect(page).toContain(title);
    expect(page).toContain('confirmLabel="Xóa nhật ký"');
    // Nút trên giao diện chỉ mở hộp, không gọi xóa trực tiếp.
    expect(page).not.toMatch(/onClick=\{\(\) => void (clearSelected|onClearLogs)\(\)\}/);
  });
});
