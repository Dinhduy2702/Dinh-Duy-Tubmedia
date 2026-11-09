import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.7.6 (người dùng yêu cầu 2026-11-09, ngoài danh sách D ban đầu): main-window.ts mở link ngoài bằng
// `void shell.openExternal(url)` — Windows không mở được (không có trình duyệt mặc định, link bị chặn…) thì promise bị từ chối
// và thành unhandled rejection. Phải đi qua runDetached (bắt lỗi + ghi nhật ký) như các lời gọi chạy ngầm khác.

describe('main-window: mở link ngoài có bắt lỗi', () => {
  const source = readFileSync('src/main/windows/main-window.ts', 'utf8');

  it('không còn "void shell.openExternal" trần', () => {
    expect(source).not.toContain('void shell.openExternal(');
  });

  it('mở link qua runDetached, vẫn chỉ cho link https', () => {
    expect(source).toMatch(/if \(url\.startsWith\('https:\/\/'\)\) runDetached\(\(\) => shell\.openExternal\(url\)/);
  });
});
