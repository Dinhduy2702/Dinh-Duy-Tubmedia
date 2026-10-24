import { lstat, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isTubmediaOwnedDirectory } from './file-ownership.js';

/**
 * Dọn tệp tạm của lượt tải (2026-10-24, người dùng yêu cầu: Tubmedia luôn tự dọn, không bắt người dùng xoá tay).
 *
 * yt-dlp ghi tệp tạm (.part, .ytdl, mảnh HLS "-Frag", luồng hình/tiếng riêng trước khi ghép) vào
 * <thư mục tạm của danh sách>\_dl\<8 ký tự đầu mã danh sách>. Thư mục "_dl\<mã>" chỉ Tubmedia tạo và chỉ chứa tệp tạm của
 * đúng danh sách đó; mọi tệp tạm của một video mang mã liên kết "[LINK_…]" của video đó trong tên.
 *
 * An toàn: chỉ xoá bên trong đúng dạng <…>\_dl\<8 ký tự hex>, theo vị trí thật (không đi xuyên junction/symlink ra ngoài),
 * không bao giờ xoá thư mục người dùng chọn hay tệp thành phẩm/nguồn đã biết (cùng quy tắc với temporary-cleanup.ts).
 */
export const DOWNLOAD_WORK_ROOT = '_dl';
const WORK_FOLDER_NAME = /^[0-9a-f]{8}$/i;
const LINK_TAG = /^LINK_[A-F0-9]{12}$/;
/** Danh sách còn có thể tiếp tục (tạm dừng/gián đoạn) nhưng không ai đụng tới chừng này → dọn (tải lại sẽ tải từ đầu). */
export const DOWNLOAD_TEMP_IDLE_MAX_MS = 14 * 24 * 60 * 60 * 1_000;

export function downloadWorkFolder(tempFolder: string, projectId: string): string {
  return join(tempFolder, DOWNLOAD_WORK_ROOT, projectId.slice(0, 8));
}

export interface DownloadTempProtection {
  protectedFolders: readonly string[];
  protectedFiles: readonly string[];
}

function isInside(folder: string, path: string): boolean {
  const child = relative(resolve(folder), resolve(path));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

/** Đúng dạng <…>\_dl\<8 hex>, không phải (và không chứa) thư mục người dùng chọn, và nằm thật trong <…>\_dl. */
export async function isDisposableWorkFolder(workFolder: string, protection: DownloadTempProtection): Promise<boolean> {
  const resolved = resolve(workFolder);
  if (!WORK_FOLDER_NAME.test(basename(resolved))) return false;
  if (basename(dirname(resolved)).toLowerCase() !== DOWNLOAD_WORK_ROOT) return false;
  if (protection.protectedFolders.some((folder) => folder.trim() && isInside(resolved, folder))) return false;
  try {
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const [realWork, realRoot] = await Promise.all([realpath(resolved), realpath(dirname(resolved))]);
    return samePath(dirname(realWork), realRoot);
  } catch {
    return false;
  }
}

async function removeFile(path: string, protection: DownloadTempProtection): Promise<boolean> {
  if (protection.protectedFiles.some((file) => samePath(file, path))) return false;
  // Tệp vừa bị yt-dlp nhả có thể còn khoá một chút trên Windows — fs.promises.rm có thử lại (rmSync của Node 24 thì không).
  await rm(path, { force: true, maxRetries: 5, retryDelay: 200 });
  return true;
}

/**
 * Xoá tệp tạm của MỘT video (mọi tệp trong thư mục làm việc có "[LINK_…]" của nó) — khi video tải xong, lỗi hẳn hoặc bị
 * huỷ. Tệp của video khác cùng danh sách (đang tải song song) không bị đụng tới.
 * @returns số tệp đã xoá.
 */
export async function removeVideoDownloadTemp(
  workFolder: string,
  linkTag: string,
  protection: DownloadTempProtection
): Promise<number> {
  if (!LINK_TAG.test(linkTag) || !(await isDisposableWorkFolder(workFolder, protection))) return 0;
  let entries;
  try {
    entries = await readdir(workFolder, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.includes(`[${linkTag}]`)) continue;
    if (await removeFile(join(workFolder, entry.name), protection).catch(() => false)) removed += 1;
  }
  return removed;
}

/**
 * Xoá cả thư mục làm việc của MỘT danh sách (khi danh sách không còn video nào có thể tiếp tục), rồi xoá luôn "_dl" nếu đã
 * rỗng. @returns số tệp đã xoá.
 */
export async function removeDownloadWorkFolder(workFolder: string, protection: DownloadTempProtection): Promise<number> {
  if (!(await isDisposableWorkFolder(workFolder, protection))) return 0;
  let removed = 0;
  const walk = async (folder: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) continue; // không đi theo / không xoá lối tắt
      if (entry.isDirectory()) {
        await walk(path);
        await rmdir(path).catch(() => undefined);
      } else if (entry.isFile() && (await removeFile(path, protection).catch(() => false))) {
        removed += 1;
      }
    }
  };
  await walk(workFolder);
  await rmdir(workFolder).catch(() => undefined);
  await rmdir(dirname(resolve(workFolder))).catch(() => undefined); // "_dl" — chỉ xoá khi đã rỗng
  return removed;
}

