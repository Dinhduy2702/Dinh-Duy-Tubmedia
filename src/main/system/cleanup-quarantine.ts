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
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  QUARANTINE_RETENTION_DAYS,
  type QuarantineEntry,
  type QuarantineRestoreOutcome,
  type SystemCleanupCategoryId
} from '@shared/system-cleanup.js';
import { assertSafeCleanupPath, copyFileVerified } from './cleanup-scanner.js';
import {
  CLEANUP_QUARANTINE_FOLDER_NAME,
  driveRootOf,
  ensureQuarantineReadme,
  quarantineRootForFile,
  type RootResolver
} from '../files/quarantine-location.js';

export { QUARANTINE_RETENTION_DAYS } from '@shared/system-cleanup.js';
export type { QuarantineEntry } from '@shared/system-cleanup.js';

export type QuarantineOutcome =
  | { ok: true; entry: QuarantineEntry }
  | { ok: false; reason: string };

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export interface QuarantineStoreOptions {
  /** Gốc ổ đĩa của một đường dẫn — chỉ thay trong bài kiểm. */
  rootOf?: RootResolver;
  /** Mục 5 ý 5: gọi cho MỖI tệp bị xóa vĩnh viễn để ghi nhật ký tên + dung lượng. */
  onPurged?: (item: { name: string; bytes: number; originalPath: string }) => void;
}

export class QuarantineStore {
  private readonly rootOf: RootResolver;
  private readonly onPurged: QuarantineStoreOptions['onPurged'];

  public constructor(
    private readonly baseDir: string,
    private readonly retentionDays: number = QUARANTINE_RETENTION_DAYS,
    options: QuarantineStoreOptions = {}
  ) {
    this.rootOf = options.rootOf ?? driveRootOf;
    this.onPurged = options.onPurged;
  }

  /** Nơi đang lưu tệp của một mục: <ổ>\Tubmedia\quarantine\Dọn dẹp máy\<id> nếu khác ổ, ngược lại trong userData. */
  private storedPathOf(entry: QuarantineEntry): string {
    return entry.storedPath ?? join(this.filesDir(), entry.id);
  }

  private isOwnStoredPath(entry: QuarantineEntry): boolean {
    const stored = resolve(this.storedPathOf(entry));
    if (basename(stored) !== entry.id) return false;
    const parent = dirname(stored).toLowerCase();
    const driveDir = join(quarantineRootForFile(stored, this.rootOf), CLEANUP_QUARANTINE_FOLDER_NAME);
    return parent === resolve(this.filesDir()).toLowerCase() || parent === resolve(driveDir).toLowerCase();
  }

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
    // Mục 5 ý 5 (2026-10-02): tệp khác ổ với userData KHÔNG bị chép sang ổ userData (thường là C:) mà ở lại
    // đúng ổ của nó: <ổ>\Tubmedia\quarantine\Dọn dẹp máy — chỉ là đổi tên, không tốn thêm dung lượng ổ C:.
    let sameDriveAsStore = this.rootOf(safePath).toLowerCase() === this.rootOf(this.baseDir).toLowerCase();
    let storageDir = this.filesDir();
    if (!sameDriveAsStore) {
      const driveDir = join(quarantineRootForFile(safePath, this.rootOf), CLEANUP_QUARANTINE_FOLDER_NAME);
      try {
        await mkdir(driveDir, { recursive: true });
        storageDir = driveDir;
        await ensureQuarantineReadme(quarantineRootForFile(safePath, this.rootOf)).catch(() => undefined);
      } catch {
        // Gốc ổ không ghi được: lùi về userData như trước mục 5 (chép có đối chiếu kích thước bên dưới).
        sameDriveAsStore = true;
      }
    }
    await mkdir(storageDir, { recursive: true });
    const quarantinePath = join(storageDir, id);
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
      purgedAt: null,
      storedPath: sameDriveAsStore ? null : quarantinePath
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
      if (!this.isOwnStoredPath(entry)) {
        results.push({ id: entry.id, ok: false, message: 'Vị trí lưu của mục này không thuộc khu cách ly Dọn dẹp máy — đã chặn.' });
        continue;
      }

      const quarantinePath = this.storedPathOf(entry);
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

  /** Mục 5 ý 5: các mục còn hiệu lực sẽ bị xóa vĩnh viễn trong khoảng `windowMs` tới (để nhắc khi mở app). */
  public async expiringWithin(windowMs: number, now: number = Date.now()): Promise<QuarantineEntry[]> {
    return (await this.listActive()).filter((entry) => new Date(entry.expiresAt).getTime() <= now + windowMs);
  }

  /** Xóa VĨNH VIỄN các mục đã quá hạn cách ly — bước không thể hoàn tác duy nhất trong toàn bộ luồng. */
  public async purgeExpired(now: number = Date.now()): Promise<{ purged: number }> {
    const entries = await this.readManifest();
    let purged = 0;

    for (const entry of entries) {
      if (entry.restoredAt || entry.purgedAt) continue;
      if (new Date(entry.expiresAt).getTime() > now) continue;
      // Mục 5: chỉ xóa đúng tệp do Dọn dẹp máy cất (userData\files\<id> hoặc <ổ>\Tubmedia\quarantine\Dọn dẹp máy\<id>).
      // Sổ bị sửa trỏ đi nơi khác (khu cách ly của danh sách, tệp người dùng) → bỏ qua, không đánh dấu đã xóa.
      if (!this.isOwnStoredPath(entry)) continue;

      await rm(this.storedPathOf(entry), { force: true });
      entry.purgedAt = new Date(now).toISOString();
      purged += 1;
      this.onPurged?.({ name: basename(entry.originalPath), bytes: entry.bytes, originalPath: entry.originalPath });
    }

    if (purged > 0) {
      await this.writeManifest(entries);
    }

    return { purged };
  }
}
