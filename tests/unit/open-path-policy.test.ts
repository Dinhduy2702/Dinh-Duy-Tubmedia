import { describe, expect, it } from 'vitest';
import {
  OPEN_PATH_EXECUTABLE_MESSAGE,
  OPEN_PATH_NOT_LOCAL_MESSAGE,
  isBlockedOpenPath,
  openPathBlockReason
} from '../../src/main/security/open-path-policy.js';

describe('isBlockedOpenPath', () => {
  it.each([
    'C:\\Users\\Hi\\Downloads\\setup.exe',
    'D:\\tools\\run.BAT',
    'C:\\x\\script.ps1',
    'C:\\x\\evil.exe.',
    'C:\\x\\evil.cmd ',
    'C:\\x\\shortcut.lnk'
  ])('chặn %s', (path) => {
    expect(isBlockedOpenPath(path)).toBe(true);
  });

  it.each([
    'C:\\Users\\Hi\\Videos',
    'D:\\Video\\Tiêu đề [abc123].mp4',
    'D:\\Video\\timeline.txt',
    'D:\\Video\\cover.png',
    'D:\\Video\\folder.with.dots'
  ])('cho phép %s', (path) => {
    expect(isBlockedOpenPath(path)).toBe(false);
  });
});

describe('openPathBlockReason: các cách vượt qua danh sách đuôi tệp', () => {
  it.each([
    'C:\\a\\evil.exe::$DATA',
    'C:\\a\\evil.bat::$DATA',
    'C:\\a\\evil.exe:stream',
    'C:\\a\\video.mp4:hidden.exe'
  ])('chặn luồng dữ liệu thay thế NTFS: %s', (path) => {
    expect(openPathBlockReason(path)).toBe(OPEN_PATH_NOT_LOCAL_MESSAGE);
  });

  it.each([
    'calculator:',
    'ms-msdt:/id PCWDiagnostic /skip force',
    'search-ms:query=x&crumb=location:\\\\evil\\share',
    'https://example.com/',
    'file:///C:/Windows/System32/calc.exe',
    'shell:startup',
    'shell:::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
    '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}'
  ])('chặn địa chỉ/thư mục ảo không phải đường dẫn tệp: %s', (path) => {
    expect(openPathBlockReason(path)).toBe(OPEN_PATH_NOT_LOCAL_MESSAGE);
  });

  it.each(['cmd', 'calc', 'notepad', 'foo.txt', '..\\..\\Windows', 'C:evil.txt', '\\rootless', '\\\\.\\pipe\\x'])(
    'chặn tên lệnh trần, đường dẫn tương đối hoặc thiết bị: %s',
    (path) => {
      expect(openPathBlockReason(path)).toBe(OPEN_PATH_NOT_LOCAL_MESSAGE);
    }
  );

  it('chặn ký tự điều khiển trong đường dẫn', () => {
    expect(openPathBlockReason('C:\\a\\b\u0000.txt')).toBe(OPEN_PATH_NOT_LOCAL_MESSAGE);
    expect(openPathBlockReason('C:\\a\\b\n.txt')).toBe(OPEN_PATH_NOT_LOCAL_MESSAGE);
  });

  it('vẫn chặn tệp thực thi khi có dấu phân cách hoặc khoảng trắng đuôi', () => {
    for (const path of ['C:\\a\\EVIL.EXE\\', 'C:\\a\\evil.exe \\', 'C:\\a\\evil.exe\\.', '\\\\?\\C:\\a\\evil.exe']) {
      expect(openPathBlockReason(path)).toBe(OPEN_PATH_EXECUTABLE_MESSAGE);
    }
  });

  it.each([
    'a.application',
    'a.appref-ms',
    'a.ws',
    'a.wsc',
    'a.sct',
    'a.inf',
    'a.ps1xml',
    'a.psc1',
    'a.chm',
    'a.py',
    'a.pyw',
    'a.gadget',
    'a.xbap',
    'a.jnlp',
    'a.diagcab',
    'a.settingcontent-ms'
  ])('chặn thêm định dạng thực thi/script: %s', (name) => {
    expect(openPathBlockReason(`C:\\a\\${name}`)).toBe(OPEN_PATH_EXECUTABLE_MESSAGE);
  });

  it.each([
    'D:/Video/clip.mp4',
    'D:\\Video\\Thư mục có khoảng trắng & dấu\\clip.mp4',
    'C:\\',
    '\\\\NAS\\videos\\thành phẩm',
    '//NAS/videos/out',
    '\\\\?\\C:\\Users\\Hi\\Videos',
    `C:\\${'thư-mục-dài\\'.repeat(20)}video.mp4`
  ])('vẫn cho phép đường dẫn hợp lệ: %s', (path) => {
    expect(openPathBlockReason(path)).toBeNull();
  });
});
