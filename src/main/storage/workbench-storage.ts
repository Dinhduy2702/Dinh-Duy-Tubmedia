import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface FileGroupSize {
  bytes: number;
  fileCount: number;
}

async function addFile(
  path: string,
  seen: Set<string>,
  result: FileGroupSize
): Promise<void> {
  const key = resolve(path).toLocaleLowerCase('en-US');
  if (seen.has(key)) return;
  try {
    const info = await stat(path);
    if (!info.isFile()) return;
    seen.add(key);
    result.bytes += info.size;
    result.fileCount += 1;
  } catch {
    // Tệp có thể vừa được đổi tên hoặc dọn trong lúc đang quét.
  }
}

async function walkDirectory(
  root: string,
  seen: Set<string>,
  result: FileGroupSize
): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walkDirectory(path, seen, result);
    else if (entry.isFile()) await addFile(path, seen, result);
  }
}

export async function sizeFiles(paths: readonly string[]): Promise<FileGroupSize> {
  const result: FileGroupSize = { bytes: 0, fileCount: 0 };
  const seen = new Set<string>();
  for (const path of paths) {
    if (path) await addFile(path, seen, result);
  }
  return result;
}

export async function sizePaths(paths: readonly string[]): Promise<FileGroupSize> {
  const result: FileGroupSize = { bytes: 0, fileCount: 0 };
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    try {
      const info = await stat(path);
      if (info.isDirectory()) await walkDirectory(path, seen, result);
      else if (info.isFile()) await addFile(path, seen, result);
    } catch {
      // Đường dẫn chưa được tạo hoặc vừa được dọn.
    }
  }
  return result;
}
