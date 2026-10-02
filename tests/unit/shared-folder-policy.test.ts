import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSharedTempFolderNotice, sharedUserFolderKind } from '@shared/utils/shared-folder-policy.js';

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

describe('thông báo khi mở app: danh sách dùng thư mục chung làm thư mục tạm', () => {
  it('liệt kê đúng các danh sách, nói rõ KHÔNG tự di chuyển dữ liệu', () => {
    const notice = buildSharedTempFolderNotice([
      { id: 'p1', name: 'Danh sách tải 1', tempFolder: 'C:\\Users\\Hi\\Downloads' },
      { id: 'p2', name: 'Danh sách tải 2', tempFolder: 'C:\\Users\\Hi\\Downloads' },
      { id: 'p3', name: 'Duy_29_09_2026', tempFolder: 'E:\\_yt_tmp' }
    ]);
    expect(notice).not.toBeNull();
    expect(notice!.items.map((item) => item.name)).toEqual(['Danh sách tải 1', 'Danh sách tải 2']);
    expect(notice!.message).toMatch(/không tự di chuyển/i);
  });

  it('không có danh sách nào dùng thư mục chung: không thông báo', () => {
    expect(buildSharedTempFolderNotice([{ id: 'a', name: 'A', tempFolder: 'E:\\_yt_tmp' }])).toBeNull();
  });

  it('"Không nhắc lại cho danh sách này": bỏ đúng danh sách đó, các danh sách khác vẫn được nhắc', () => {
    const notice = buildSharedTempFolderNotice(
      [
        { id: 'p1', name: 'Danh sách tải 1', tempFolder: 'C:\\Users\\Hi\\Downloads' },
        { id: 'p2', name: 'Danh sách tải 2', tempFolder: 'C:\\Users\\Hi\\Downloads' }
      ],
      { p1: 'C:\\Users\\Hi\\Downloads' }
    );
    expect(notice!.items.map((item) => item.id)).toEqual(['p2']);
    expect(
      buildSharedTempFolderNotice([{ id: 'p1', name: 'A', tempFolder: 'C:\\Users\\Hi\\Downloads' }], {
        p1: 'C:\\Users\\Hi\\Downloads'
      })
    ).toBeNull();
  });

  it('đã tắt nhắc nhưng sau đó đổi sang một thư mục chung KHÁC: nhắc lại', () => {
    const notice = buildSharedTempFolderNotice([{ id: 'p1', name: 'A', tempFolder: 'C:\\Users\\Hi\\Desktop' }], {
      p1: 'C:\\Users\\Hi\\Downloads'
    });
    expect(notice!.items.map((item) => item.id)).toEqual(['p1']);
  });
});

describe('lựa chọn "Không nhắc lại" được lưu bền theo từng danh sách', () => {
  it('thông báo có nút cho từng danh sách và lưu vào cài đặt dismissedSharedTempWarnings', () => {
    const text = readFileSync('src/renderer/src/components/SharedTempFolderNotice.tsx', 'utf8');
    expect(text).toContain('Không nhắc lại cho danh sách này');
    expect(text).toContain('dismissedSharedTempWarnings');
    expect(text).toContain('settings.update(');
  });

  it('được lưu ở dòng cài đặt riêng (không làm hỏng việc quay lui về 1.5.0)', () => {
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

  it('khung ứng dụng hiện thông báo lúc mở app', () => {
    expect(source('src/renderer/src/app/App.tsx')).toContain('<SharedTempFolderNotice />');
  });
});
