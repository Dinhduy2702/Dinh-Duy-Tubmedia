import { access, copyFile, link, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/**
 * V2 (2026-11-12): Antivirus (Windows Defender / phần mềm hãng thứ ba) trên máy người dùng thường quét ngay tệp vừa đóng,
 * giữ khoá ngắn hạn khiến rename/link chốt tệp ném EPERM / EBUSY / EACCES. Chỉ thử lại 3 mã khoá tạm này trong ngân sách ~2 giây;
 * KHÔNG thử lại ENOENT, EXDEV, EEXIST. Giữ nguyên hành vi ghi đè hay không ghi đè của từng chỗ gọi trước V2.
 */
const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const LOCK_RETRY_DELAYS_MS = [120, 220, 360, 550, 750] as const;
const MAX_TOTAL_LOCK_WAIT_MS = 2_200;

export interface FileLockRetryEvent {
  operation: 'rename' | 'link';
  sourcePath: string;
  targetPath: string;
  fileName: string;
  errorCode: string;
  retryAttempt: number;
  maxRetries: number;
  delayMs: number;
  jobId?: string | undefined;
  projectId?: string | null | undefined;
}

export type FileLockRetryLogger = (event: FileLockRetryEvent) => void;

export interface FileCommitRetryContext {
  jobId?: string | undefined;
  projectId?: string | null | undefined;
  onRetry?: FileLockRetryLogger | undefined;
}

let defaultLockRetryLogger: FileLockRetryLogger | null = null;

export function setFileLockRetryLogger(logger: FileLockRetryLogger | null): void {
  defaultLockRetryLogger = logger;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransientFileLock<T>(
  operation: 'rename' | 'link',
  sourcePath: string,
  targetPath: string,
  task: () => Promise<T>,
  context?: FileCommitRetryContext
): Promise<T> {
  let waitedMs = 0;
  for (let retryIndex = 0; ; retryIndex += 1) {
    try {
      return await task();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? '';
      if (!TRANSIENT_LOCK_CODES.has(code)) {
        throw error;
      }
      const plannedDelay = LOCK_RETRY_DELAYS_MS[retryIndex];
      if (plannedDelay === undefined || waitedMs + plannedDelay > MAX_TOTAL_LOCK_WAIT_MS) {
        throw error;
      }
      const retryAttempt = retryIndex + 1;
      const event: FileLockRetryEvent = {
        operation,
        sourcePath,
        targetPath,
        fileName: basename(targetPath),
        errorCode: code,
        retryAttempt,
        maxRetries: LOCK_RETRY_DELAYS_MS.length,
        delayMs: plannedDelay,
        jobId: context?.jobId,
        projectId: context?.projectId
      };
      try {
        (context?.onRetry ?? defaultLockRetryLogger)?.(event);
      } catch {
        // Ghi nhật ký không bao giờ được làm hỏng bước chốt tệp.
      }
      await sleepMs(plannedDelay);
      waitedMs += plannedDelay;
    }
  }
}

/**
 * Bọc thử lại khoá tạm EPERM / EBUSY / EACCES quanh rename của Node mà giữ nguyên hành vi cũ
 * (ghi đè nguyên tử tệp đích nếu đã có, không kiểm tra tồn tại trước, hết lượt ném đúng lỗi gốc).
 */
export async function renameWithRetry(
  sourcePath: string,
  destinationPath: string,
  context?: FileCommitRetryContext
): Promise<void> {
  await retryTransientFileLock(
    'rename',
    sourcePath,
    destinationPath,
    () => rename(sourcePath, destinationPath),
    context
  );
}

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
  desired: string,
  context?: FileCommitRetryContext
): Promise<string> {
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = numberedCandidate(desired, index);
    try {
      await retryTransientFileLock('link', pending, candidate, () => link(pending, candidate), context);
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
