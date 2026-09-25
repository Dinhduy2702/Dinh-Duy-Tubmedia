/**
 * Kho cách ly của Dọn dẹp máy — GIAI ĐOẠN 4b (2026-09-23). Khi Tubmedia "xóa" một file qua tính năng
 * Dọn dẹp, file KHÔNG bị xóa vĩnh viễn ngay — nó được DI CHUYỂN vào thư mục cách ly riêng của
 * Tubmedia trong userData (không dùng Windows Recycle Bin, không thêm thư viện, theo đúng quyết định
 * người dùng 2026-09-23). Một bảng ghi (manifest.json) lưu ánh xạ vị trí gốc → vị trí cách ly. Người
 * dùng có thể hoàn tác (restore) trong vòng QUARANTINE_RETENTION_DAYS ngày; sau đó purgeExpired() xóa
 * vĩnh viễn — đây là bước KHÔNG THỂ HOÀN TÁC duy nhất trong toàn bộ luồng.
 *
 * An toàn: quarantineFile() gọi assertSafeCleanupPath() + lstat() TRƯỚC bất kỳ thao tác ghi/xóa nào —
 * một đường dẫn bị chặn sẽ ném lỗi ngay, không đụng gì tới file. Ưu tiên rename() (nhanh, cùng ổ đĩa);
 * nếu khác ổ đĩa (EXDEV) thì sao chép + xác minh kích thước rồi mới xóa gốc (copyFileVerified — không
 * bao giờ xóa gốc trước khi chắc chắn bản sao đúng).
 */
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  QUARANTINE_RETENTION_DAYS,
  type QuarantineEntry,
  type QuarantineRestoreOutcome,
  type SystemCleanupCategoryId
} from '@shared/system-cleanup.js';
import { assertSafeCleanupPath, copyFileVerified } from './cleanup-scanner.js';

export { QUARANTINE_RETENTION_DAYS } from '@shared/system-cleanup.js';
export type { QuarantineEntry } from '@shared/system-cleanup.js';