/**
 * Bản đệm của quy trình ghép trong thư mục tạm (_normalized-cache: bản chuẩn hoá từng video; _remux-cache: bản đóng gói lại).
 * Giữ giữa các lần chạy để ghép lại nhanh; dọn khi không còn quy trình nào dùng thư mục tạm này (gọi từ hàng đợi). Chỉ xoá
 * thư mục có dấu sở hữu của Tubmedia, nằm thật trong thư mục tạm, không phải thư mục người dùng chọn.
 */
export const MERGE_CACHE_FOLDERS = ['_normalized-cache', '_remux-cache'] as const;

export async function removeMergeCaches(tempFolder: string, protection: DownloadTempProtection): Promise<number> {
  let removed = 0;
  for (const name of MERGE_CACHE_FOLDERS) {
    const cache = join(tempFolder, name);
    if (protection.protectedFolders.some((folder) => folder.trim() && isInside(cache, folder))) continue;
    try {
      const info = await lstat(cache);
      if (!info.isDirectory() || info.isSymbolicLink() || !(await isTubmediaOwnedDirectory(cache))) continue;
      const [realCache, realTemp] = await Promise.all([realpath(cache), realpath(tempFolder)]);
      if (!samePath(dirname(realCache), realTemp)) continue;
      await rm(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removed += 1;
    } catch {
      // Chưa có bản đệm, hoặc đang bị khoá — lượt quét sau dọn tiếp.
    }
  }
  return removed;
}

/** Bản đệm ghép của thư mục tạm không được ghi thêm gì quá DOWNLOAD_TEMP_IDLE_MAX_MS (hoặc không có bản đệm nào). */
export async function mergeCachesIdle(tempFolder: string, now = Date.now(), idleMaxMs = DOWNLOAD_TEMP_IDLE_MAX_MS): Promise<boolean> {
  let newest = 0;
  for (const name of MERGE_CACHE_FOLDERS) newest = Math.max(newest, await newestModification(join(tempFolder, name)));
  return newest === 0 || now - newest >= idleMaxMs;
}

/** Lần sửa gần nhất của bất kỳ tệp nào trong thư mục (0 nếu rỗng/không đọc được). */
async function newestModification(folder: string): Promise<number> {
  let newest = 0;
  try {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const info = await stat(join(folder, entry.name)).catch(() => null);
      if (info) newest = Math.max(newest, info.mtimeMs);
    }
  } catch {
    return 0;
  }
  return newest;
}

export interface DownloadTempSweepInput {
  /** Thư mục tạm của mọi danh sách (kể cả đã lưu trữ) + thư mục tạm mặc định. */
  tempFolders: readonly string[];
  /** "8 ký tự đầu mã danh sách" → danh sách đó còn video có thể tiếp tục (chờ / đang chạy / tạm dừng / gián đoạn). */
  resumableByWorkName: ReadonlyMap<string, boolean>;
  protection: DownloadTempProtection;
  now?: number;
  idleMaxMs?: number;
  orphanMinIdleMs?: number;
}

/** Thư mục của danh sách không có trong CSDL: chỉ dọn khi không được ghi thêm gì chừng này. */
export const ORPHAN_MIN_IDLE_MS = 60 * 60 * 1_000;

export interface DownloadTempSweepReport {
  removedFolders: number;
  removedFiles: number;
}

/**
 * Quét tệp tạm mồ côi (khi mở app và định kỳ): thư mục làm việc của danh sách đã xoá, của danh sách không còn video nào có
 * thể tiếp tục, hoặc của danh sách tạm dừng nhưng bị bỏ quên quá DOWNLOAD_TEMP_IDLE_MAX_MS. Thư mục của danh sách còn có
 * thể tiếp tục (gần đây) được giữ để tải tiếp từ phần đã tải.
 */
export async function sweepDownloadTemp(input: DownloadTempSweepInput): Promise<DownloadTempSweepReport> {
  const now = input.now ?? Date.now();
  const idleMaxMs = input.idleMaxMs ?? DOWNLOAD_TEMP_IDLE_MAX_MS;
  const report: DownloadTempSweepReport = { removedFolders: 0, removedFiles: 0 };
  const roots = new Map<string, string>();
  for (const folder of input.tempFolders) {
    if (folder?.trim()) roots.set(resolve(folder, DOWNLOAD_WORK_ROOT).toLowerCase(), resolve(folder, DOWNLOAD_WORK_ROOT));
  }
  for (const root of roots.values()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !WORK_FOLDER_NAME.test(entry.name)) continue;
      const workFolder = join(root, entry.name);
      const resumable = input.resumableByWorkName.get(entry.name.toLowerCase());
      if (resumable) {
        const newest = await newestModification(workFolder);
        if (newest === 0 || now - newest < idleMaxMs) continue;
      } else if (resumable === undefined) {
        // Danh sách không có trong CSDL này: đã xoá — hoặc của một Tubmedia khác đang mở trên cùng máy, dùng chung thư mục tạm
        // (bản cài + bản thử). Chỉ dọn khi không có gì được ghi thêm suốt ORPHAN_MIN_IDLE_MS để không xoá lượt đang tải của nó.
        const newest = await newestModification(workFolder);
        if (newest !== 0 && now - newest < (input.orphanMinIdleMs ?? ORPHAN_MIN_IDLE_MS)) continue;
      }
      if (!(await isDisposableWorkFolder(workFolder, input.protection))) continue;
      report.removedFiles += await removeDownloadWorkFolder(workFolder, input.protection);
      report.removedFolders += 1;
    }
  }
  return report;
}
