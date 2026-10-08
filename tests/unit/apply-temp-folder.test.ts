import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planApplyTempFolderToAll } from '@shared/utils/apply-temp-folder.js';

// Phần C rà soát giao diện (người dùng duyệt 2026-10-06): nút "Áp dụng cho tất cả danh sách" CHỈ cho Thư mục tạm; phạm vi
// theo từng trang (Tải danh sách / Ghép theo Timeline không trộn); hộp xác nhận liệt kê từng danh sách sẽ đổi; bỏ qua danh
// sách đang chạy; có ô "Đặt làm mặc định cho danh sách mới".

const lanes = [
  { slot: 'download-1', name: 'Danh sách tải 1', tempFolder: 'E:\\tam-moi', locked: false },
  { slot: 'download-2', name: 'Danh sách tải 2', tempFolder: 'C:\\Users\\Hi\\Downloads', locked: false },
  { slot: 'download-3', name: 'Danh sách tải 3', tempFolder: 'D:\\cu', locked: true },
  { slot: 'download-4', name: 'Danh sách tải 4', tempFolder: 'e:\\TAM-MOI\\', locked: false }
];

describe('lập kế hoạch áp dụng thư mục tạm cho tất cả danh sách', () => {
  it('đổi các danh sách khác; bỏ qua danh sách đang chạy/tạm dừng; danh sách đã dùng đúng thư mục thì không đổi', () => {
    const plan = planApplyTempFolderToAll(lanes, 'download-1', 'E:\\tam-moi');
    expect(plan.changes.map((item) => item.slot)).toEqual(['download-2']);
    expect(plan.changes[0]).toMatchObject({ name: 'Danh sách tải 2', from: 'C:\\Users\\Hi\\Downloads' });
    expect(plan.skipped.map((item) => item.slot)).toEqual(['download-3']);
    expect(plan.unchanged.map((item) => item.slot)).toEqual(['download-4']);
  });

  it('dòng mô tả cho hộp xác nhận nêu rõ từng danh sách: từ đâu → sang đâu, và lý do bỏ qua', () => {
    const plan = planApplyTempFolderToAll(lanes, 'download-1', 'E:\\tam-moi');
    expect(plan.details).toEqual([
      'Danh sách tải 2: C:\\Users\\Hi\\Downloads → E:\\tam-moi',
      'Danh sách tải 3: bỏ qua — đang chạy hoặc tạm dừng',
      'Danh sách tải 4: đã dùng thư mục này'
    ]);
  });

  it('không có danh sách nào khác cần đổi → báo rõ, không có thay đổi', () => {
    const plan = planApplyTempFolderToAll([lanes[0]!], 'download-1', 'E:\\tam-moi');
    expect(plan.changes).toEqual([]);
    expect(plan.details).toEqual([]);
  });
});

describe('nối vào giao diện', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('ô thư mục có nút "Áp dụng cho tất cả danh sách" cùng hàng nút Chọn (chỉ khi trang truyền onApplyToAll)', () => {
    const field = read('src/renderer/src/components/FolderField.tsx');
    expect(field).toContain('onApplyToAll');
    expect(field).toContain('className="btn folder-apply-all"');
  });

  it.each([
    ['src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'label="Thư mục tạm"', 'label="Thư mục lưu video"'],
    ['src/renderer/src/pages/DownloadMergePage.tsx', 'label="Thư mục xử lý tạm"', 'label="Thư mục thành phẩm"'],
    ['src/renderer/src/pages/DownloadMergePage.tsx', 'label="Thư mục xử lý tạm"', 'label="Thư mục video nguồn"']
  ])('%s: CHỈ ô thư mục tạm có nút áp dụng cho tất cả', (path, tempLabel, outputLabel) => {
    const page = read(path);
    const temp = page.slice(page.indexOf(tempLabel), page.indexOf(tempLabel) + 600);
    expect(temp).toContain('onApplyToAll');
    const output = page.slice(page.indexOf(outputLabel), page.indexOf(outputLabel) + 400);
    expect(output).not.toContain('onApplyToAll');
    expect(page).toContain('planApplyTempFolderToAll(');
  });

  it('hộp xác nhận có ô "Đặt làm mặc định cho danh sách mới"', () => {
    expect(read('src/renderer/src/components/ConfirmDialog.tsx')).toContain('option?:');
    for (const path of ['src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'src/renderer/src/pages/DownloadMergePage.tsx']) {
      expect(read(path)).toContain('Đặt làm mặc định cho danh sách mới');
    }
  });
});