export type QuarantineOutcome =
  | { ok: true; entry: QuarantineEntry }
  | { ok: false; reason: string };

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export class QuarantineStore {
  public constructor(
    private readonly baseDir: string,
    private readonly retentionDays: number = QUARANTINE_RETENTION_DAYS
  ) {}

  private manifestPath(): string {
    return join(this.baseDir, 'manifest.json');
  }

  private filesDir(): string {
    return join(this.baseDir, 'files');
  }

  public async readManifest(): Promise<QuarantineEntry[]> {
    try {
      const raw = await readFile(this.manifestPath(), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as QuarantineEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async writeManifest(entries: QuarantineEntry[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const tempPath = `${this.manifestPath()}.tmp-${randomUUID()}`;
    await writeFile(tempPath, JSON.stringify(entries, null, 2), 'utf8');
    await rename(tempPath, this.manifestPath());
  }

  public async listActive(): Promise<QuarantineEntry[]> {
    const entries = await this.readManifest();
    return entries.filter((entry) => !entry.restoredAt && !entry.purgedAt);
  }

  /**
   * Cách ly một file THẬT. Không bao giờ ném lỗi ra ngoài cho một file đơn lẻ thất bại — trả về
   * { ok:false, reason } để caller gộp vào danh sách "bỏ qua" thay vì làm hỏng cả lượt dọn dẹp.
   */
  public async quarantineFile(
    originalPath: string,
    categoryId: SystemCleanupCategoryId,
    runId: string
  ): Promise<QuarantineOutcome> {
    let safePath: string;
    try {
      safePath = assertSafeCleanupPath(originalPath);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }

    let info;
    try {
      info = await lstat(safePath);
    } catch {
      return { ok: false, reason: 'Không tìm thấy (có thể đã bị xóa hoặc di chuyển trước đó).' };
    }

    if (info.isSymbolicLink()) {
      return { ok: false, reason: 'Là liên kết tượng trưng/reparse point — đã chặn để không đi lạc phạm vi.' };
    }
    if (!info.isFile()) {
      return { ok: false, reason: 'Không phải tệp thường (thư mục hoặc loại đặc biệt).' };
    }

    const id = randomUUID();
    await mkdir(this.filesDir(), { recursive: true });
    const quarantinePath = join(this.filesDir(), id);
    const bytes = info.size;

    try {
      await rename(safePath, quarantinePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EXDEV') {
        try {
          await copyFileVerified(safePath, quarantinePath);
          await rm(safePath, { force: true });
        } catch (copyError) {
          await rm(quarantinePath, { force: true });
          return {
            ok: false,
            reason: copyError instanceof Error ? copyError.message : 'Sao chép sang khu cách ly thất bại.'
          };
        }
      } else {
        return { ok: false, reason: error instanceof Error ? error.message : 'Không thể di chuyển vào khu cách ly.' };
      }
    }

    const now = Date.now();
    const entry: QuarantineEntry = {
      id,
      runId,
      categoryId,
      originalPath: safePath,
      bytes,
      quarantinedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      restoredAt: null,
      restoredPath: null,
      purgedAt: null
    };

    const entries = await this.readManifest();
    entries.push(entry);
    await this.writeManifest(entries);

    return { ok: true, entry };
  }

  /** Hoàn tác một hoặc nhiều mục đã cách ly — không bao giờ ghi đè nếu vị trí gốc đã có file khác. */
  public async restore(ids: string[]): Promise<QuarantineRestoreOutcome[]> {
    const entries = await this.readManifest();
    const idSet = new Set(ids);
    const results: QuarantineRestoreOutcome[] = [];

    for (const entry of entries) {
      if (!idSet.has(entry.id)) continue;

      if (entry.restoredAt) {
        results.push({ id: entry.id, ok: false, message: 'Mục này đã được hoàn tác trước đó.' });
        continue;
      }
      if (entry.purgedAt) {
        results.push({ id: entry.id, ok: false, message: 'Mục này đã bị xóa vĩnh viễn (quá hạn cách ly).' });
        continue;
      }

      const quarantinePath = join(this.filesDir(), entry.id);
      const targetPath = this.resolveNonCollidingPath(entry.originalPath);

      try {
        await mkdir(dirname(targetPath), { recursive: true });
        try {
          await rename(quarantinePath, targetPath);
        } catch (error) {
          if (isErrnoException(error) && error.code === 'EXDEV') {
            await copyFileVerified(quarantinePath, targetPath);
            await rm(quarantinePath, { force: true });
          } else {
            throw error;
          }
        }

        entry.restoredAt = new Date().toISOString();
        entry.restoredPath = targetPath;
        results.push({ id: entry.id, ok: true, restoredPath: targetPath });
      } catch (error) {
        results.push({
          id: entry.id,
          ok: false,
          message: error instanceof Error ? error.message : 'Không thể hoàn tác mục này.'
        });
      }
    }

    await this.writeManifest(entries);
    return results;
  }

  private resolveNonCollidingPath(originalPath: string): string {
    if (!existsSync(originalPath)) {
      return originalPath;
    }

    const directory = dirname(originalPath);
    const extension = extname(originalPath);
    const baseName = originalPath.slice(directory.length + 1, originalPath.length - extension.length);

    for (let attempt = 1; attempt < 1000; attempt += 1) {
      const candidate = join(directory, `${baseName} (khôi phục ${attempt})${extension}`);
      if (!existsSync(candidate)) {
        return candidate;
      }
    }

    return join(directory, `${baseName} (khôi phục ${randomUUID()})${extension}`);
  }

  /** Xóa VĨNH VIỄN các mục đã quá hạn cách ly — bước không thể hoàn tác duy nhất trong toàn bộ luồng. */
  public async purgeExpired(now: number = Date.now()): Promise<{ purged: number }> {
    const entries = await this.readManifest();
    let purged = 0;

    for (const entry of entries) {
      if (entry.restoredAt || entry.purgedAt) continue;
      if (new Date(entry.expiresAt).getTime() > now) continue;

      await rm(join(this.filesDir(), entry.id), { force: true });
      entry.purgedAt = new Date(now).toISOString();
      purged += 1;
    }

    if (purged > 0) {
      await this.writeManifest(entries);
    }

    return { purged };
  }
}
