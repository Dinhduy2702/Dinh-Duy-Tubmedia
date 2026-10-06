import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, parse, relative, resolve, isAbsolute, sep } from 'node:path';

/**
 * Mục 5 (2026-10-02) — khu cách ly thống nhất: <ổ của tệp>:\Tubmedia\quarantine\<tên danh sách (mã ngắn)>.
 * Luôn CÙNG Ổ với tệp gốc để việc chuyển là đổi tên (không chép tệp lớn sang ổ khác). Khu cách ly của
 * Dọn dẹp máy dùng thư mục con "Dọn dẹp máy" khi tệp không cùng ổ với userData.
 */
export const TUBMEDIA_DRIVE_FOLDER = 'Tubmedia';
export const QUARANTINE_FOLDER = 'quarantine';
export const CLEANUP_QUARANTINE_FOLDER_NAME = 'Dọn dẹp máy';
export const UNASSIGNED_QUARANTINE_FOLDER_NAME = 'Không thuộc danh sách';

export type RootResolver = (path: string) => string;

export const QUARANTINE_README_TEXT = `THƯ MỤC TUBMEDIA — KHU CÁCH LY
================================

Thư mục "quarantine" là khu cách ly của Tubmedia. Tubmedia chuyển vào đây (không chép, không xóa) những tệp
cần giữ lại để người dùng tự quyết định:
  - Bản cũ của video nguồn khi Tubmedia đã tải bản mới đạt chất lượng hơn.
  - Tệp tải về, đoạn cắt hoặc thành phẩm bị lỗi khi kiểm tra.

Mỗi danh sách có một thư mục con riêng: "<tên danh sách> (<mã ngắn>)".
Thư mục "${CLEANUP_QUARANTINE_FOLDER_NAME}" (nếu có) thuộc tính năng Dọn dẹp máy: tệp trong đó tự xóa vĩnh viễn
sau 14 ngày, và có thể hoàn tác trước thời hạn trong Tubmedia → Dọn dẹp máy.

Có xóa được không?
  - Tubmedia không bao giờ tự xóa tệp trong khu cách ly của danh sách.
  - Có thể xóa khi không cần nữa. Nên xóa trong Tubmedia → Dọn dẹp máy → "Khu cách ly của danh sách": ở đó
    xem được tổng dung lượng, từng tệp, ngày cách ly, và xóa có chọn lọc.
  - Xóa trực tiếp bằng File Explorer cũng không làm hỏng Tubmedia; tệp đó chỉ được ghi nhận là không còn.
  - Không nên xóa tay trong thư mục "${CLEANUP_QUARANTINE_FOLDER_NAME}" nếu còn muốn hoàn tác.
`;

export function driveRootOf(path: string): string {
  return parse(resolve(path)).root;
}

export function quarantineRootForFile(file: string, rootOf: RootResolver = driveRootOf): string {
  return join(rootOf(file), TUBMEDIA_DRIVE_FOLDER, QUARANTINE_FOLDER);
}

/**
 * Thư mục lùi khi KHÔNG tạo được <gốc ổ>\Tubmedia\quarantine (gốc ổ bị khóa quyền, ổ chỉ đọc một phần…):
 * <thư mục thành phẩm>\Tubmedia\quarantine nếu thành phẩm cùng ổ với tệp, nếu không thì cạnh chính tệp —
 * luôn cùng ổ để vẫn chỉ là đổi tên.
 */
export function fallbackQuarantineRootForFile(
  file: string,
  outputFolder: string | null | undefined,
  rootOf: RootResolver = driveRootOf
): string {
  const resolvedFile = resolve(file);
  const base =
    outputFolder && rootOf(outputFolder).toLowerCase() === rootOf(resolvedFile).toLowerCase()
      ? resolve(outputFolder)
      : dirname(resolvedFile);
  return join(base, TUBMEDIA_DRIVE_FOLDER, QUARANTINE_FOLDER);
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** Tên Windows dành riêng (CON, NUL, COM1…), kể cả khi có đuôi như "CON.txt". */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED_NAME.test((name.split('.')[0] ?? '').trim());
}

/** Đường dẫn Windows cổ điển tối đa 259 ký tự (MAX_PATH 260 gồm ký tự kết thúc) — File Explorer vẫn mở được. */
export const QUARANTINE_MAX_PATH = 259;

