import { lstat, readdir, rm, rmdir } from 'node:fs/promises';
import { basename, isAbsolute, parse, relative, resolve } from 'node:path';
import { isTubmediaOwnedDirectory, TUBMEDIA_OWNERSHIP_MARKER } from './file-ownership.js';

export interface TemporaryCleanupReport {
  removedFiles: number;
  removedDirectories: number;
  skippedUnsafePaths: number;
}

function isSafeFolder(folder: string): boolean {
  const resolved = resolve(folder);
  return Boolean(folder.trim()) && resolved !== parse(resolved).root;
}

function isInside(folder: string, file: string): boolean {
  const child = relative(resolve(folder), resolve(file));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
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
 * Removes only explicitly tracked files or recursively removes a reserved
 * Tubmedia directory that contains a valid ownership marker. Arbitrary user
 * files are preserved, and broad filesystem roots are always rejected.
 */
export async function cleanupTemporaryArtifacts(
  tempFolder: string,
  trackedFiles: string[] = [],
  preserveTrackedFiles = false
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

  const rootName = basename(resolve(tempFolder)).toLowerCase();
  if (['_normalized', '_yt_tmp'].includes(rootName) && await isTubmediaOwnedDirectory(tempFolder)) {
    try {
      const entries = await readdir(resolve(tempFolder), { withFileTypes: true });
      for (const entry of entries) {
        const path = resolve(tempFolder, entry.name);
        if (!isInside(tempFolder, path) || entry.isSymbolicLink()) {
          report.skippedUnsafePaths += 1;
          continue;
        }
        await rm(path, { recursive: true, force: true });
        if (entry.isDirectory()) report.removedDirectories += 1;
        else report.removedFiles += 1;
      }
    } catch {
      // Thư mục chưa tồn tại.
    }
  }

  const preservedFiles = new Set(
    preserveTrackedFiles
      ? trackedFiles
          .filter((file) => Boolean(file) && isInside(tempFolder, file))
          .map((file) => resolve(file))
      : []
  );

  for (const file of preserveTrackedFiles ? [] : new Set(trackedFiles)) {
    if (!file || !isInside(tempFolder, file)) {
      report.skippedUnsafePaths += 1;
      continue;
    }
    try {
      const stat = await lstat(file);
      if (!stat.isFile()) {
        report.skippedUnsafePaths += 1;
        continue;
      }
      await rm(file, { force: true });
      report.removedFiles += 1;
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
      if (entry.isDirectory()) {
        const reservedDirectory = ['_normalized', '_yt_tmp'].includes(entry.name.toLowerCase());
        if (reservedDirectory && await isTubmediaOwnedDirectory(path)) {
          await rm(path, { recursive: true, force: true });
          report.removedDirectories += 1;
          continue;
        }
        await walk(path);
      } else if (entry.isFile() && preservedFiles.has(resolve(path))) {
        // Tệp đang được workflow sử dụng phải được giữ lại.
      } else if (entry.isFile() && entry.name === TUBMEDIA_OWNERSHIP_MARKER) {
        // Marker chỉ được xóa cùng cả thư mục ownership, không xóa khi walk thư mục cha.
      }
    }
    try {
      await rmdir(folder);
      report.removedDirectories += 1;
    } catch {
      // Thư mục còn tệp user hoặc đang được dùng nên phải giữ lại.
    }
  };

  await walk(resolve(tempFolder));
  return report;
}
