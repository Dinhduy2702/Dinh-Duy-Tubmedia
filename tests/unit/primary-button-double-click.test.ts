import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

// Nút chính của mỗi làn đổi vai tại chỗ: "Bắt đầu" → (vài chục mili giây sau) "Tạm dừng danh sách/quy trình".
// Bấm đôi khiến cú click thứ hai trúng nút Tạm dừng và làn kẹt ở trạng thái paused, chưa tải gì.
describe('Nút chính của làn Tải/Ghép bỏ qua cú click thứ hai của thao tác bấm đôi', () => {
  it.each([
    'src/renderer/src/pages/DownloadWorkbenchPage.tsx',
    'src/renderer/src/pages/DownloadMergePage.tsx'
  ])('%s chặn event.detail > 1 trước khi chạy primary.action', async (file) => {
    const page = await source(file);
    const handler = page.indexOf('onClick={(event) => {');
    expect(handler).toBeGreaterThan(-1);
    const block = page.slice(handler, handler + 500);

    const guard = block.indexOf('if (event.detail > 1) return;');
    const action = block.indexOf('void primary.action();');
    expect(guard).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(guard);
    // Không còn kiểu gọi trực tiếp không kiểm tra số lần click.
    expect(page).not.toContain('onClick={() => void primary.action()}');
  });
});
