import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

describe('giao diện dọn dẹp máy', () => {
  it('có mục điều hướng và route riêng', () => {
    const sidebar = read('src/renderer/src/layout/Sidebar.tsx');
    const app = read('src/renderer/src/app/App.tsx');
    const store = read('src/renderer/src/stores/app-store.ts');

    expect(sidebar).toContain("id: 'cleanup'");
    expect(sidebar).toContain("label: 'Dọn dẹp máy'");
    expect(app).toContain("page === 'cleanup'");
    expect(app).toContain('SystemCleanupPage');
    expect(store).toContain("'cleanup'");
  });

  it('hiển thị dung lượng, độ an toàn và mức độ cần dọn', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('Dung lượng tìm thấy');
    expect(panel).toContain('Mức độ cần dọn');
    expect(panel).toContain('Rất an toàn');
    expect(panel).toContain('Cần kiểm tra');
    expect(panel).toContain('Thay đổi hệ thống');
    expect(panel).toContain('Dọn dẹp và xóa file đã chọn');
  });

  it('khóa thao tác xóa cho đến khi quét đúng lựa chọn', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('lastScannedKey === currentScanKey');
    expect(panel).toContain('disabled={!canClean}');
    expect(panel).toContain('Phải quét đúng lựa chọn hiện tại trước khi xóa');
  });
});
