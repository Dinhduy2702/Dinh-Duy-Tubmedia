import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sharedTempFolderWarning, sharedUserFolderKind } from '@shared/utils/shared-folder-policy.js';

describe('nhận diện thư mục chung không nên dùng làm thư mục tạm', () => {
  it.each([
    ['C:\\Users\\Hi\\Downloads', 'downloads'],
    ['c:\\users\\hi\\downloads\\', 'downloads'],
    ['C:/Users/Hi/Downloads', 'downloads'],
    ['C:\\Users\\Hi\\Desktop', 'desktop'],
    ['C:\\Users\\Hi\\OneDrive\\Desktop', 'desktop'],
    ['C:\\Users\\Hi\\Documents', 'documents'],
    ['C:\\Users\\Hi\\OneDrive\\Tài liệu', null],
    ['C:\\Users\\Hi\\Videos', 'videos'],
    ['C:\\Users\\Hi\\Pictures', 'pictures'],
    ['C:\\Users\\Hi\\Music', 'music'],
    ['C:\\Users\\Hi', 'profile'],
    ['C:\\', 'drive-root'],
    ['E:', 'drive-root'],
    ['E:\\', 'drive-root']
  ])('%s → %s', (path, kind) => {
    expect(sharedUserFolderKind(path)).toBe(kind);
  });

  it.each([
    'C:\\Users\\Hi\\Downloads\\Tubmedia-tam',
    'C:\\Users\\Hi\\Videos\\Download video Tubmedia\\Tệp tạm',
    'E:\\_yt_tmp',
    'E:\\DinhDuy\\NA371\\video',
    ''
  ])('thư mục riêng/con không bị cảnh báo: %s', (path) => {
    expect(sharedUserFolderKind(path)).toBeNull();
  });
});

// Sau phát hành 1.6.0 (2026-10-06) người dùng báo banner lớn đầu trang + dòng chữ dài dưới ô làm lệch bố cục.
// Phương án A đã duyệt: bỏ banner, chỉ giữ nhãn ⚠ nhỏ cạnh tên ô; dữ liệu "Không nhắc lại" đã lưu vẫn giữ nguyên.
describe('cảnh báo thư mục tạm dùng chung chỉ còn nhãn ⚠ nhỏ (phương án A)', () => {
  it('câu giải thích nêu đúng loại thư mục và khuyên dùng thư mục riêng', () => {
    expect(sharedTempFolderWarning('C:\\Users\\Hi\\Downloads')).toMatch(/Tải xuống \(Downloads\).*thư mục riêng/);
    expect(sharedTempFolderWarning('E:\\_yt_tmp')).toBeNull();
  });

  it('khung ứng dụng KHÔNG còn banner lớn đầu trang', () => {
    expect(readFileSync('src/renderer/src/app/App.tsx', 'utf8')).not.toContain('SharedTempFolderNotice');
  });

  it('icon ⚠ cùng hàng với tên ô, câu đầy đủ chỉ trong ô chú thích khi rê chuột/focus + aria-label, không còn dòng chữ dưới ô', () => {
    const field = readFileSync('src/renderer/src/components/FolderField.tsx', 'utf8');
    // 2026-10-08: ô chú thích chuyển sang HoverTip dùng chung (tự chọn phía, nằm gọn trong cửa sổ, aria-label = câu đầy đủ).
    expect(field).toContain('<HoverTip text={sharedWarning} className="shared-folder-chip" tone="warning">');
    expect(field).not.toContain('field-hint-warning');
    const css = readFileSync('src/renderer/src/styles.css', 'utf8');
    expect(css).toContain('.hover-tip-warning{');
  });

  it.each([
    ['src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'label="Thư mục tạm"'],
    ['src/renderer/src/pages/DownloadMergePage.tsx', 'label="Thư mục xử lý tạm"']
  ])('%s: "Không nhắc lại" đã lưu vẫn áp dụng cho ô thư mục tạm của danh sách', (path, label) => {
    const text = readFileSync(path, 'utf8');
    const at = text.indexOf(label);
    expect(text.slice(at, at + 400)).toContain('sharedTempDismissedFolder');
  });

  it('dữ liệu "Không nhắc lại" đã lưu vẫn giữ ở dòng cài đặt riêng (quay lui 1.6.0 an toàn)', () => {
    expect(readFileSync('src/main/database/repositories/settings-repository.ts', 'utf8')).toContain(
      "'dismissedSharedTempWarnings'"
    );
  });
});

describe('cảnh báo được gắn vào đúng chỗ', () => {
  const source = (path: string): string => readFileSync(path, 'utf8');

  it('ô thư mục cảnh báo khi chọn thư mục chung', () => {
    expect(source('src/renderer/src/components/FolderField.tsx')).toContain('sharedUserFolderKind(');
  });

  it.each([
    ['src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'label="Thư mục tạm"'],
    ['src/renderer/src/pages/DownloadMergePage.tsx', 'label="Thư mục xử lý tạm"'],
    ['src/renderer/src/pages/SettingsPage.tsx', 'label="Thư mục tạm mặc định"']
  ])('%s: ô thư mục tạm bật warnIfSharedTemp', (path, label) => {
    const text = source(path);
    const at = text.indexOf(label);
    expect(at).toBeGreaterThan(-1);
    expect(text.slice(Math.max(0, at - 300), at + 400)).toContain('warnIfSharedTemp');
  });
});
