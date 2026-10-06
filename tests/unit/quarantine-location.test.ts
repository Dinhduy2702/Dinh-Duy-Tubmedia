import { describe, expect, it } from 'vitest';
import {
  fallbackQuarantineRootForFile,
  isInsideAnyQuarantineFolder,
  isInsideQuarantineRoot,
  isWindowsReservedName,
  quarantineTargetPath,
  projectQuarantineFolderForFile,
  projectQuarantineFolderName,
  quarantineRootForFile,
  QUARANTINE_README_TEXT,
  UNASSIGNED_QUARANTINE_FOLDER_NAME
} from '../../src/main/files/quarantine-location.js';

// Mục 5 (2026-10-02): khu cách ly thống nhất nằm trên CÙNG Ổ với tệp: <ổ>:\Tubmedia\quarantine\<tên (mã ngắn)>.
describe('vị trí khu cách ly', () => {
  const owner = { id: '4639ff3c-681a-4438-b3cc-6390f91ec80b', name: 'Danh sách 1' };

  it('tệp trên ổ E: → E:\\Tubmedia\\quarantine\\Danh sách 1 (4639ff3c)', () => {
    expect(quarantineRootForFile('E:\\DinhDuy\\NA375\\video\\a.mp4')).toBe('E:\\Tubmedia\\quarantine');
    expect(projectQuarantineFolderForFile('E:\\DinhDuy\\NA375\\video\\a.mp4', owner)).toBe(
      'E:\\Tubmedia\\quarantine\\Danh sách 1 (4639ff3c)'
    );
  });

  it('tệp trên ổ C: ở lại ổ C: — không bao giờ chép chéo ổ', () => {
    expect(projectQuarantineFolderForFile('C:\\Users\\Hi\\Downloads\\x.mp4', owner)).toBe(
      'C:\\Tubmedia\\quarantine\\Danh sách 1 (4639ff3c)'
    );
  });

  it('tên danh sách có ký tự Windows không cho phép vẫn ra tên thư mục hợp lệ, dễ đọc', () => {
    expect(projectQuarantineFolderName({ id: 'abcdef12-0000', name: 'Duy: 29/09 <thử>?*' })).toBe(
      'Duy 29 09 thử (abcdef12)'
    );
    expect(projectQuarantineFolderName({ id: 'abcdef12-0000', name: '  ...  ' })).toBe('Danh sách (abcdef12)');
    expect(projectQuarantineFolderName({ id: 'abcdef12-0000', name: 'Tên rất dài '.repeat(20) }).length).toBeLessThanOrEqual(
      80
    );
  });

  it('tệp không thuộc danh sách nào có thư mục riêng', () => {
    expect(projectQuarantineFolderForFile('E:\\x\\a.mp4', null)).toBe(
      `E:\\Tubmedia\\quarantine\\${UNASSIGNED_QUARANTINE_FOLDER_NAME}`
    );
  });

  it('nhận diện đúng đường dẫn nằm trong khu cách ly, không nhầm thư mục khác', () => {
    expect(isInsideQuarantineRoot('E:\\Tubmedia\\quarantine\\Danh sách 1 (4639ff3c)\\a.mp4')).toBe(true);
    expect(isInsideQuarantineRoot('e:\\tubmedia\\QUARANTINE\\x\\a.mp4')).toBe(true);
    expect(isInsideQuarantineRoot('E:\\Tubmedia\\quarantine')).toBe(false);
    expect(isInsideQuarantineRoot('E:\\Tubmedia\\khac\\a.mp4')).toBe(false);
    expect(isInsideQuarantineRoot('E:\\DinhDuy\\Tubmedia\\quarantine\\a.mp4')).toBe(false);
    expect(isInsideQuarantineRoot('E:\\Tubmedia\\quarantine\\..\\..\\Windows\\a.dll')).toBe(false);
  });

  it('README tiếng Việt: chứa gì, xóa tay có an toàn không, nên xóa qua Dọn dẹp máy', () => {
    expect(QUARANTINE_README_TEXT).toContain('khu cách ly');
    expect(QUARANTINE_README_TEXT).toContain('Có xóa được không');
    expect(QUARANTINE_README_TEXT).toContain('không bao giờ tự xóa');
    expect(QUARANTINE_README_TEXT).toContain('Bản cũ của video nguồn');
    expect(QUARANTINE_README_TEXT).toContain('Xóa trực tiếp bằng File Explorer');
    expect(QUARANTINE_README_TEXT).toContain('Tubmedia → Dọn dẹp máy');
  });

  it('tên dành riêng của Windows (CON, NUL, COM1, LPT9…) không bao giờ thành tên thư mục trần', () => {
    for (const reserved of ['CON', 'nul', 'Aux', 'PRN', 'COM1', 'lpt9', 'CON.txt', 'NUL .']) {
      const folderName = projectQuarantineFolderName({ id: 'abcdef12-0000', name: reserved });
      const stem = folderName.replace(/ \(abcdef12\)$/, '').split('.')[0]!.trim().toUpperCase();
      expect(isWindowsReservedName(stem), `${reserved} → ${folderName}`).toBe(false);
      expect(folderName).toMatch(/ \(abcdef12\)$/);
    }
    expect(isWindowsReservedName('CON')).toBe(true);
    expect(isWindowsReservedName('com1.mp4')).toBe(true);
    expect(isWindowsReservedName('CONSOLE')).toBe(false);
  });

  it('tên tệp trong khu cách ly giữ đường dẫn đầy đủ trong MAX_PATH (260), vẫn giữ đuôi tệp', () => {
    const folder = projectQuarantineFolderForFile('E:\\x\\a.mp4', { id: 'abcdef12-0000', name: 'Tên rất dài '.repeat(20) });
    const longName = `${'Video rất rất dài '.repeat(30)}.mp4`;
    const target = quarantineTargetPath(folder, longName, '1700000000000-abcd1234');
    expect(target.length).toBeLessThan(260);
    expect(target.endsWith('.mp4')).toBe(true);
    expect(target.startsWith(`${folder}\\1700000000000-abcd1234-Video`)).toBe(true);
    // tên ngắn giữ nguyên
    expect(quarantineTargetPath(folder, 'a.mp4', 'p')).toBe(`${folder}\\p-a.mp4`);
  });

  it('thư mục lùi khi gốc ổ không ghi được: <thành phẩm>\\Tubmedia\\quarantine nếu cùng ổ, nếu không thì cạnh tệp', () => {
    expect(fallbackQuarantineRootForFile('E:\\DinhDuy\\NA375\\video\\a.mp4', 'E:\\DinhDuy\\NA375\\out')).toBe(
      'E:\\DinhDuy\\NA375\\out\\Tubmedia\\quarantine'
    );
    expect(fallbackQuarantineRootForFile('E:\\DinhDuy\\NA375\\video\\a.mp4', 'D:\\out')).toBe(
      'E:\\DinhDuy\\NA375\\video\\Tubmedia\\quarantine'
    );
    expect(fallbackQuarantineRootForFile('E:\\DinhDuy\\NA375\\video\\a.mp4', null)).toBe(
      'E:\\DinhDuy\\NA375\\video\\Tubmedia\\quarantine'
    );
  });

  it('nhận diện mọi khu cách ly Tubmedia (gốc ổ hoặc thư mục lùi), không nhầm chính thư mục hay đường đi ngược', () => {
    expect(isInsideAnyQuarantineFolder('E:\\Tubmedia\\quarantine\\DS (1)\\a.mp4')).toBe(true);
    expect(isInsideAnyQuarantineFolder('E:\\DinhDuy\\out\\Tubmedia\\quarantine\\DS (1)\\a.mp4')).toBe(true);
    expect(isInsideAnyQuarantineFolder('E:\\DinhDuy\\out\\Tubmedia\\quarantine')).toBe(false);
    expect(isInsideAnyQuarantineFolder('E:\\DinhDuy\\out\\Tubmedia\\khac\\a.mp4')).toBe(false);
    expect(isInsideAnyQuarantineFolder('E:\\Tubmedia\\quarantine\\..\\..\\Windows\\a.dll')).toBe(false);
  });
});
