import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenLanesNote, laneFormWhenShown } from '../../src/shared/utils/merge-lane-visibility.js';

const workbench = readFileSync(join(process.cwd(), 'src/renderer/src/pages/DownloadWorkbenchPage.tsx'), 'utf8');

describe('#26: đồng bộ xác nhận ẩn danh sách đang có dữ liệu và bảo toàn thư mục/số luồng ở Tải danh sách', () => {
  it('DownloadWorkbenchPage hỏi xác nhận khi ẩn danh sách còn dữ liệu và hiện thông báo danh sách đang ẩn', () => {
    expect(workbench).toContain('hiddenLanesWithData(');
    expect(workbench).toContain('hiddenLanesNote(');
    expect(workbench).toContain('setHideLaneCount(nextCount)');
    expect(workbench).toContain('confirmLabel="Ẩn danh sách"');
  });

  it('DownloadWorkbenchPage dùng laneFormWhenShown để bảo toàn thư mục và số luồng riêng khi mở lại', () => {
    expect(workbench).toContain('laneFormWhenShown(');
  });

  it('hiddenLanesNote hỗ trợ nhãn tùy biến cho danh sách tải', () => {
    const note = hiddenLanesNote(['Danh sách tải 2'], {
      itemLabel: 'danh sách',
      addButtonLabel: 'Thêm danh sách'
    });
    expect(note).toContain('danh sách "Danh sách tải 2"');
    expect(note).toContain('Thêm danh sách');
  });

  it('laneFormWhenShown giữ nguyên thư mục và downloadWorkers của danh sách đã có dữ liệu', () => {
    const existing = {
      outputFolder: 'E:\\Rieng\\2',
      tempFolder: 'E:\\Tam\\2',
      resourceProfileId: 'resource-download-2-custom',
      downloadWorkers: 6
    };
    const fill = {
      outputFolder: 'E:\\Chung\\1',
      tempFolder: 'E:\\Tam\\1',
      resourceProfileId: 'resource-balanced',
      downloadWorkers: 2
    };
    expect(laneFormWhenShown(existing, fill, true)).toEqual(existing);
    expect(laneFormWhenShown(existing, fill, false)).toEqual(fill);
  });
});