/**
 * Đích của một tệp trong khu cách ly: <thư mục>\<tiền tố>-<tên tệp>. Tên quá dài thì cắt phần tên (giữ đuôi)
 * để cả đường dẫn nằm trong MAX_PATH; tiền tố (thời điểm + mã) giữ tên luôn duy nhất.
 */
export function quarantineTargetPath(folder: string, fileName: string, prefix: string): string {
  const full = join(folder, `${prefix}-${fileName}`);
  if (full.length <= QUARANTINE_MAX_PATH) return full;
  const rawExt = extname(fileName);
  const ext = rawExt.length <= 16 ? rawExt : '';
  const stem = Array.from(fileName.slice(0, fileName.length - ext.length));
  const budget = Math.max(8, QUARANTINE_MAX_PATH - (folder.length + sep.length + prefix.length + 1 + ext.length));
  while (stem.join('').length > budget) stem.pop();
  const trimmed = stem.join('').replace(/[. ]+$/g, '') || 'tep';
  return join(folder, `${prefix}-${trimmed}${ext}`);
}

/**
 * Nằm BÊN TRONG một khu cách ly của Tubmedia — ở gốc ổ hoặc ở thư mục lùi (…\Tubmedia\quarantine\…).
 * Không tính chính thư mục quarantine; đường dẫn được chuẩn hóa trước nên ".." không lọt qua.
 */
export function isInsideAnyQuarantineFolder(path: string): boolean {
  const parts = resolve(path).split(/[\\/]/);
  for (let index = 0; index + 2 < parts.length; index += 1) {
    if (
      parts[index]!.toLowerCase() === TUBMEDIA_DRIVE_FOLDER.toLowerCase() &&
      parts[index + 1]!.toLowerCase() === QUARANTINE_FOLDER &&
      parts[index + 2] !== ''
    ) {
      return true;
    }
  }
  return false;
}

function sanitizeFolderName(name: string): string {
  const cleaned = [...name]
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '');
  return cleaned.slice(0, 60).trim().replace(/[. ]+$/g, '');
}

export function projectQuarantineFolderName(owner: { id: string; name: string } | null): string {
  if (!owner) return UNASSIGNED_QUARANTINE_FOLDER_NAME;
  const cleaned = sanitizeFolderName(owner.name) || 'Danh sách';
  const name = isWindowsReservedName(cleaned) ? `_${cleaned}` : cleaned;
  return `${name} (${owner.id.slice(0, 8)})`;
}

export function projectQuarantineFolderForFile(
  file: string,
  owner: { id: string; name: string } | null,
  rootOf: RootResolver = driveRootOf
): string {
  return join(quarantineRootForFile(file, rootOf), projectQuarantineFolderName(owner));
}

/** Đúng nằm BÊN TRONG <gốc ổ>\Tubmedia\quarantine (không tính chính thư mục đó, không đi ngược bằng ..). */
export function isInsideQuarantineRoot(path: string, rootOf: RootResolver = driveRootOf): boolean {
  const resolved = resolve(path);
  const root = quarantineRootForFile(resolved, rootOf);
  const child = relative(root, resolved);
  return Boolean(child) && !child.startsWith('..') && !isAbsolute(child);
}

/** Có đoạn "\Tubmedia\quarantine\" ở bất kỳ đâu — dùng để Dọn dẹp máy luôn bỏ qua (thà bỏ sót còn hơn xóa nhầm). */
export function containsQuarantineSegment(path: string): boolean {
  return /[\\/]tubmedia[\\/]quarantine[\\/]/i.test(resolve(path));
}

/** Ghi README.txt trong <gốc ổ>\Tubmedia nếu chưa có — không bao giờ ghi đè. */
export async function ensureQuarantineReadme(
  quarantineRoot: string,
  makeDirectory: (path: string, options: { recursive: true }) => Promise<unknown> = mkdir
): Promise<void> {
  const tubmediaFolder = resolve(quarantineRoot, '..');
  await makeDirectory(tubmediaFolder, { recursive: true });
  await writeFile(join(tubmediaFolder, 'README.txt'), QUARANTINE_README_TEXT, { encoding: 'utf8', flag: 'wx' }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    }
  );
}
