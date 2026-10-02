import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, parse, relative, resolve } from 'node:path';
import { isTubmediaOwnedDirectory } from './file-ownership.js';

export interface TemporaryCleanupReport {
  removedFiles: number;
  removedDirectories: number;
  skippedUnsafePaths: number;
}

export interface TemporaryCleanupOptions {
  /**
   * Thư mục người dùng đã chọn (thư mục tạm/nguồn/thành phẩm của mọi danh sách, thư mục mặc định). Không bao
   * giờ bị xóa, cũng không xóa thư mục nào CHỨA chúng — kể cả khi tên là _yt_tmp/_normalized và có dấu sở hữu.
   */
  protectedFolders?: readonly string[];
  /** Tệp thành phẩm/tệp nguồn đã biết: không bao giờ bị xóa dù được ghi nhận là tệp tạm. */
  protectedFiles?: readonly string[];
}

const RESERVED_TEMP_DIRECTORIES = ['_normalized', '_yt_tmp'];

function isSafeFolder(folder: string): boolean {
  const resolved = resolve(folder);
  return Boolean(folder.trim()) && resolved !== parse(resolved).root;
}

function isInside(folder: string, file: string): boolean {
  const child = relative(resolve(folder), resolve(file));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

/** Thư mục này là (hoặc chứa) một thư mục người dùng đã chọn → không được xóa. */
function touchesProtectedFolder(directory: string, protectedFolders: readonly string[]): boolean {
  return protectedFolders.some((folder) => Boolean(folder.trim()) && isInside(directory, folder));
}

/** Nằm trong `folder` cả theo đường dẫn chữ LẪN theo vị trí thật (không đi xuyên junction/symlink ra ngoài). */
async function physicallyInside(folder: string, path: string): Promise<boolean> {
  if (!isInside(folder, path)) return false;
  try {
    const [realFolder, realParent] = await Promise.all([realpath(folder), realpath(dirname(resolve(path)))]);
    return isInside(realFolder, realParent);
  } catch {
    return false;
  }
}

export function isTubmediaTemporaryFile(name: string): boolean {
  return (
    /^clip-\d+-[a-z0-9-]+\.mp4(?:\.pending\.mp4)?$/i.test(name) ||
    /\.(?:part|ytdl|aria2)$/i.test(name) ||
    /\.pending(?:\.[a-z0-9]+)?$/i.test(name) ||
    /\.frag\d+$/i.test(name) ||
    /^concat-[a-f0-9-]+\.txt$/i.test(name) ||
    /\.pending\.mp4$/i.test(name)
  );
}

/**
 * Dọn tệp tạm của Tubmedia trong một thư mục tạm (Đợt 2, 2026-10-02 — siết lại toàn bộ):
 * - Không bao giờ xóa thư mục rỗng hay chính thư mục tạm; không bao giờ xóa thư mục người dùng đã chọn
 *   (protectedFolders) hoặc thư mục chứa chúng.
 * - Chỉ xóa đệ quy thư mục dành riêng (_normalized/_yt_tmp) CÓ tệp đánh dấu sở hữu và KHÔNG phải thư mục
 *   người dùng chọn. Nếu chính thư mục được dọn là một thư mục như vậy (ví dụ <thành phẩm>\_normalized do
 *   app tạo) thì xóa nội dung của nó, trừ những gì được bảo vệ.
 * - Tệp do CSDL theo dõi chỉ bị xóa khi: nằm thật trong thư mục tạm (không qua junction/symlink), là tệp
 *   thường, mang đúng mẫu tên tệp tạm của app, và không phải tệp thành phẩm/nguồn đã biết.
 */
export async function cleanupTemporaryArtifacts(
  tempFolder: string,
  trackedFiles: string[] = [],
  preserveTrackedFiles = false,
  options: TemporaryCleanupOptions = {}
): Promise<TemporaryCleanupReport> {
  const report: TemporaryCleanupReport = {
    removedFiles: 0,
    removedDirectories: 0,
    skippedUnsafePaths: 0
  };
  if (!isSafeFolder(tempFolder)) {
    report.skippedUnsafePaths += 1;
    return report;
  }
  const protectedFolders = options.protectedFolders ?? [];
  const protectedFiles = options.protectedFiles ?? [];
  const isProtectedFile = (file: string): boolean => protectedFiles.some((item) => samePath(item, file));

  const removeEntry = async (path: string, isDirectory: boolean): Promise<void> => {
    if (isDirectory ? touchesProtectedFolder(path, protectedFolders) : isProtectedFile(path)) {
      report.skippedUnsafePaths += 1;
      return;
    }
    if (!(await physicallyInside(tempFolder, path))) {
      report.skippedUnsafePaths += 1;
      return;
    }
    await rm(path, { recursive: isDirectory, force: true });
    if (isDirectory) report.removedDirectories += 1;
    else report.removedFiles += 1;
  };

  const rootName = basename(resolve(tempFolder)).toLowerCase();
  const rootChosenByUser = protectedFolders.some((folder) => samePath(folder, tempFolder));
  if (
    RESERVED_TEMP_DIRECTORIES.includes(rootName) &&
    !rootChosenByUser &&
    (await isTubmediaOwnedDirectory(tempFolder))
  ) {
    try {
      const entries = await readdir(resolve(tempFolder), { withFileTypes: true });
      for (const entry of entries) {
        const path = resolve(tempFolder, entry.name);
        if (!isInside(tempFolder, path) || entry.isSymbolicLink()) {
          report.skippedUnsafePaths += 1;
          continue;
        }
        if (!entry.isDirectory() && !entry.isFile()) continue;
        await removeEntry(path, entry.isDirectory());
      }
    } catch {
      // Thư mục chưa tồn tại.
    }
  }

  // preserveTrackedFiles: quy trình ghép lỗi cần giữ clip để thử lại — không xóa tệp nào được theo dõi.
  for (const file of preserveTrackedFiles ? [] : new Set(trackedFiles)) {
    if (!file || !isInside(tempFolder, file) || !isTubmediaTemporaryFile(basename(file))) {
      report.skippedUnsafePaths += 1;
      continue;
    }
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        report.skippedUnsafePaths += 1;
        continue;
      }
      await removeEntry(resolve(file), false);
    } catch {
      // Tệp đã được dọn ở lần chạy trước.
    }
  }

  const walk = async (folder: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = resolve(folder, entry.name);
      if (!isInside(tempFolder, path) || entry.isSymbolicLink()) {
        report.skippedUnsafePaths += 1;
        continue;
      }
      if (!entry.isDirectory()) continue;
      const reservedDirectory = RESERVED_TEMP_DIRECTORIES.includes(entry.name.toLowerCase());
      if (reservedDirectory && (await isTubmediaOwnedDirectory(path))) {
        await removeEntry(path, true);
        continue;
      }
      await walk(path);
    }
    // Không rmdir thư mục rỗng: thư mục tạm có thể là thư mục chung của người dùng (Downloads...); trước đây
    // mọi thư mục con rỗng — và cả chính thư mục gốc nếu rỗng — bị xóa dù không do Tubmedia tạo.
  };

  await walk(resolve(tempFolder));
  return report;
}
