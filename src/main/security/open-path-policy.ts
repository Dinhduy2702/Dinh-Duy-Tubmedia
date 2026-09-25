import { extname } from 'node:path';

/**
 * shell.openPath thực thi tệp theo chương trình mặc định của Windows. Giao diện chỉ cần mở
 * thư mục, video, ảnh và tệp văn bản; chặn các định dạng thực thi/script để một renderer bị
 * chiếm quyền không thể dùng kênh IPC showPath để chạy mã trên máy người dùng.
 */
const BLOCKED_OPEN_EXTENSIONS = new Set([
  '.exe',
  '.com',
  '.bat',
  '.cmd',
  '.msi',
  '.msp',
  '.scr',
  '.pif',
  '.ps1',
  '.psm1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.cpl',
  '.reg',
  '.lnk',
  '.url',
  '.jar',
  '.dll',
  '.msc',
  '.scf',
  '.appx',
  '.msix',
  '.application',
  '.appref-ms',
  '.ws',
  '.wsc',
  '.sct',
  '.inf',
  '.ps1xml',
  '.psc1',
  '.msh',
  '.msh1',
  '.msh2',
  '.mshxml',
  '.chm',
  '.py',
  '.pyw',
  '.gadget',
  '.xbap',
  '.jnlp',
  '.diagcab',
  '.settingcontent-ms',
  '.library-ms',
  '.search-ms'
]);

export const OPEN_PATH_EXECUTABLE_MESSAGE = 'Tubmedia không mở tệp thực thi hoặc script từ giao diện.';
export const OPEN_PATH_NOT_LOCAL_MESSAGE =
  'Tubmedia chỉ mở đường dẫn tệp hoặc thư mục đầy đủ (ví dụ D:\\Video hoặc \\\\máy\\thư-mục), không mở địa chỉ, lệnh hay đường dẫn đặc biệt.';

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

/**
 * shell.openPath chuyển chuỗi cho ShellExecute, nên ngoài tệp còn hiểu được URI giao thức
 * ("calculator:", "ms-msdt:..."), thư mục ảo ("shell:startup", "::{CLSID}"), tên lệnh trần
 * ("cmd") và luồng dữ liệu thay thế NTFS ("evil.exe::$DATA" vẫn là evil.exe). Chỉ nhận đường
 * dẫn ổ đĩa đầy đủ (C:\...) hoặc chia sẻ mạng (\\máy\thư-mục\...).
 */
function isFullFilesystemPath(value: string): boolean {
  const withoutLongPrefix = value.replace(/^\\\\\?\\(?=[A-Za-z]:)/, '');
  if (/^[A-Za-z]:[\\/]/.test(withoutLongPrefix)) return !withoutLongPrefix.slice(2).includes(':');
  return /^[\\/]{2}[^\\/?.:][^\\/:]*[\\/][^\\/:]/.test(value) && !value.includes(':');
}

/** Trả về lý do từ chối, hoặc null nếu đường dẫn được phép mở. */
export function openPathBlockReason(path: string): string | null {
  const value = path.trim();
  if (hasControlCharacter(value) || !isFullFilesystemPath(value)) return OPEN_PATH_NOT_LOCAL_MESSAGE;
  // Windows bỏ qua dấu chấm/khoảng trắng và dấu phân cách cuối ("evil.exe. \" vẫn là evil.exe).
  const normalized = value.replace(/[\\/. ]+$/g, '');
  return BLOCKED_OPEN_EXTENSIONS.has(extname(normalized).toLowerCase()) ? OPEN_PATH_EXECUTABLE_MESSAGE : null;
}

export function isBlockedOpenPath(path: string): boolean {
  return openPathBlockReason(path) !== null;
}
