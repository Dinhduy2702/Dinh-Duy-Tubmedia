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
  '.msix'
]);

export function isBlockedOpenPath(path: string): boolean {
  // Windows bỏ qua dấu chấm/khoảng trắng cuối tên ("evil.exe. " vẫn là evil.exe).
  const normalized = path.trim().replace(/[. ]+$/g, '');
  return BLOCKED_OPEN_EXTENSIONS.has(extname(normalized).toLowerCase());
}
