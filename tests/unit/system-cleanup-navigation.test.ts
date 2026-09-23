import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

describe('giao diện dọn dẹp máy (GĐ4a — bỏ UAC/wholeMachine, chỉ quét/phân loại)', () => {
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
    expect(panel).toContain('An toàn có kiểm soát');
    expect(panel).toContain('Dọn dẹp và xóa file đã chọn');
  });

  it('GĐ4a: nút xóa luôn bị khóa cứng, không còn phụ thuộc kết quả quét (chưa cho xóa thật)', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    const buttonBlock = panel.slice(
      panel.indexOf('className="system-cleanup-button primary"'),
      panel.indexOf('className="system-cleanup-button primary"') + 400
    );

    expect(buttonBlock).toMatch(/\bdisabled\b/);
    expect(panel).toContain('Giai đoạn 4b');
    expect(panel).toContain('lastScannedKey === currentScanKey');
  });

  it('không còn quét toàn máy hay huy hiệu yêu cầu UAC (đã bỏ theo quyết định 2026-09-21)', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).not.toContain('Quét và phân loại toàn bộ máy');
    expect(panel).not.toContain('wholeMachine');
    expect(panel).not.toContain('systemCleanupRequiresAdmin');
    expect(panel).toContain('không cần quyền quản trị');
  });

  it('liệt kê các mục cần Admin là chỉ báo cáo, kèm nút mở công cụ của Windows', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('SYSTEM_CLEANUP_ADMIN_INFO_ITEMS');
    expect(panel).toContain('openStorageSettings');
    expect(panel).toContain('Mở Dọn dẹp ổ đĩa Windows');
  });

  it('vẫn bảo vệ các thư mục nguy hiểm đã liệt kê', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('Zalo Received Files');
  });
});
