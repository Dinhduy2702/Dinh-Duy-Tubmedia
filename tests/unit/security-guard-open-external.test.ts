import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.7.6 (người dùng duyệt 2026-11-09): electron-security-guard.ts mở link ngoài ở 2 chỗ (cửa sổ mới, điều hướng ra ngoài)
// bằng `void shell.openExternal(url)` — Windows không mở được thì promise bị từ chối và thành unhandled rejection. Giống
// main-window.ts (4ba3420): đi qua runDetached, vẫn chỉ mở link https.

describe('electron-security-guard: mở link ngoài có bắt lỗi', () => {
  const source = readFileSync('src/main/runtime/electron-security-guard.ts', 'utf8');

  it('không còn "void shell.openExternal" trần', () => {
    expect(source).not.toContain('void shell.openExternal(');
  });

  it('cả 2 chỗ (cửa sổ mới, điều hướng ra ngoài) mở qua runDetached sau khi kiểm link https', () => {
    const guarded = source.match(/if \(isSafeExternalUrl\(url\)\) runDetached\(\(\) => shell\.openExternal\(url\)/g) ?? [];
    expect(guarded.length).toBe(2);
  });
});
