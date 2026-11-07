import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.7.6 việc D: index.ts:181 (bấm X) và main-window.ts:56/58 (nạp giao diện) gọi promise "void" trần, lỗi không ai bắt.
// Đỏ trên mã cũ (còn "void" trần), xanh khi đã chuyển sang runDetached (xem detached-task.test.ts).

describe('các chỗ rủi ro đã dùng lời gọi có bắt lỗi', () => {
  it('index.ts: bấm X (requestClose) không còn gọi "void" trần', () => {
    const source = readFileSync('src/main/index.ts', 'utf8');
    expect(source).not.toContain('void requestClose(window);');
    expect(source).toMatch(/runDetached\(\s*\(\) => requestClose\(window\)/);
  });

  it('main-window.ts: nạp giao diện (loadURL/loadFile) không còn "void" trần', () => {
    const source = readFileSync('src/main/windows/main-window.ts', 'utf8');
    expect(source).not.toContain('void window.loadURL(');
    expect(source).not.toContain('void window.loadFile(');
    expect(source).toContain('runDetached(');
  });
});
