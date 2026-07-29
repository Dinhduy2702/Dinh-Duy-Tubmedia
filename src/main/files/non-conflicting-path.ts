import { access, copyFile, link, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function numberedCandidate(desired: string, index: number): string {
  if (index === 1) return desired;
  const folder = dirname(desired);
  const extension = extname(desired);
  const stem = basename(desired, extension);
  return join(folder, `${stem} (${index})${extension}`);
}

/**
 * Returns the requested path when free, otherwise a deterministic Windows-safe
 * sibling. It never removes or overwrites an unrelated existing file.
 */
export async function nonConflictingPath(desired: string): Promise<string> {
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = numberedCandidate(desired, index);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Không thể tạo tên tệp không trùng cho ${desired}.`);
}

/**
 * Commits a verified pending file without ever replacing an existing path.
 * A hard-link is atomic on NTFS and keeps the pending file intact until the
 * destination is reserved. COPYFILE_EXCL is a conservative fallback for file
 * systems without hard-link support.
 */
export async function commitFileWithoutOverwrite(
  pending: string,
  desired: string
): Promise<string> {
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = numberedCandidate(desired, index);
    try {
      await link(pending, candidate);
      await rm(pending, { force: true }).catch(() => undefined);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? '')) throw error;
    }

    try {
      await copyFile(pending, candidate, constants.COPYFILE_EXCL);
      const [source, committed] = await Promise.all([stat(pending), stat(candidate)]);
      if (source.size !== committed.size) {
        await rm(candidate, { force: true });
        throw new Error(`Dung lượng tệp commit không khớp: ${committed.size}/${source.size} byte.`);
      }
      await rm(pending, { force: true }).catch(() => undefined);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      await rm(candidate, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  throw new Error(`Không thể commit tệp do có quá nhiều tên trùng: ${desired}.`);
}
