import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { ensureDirectory } from './ensure-directory.js';

const OWNERSHIP_FILE = '.tubmedia-owned.json';
const RESERVED_DIRECTORY_NAMES = new Set([
  '_yt_tmp',
  '_normalized',
  '_normalized-cache',
  '_remux-cache'
]);

const ownershipSchema = z.object({
  owner: z.literal('Tubmedia'),
  purpose: z.enum(['download-temp', 'normalize-cache', 'remux-cache', 'legacy-normalized']),
  createdAt: z.string().datetime(),
  version: z.literal(1)
});

export type TubmediaDirectoryPurpose = z.infer<typeof ownershipSchema>['purpose'];

export function isReservedTubmediaDirectory(path: string): boolean {
  return RESERVED_DIRECTORY_NAMES.has(basename(resolve(path)).toLowerCase());
}

export async function ensureTubmediaOwnedDirectory(
  path: string,
  purpose: TubmediaDirectoryPurpose
): Promise<void> {
  if (!isReservedTubmediaDirectory(path)) {
    throw new Error(`Từ chối đánh dấu ownership cho thư mục không thuộc namespace Tubmedia: ${path}`);
  }
  await ensureDirectory(path);
  const markerPath = join(path, OWNERSHIP_FILE);
  try {
    const current = ownershipSchema.safeParse(JSON.parse(await readFile(markerPath, 'utf8')));
    if (current.success) return;
  } catch {
    // Chưa có marker hợp lệ; ghi marker mới bằng quyền của thư mục Tubmedia dành riêng.
  }
  await writeFile(
    markerPath,
    JSON.stringify({ owner: 'Tubmedia', purpose, createdAt: new Date().toISOString(), version: 1 }, null, 2),
    { encoding: 'utf8', flag: 'wx' }
  ).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const current = ownershipSchema.safeParse(JSON.parse(await readFile(markerPath, 'utf8')));
        if (current.success) return;
      } catch {
        // Một worker khác có thể vừa tạo file và chưa flush xong nội dung marker.
      }
      await delay(attempt * 10);
    }
    throw new Error(`Ownership marker không hợp lệ: ${markerPath}`);
  });
}

export async function isTubmediaOwnedDirectory(path: string): Promise<boolean> {
  if (!isReservedTubmediaDirectory(path)) return false;
  try {
    const parsed = ownershipSchema.safeParse(JSON.parse(await readFile(join(path, OWNERSHIP_FILE), 'utf8')));
    return parsed.success;
  } catch {
    return false;
  }
}

export const TUBMEDIA_OWNERSHIP_MARKER = OWNERSHIP_FILE;
