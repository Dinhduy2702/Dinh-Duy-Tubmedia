import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

describe('giao diện dọn dẹp máy (bỏ UAC/wholeMachine; quét → xác nhận → cách ly → hoàn tác)', () => {
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

  it('khóa thao tác xóa cho đến khi quét đúng lựa chọn, rồi mở qua hộp xác nhận (không dùng window.confirm)', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('lastScannedKey === currentScanKey');
    expect(panel).toContain('disabled={!canClean}');
    expect(panel).toContain('onClick={() => setConfirmOpen(true)}');
    expect(panel).toContain('<ConfirmDialog');
    expect(panel).not.toMatch(/window\.(?:confirm|prompt|alert)\(/);
  });

  it('hộp xác nhận xóa hiển thị rõ số lượng, dung lượng theo từng hạng mục và có thể hoàn tác', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('confirmDetails');
    expect(panel).toContain('result.matchedItems');
    expect(panel).toContain('QUARANTINE_RETENTION_DAYS');
    expect(panel).toContain('khu cách ly');
  });

  it('có mục "đã cách ly gần đây" với hoàn tác từng mục, hoàn tác đã chọn và hoàn tác tất cả', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');

    expect(panel).toContain('quarantineList');
    expect(panel).toContain('quarantineRestore');
    expect(panel).toContain('Hoàn tác đã chọn');
    expect(panel).toContain('Hoàn tác tất cả');
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
