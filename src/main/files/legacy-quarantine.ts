import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { LegacyQuarantineFolder, Project } from '@shared/types/domain.js';

const LEGACY_QUARANTINE_NAME = '_quarantine';
const MAX_ENTRIES = 20_000;

/**
 * Mục 5 (2026-10-02), ý 4 + B2: các thư mục _quarantine CŨ (trong thư mục tạm hoặc thành phẩm của danh sách,
 * trước khi khu cách ly gom về <ổ>:\Tubmedia\quarantine). Hàm này CHỈ ĐỌC: đếm tệp để báo người dùng kèm nút
 * "Mở thư mục" — không di chuyển, không xóa, không đi xuyên liên kết/junction.
 */
export async function findLegacyQuarantineFolders(
  projects: ReadonlyArray<Pick<Project, 'tempFolder' | 'outputFolder'>>
): Promise<LegacyQuarantineFolder[]> {
  const candidates = new Map<string, string>();
  for (const project of projects) {
    for (const base of [project.tempFolder, project.outputFolder]) {
      if (!base?.trim()) continue;
      const path = join(resolve(base), LEGACY_QUARANTINE_NAME);
      candidates.set(path.toLowerCase(), path);
    }
  }

  const found: LegacyQuarantineFolder[] = [];
  for (const path of candidates.values()) {
    const info = await lstat(path).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) continue;
    const usage = { files: 0, bytes: 0, seen: 0 };
    await count(path, usage);
    if (usage.files > 0) found.push({ path, files: usage.files, bytes: usage.bytes });
  }
  return found;
}

async function count(folder: string, usage: { files: number; bytes: number; seen: number }): Promise<void> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (usage.seen++ >= MAX_ENTRIES) return;
    if (entry.isSymbolicLink()) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      await count(path, usage);
    } else if (entry.isFile()) {
      usage.files += 1;
      usage.bytes += (await lstat(path).catch(() => null))?.size ?? 0;
    }
  }
}
