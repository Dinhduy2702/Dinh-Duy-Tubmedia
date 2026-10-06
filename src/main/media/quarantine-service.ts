import { copyFile, lstat, mkdir, rename, rm, statfs } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../logging/logger.js';
import type { QuarantineRepository } from '../database/repositories/quarantine-repository.js';
import {
  driveRootOf,
  ensureQuarantineReadme,
  fallbackQuarantineRootForFile,
  isInsideAnyQuarantineFolder,
  projectQuarantineFolderForFile,
  projectQuarantineFolderName,
  quarantineRootForFile,
  quarantineTargetPath,
  type RootResolver
} from '../files/quarantine-location.js';
import { findLegacyQuarantineFolders } from '../files/legacy-quarantine.js';
import { QUARANTINE_WARN_BYTES, QUARANTINE_WARN_FREE_RATIO } from '@shared/utils/quarantine-policy.js';
import type {
  Project,
  QuarantineDeleteOutcome,
  QuarantineDriveUsage,
  QuarantineItem,
  QuarantineItemKind,
  QuarantineOverview,
  QuarantineOverviewItem
} from '@shared/types/domain.js';

export interface QuarantineContext {
  jobId: string;
  projectId?: string | null;
  sourceId?: string | null;
  /** 'outdated-source' = bản cũ được giữ trong lúc tải bản mới; mặc định là tệp lỗi. */
  kind?: QuarantineItemKind;
}

export interface QuarantineServiceOptions {
  items?: QuarantineRepository | null;
  projects?: {
    get(id: string): (Pick<Project, 'id' | 'name'> & Partial<Pick<Project, 'outputFolder'>>) | null;
    list?(includeArchived?: boolean): Array<Pick<Project, 'id' | 'name' | 'tempFolder' | 'outputFolder'>>;
  } | null;
  /** Gốc ổ đĩa của một đường dẫn — chỉ thay trong bài kiểm để không ghi vào gốc ổ thật. */
  rootOf?: RootResolver;
  fsOps?: {
    rename?: (from: string, to: string) => Promise<void>;
    mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  };
  statfs?: (path: string) => Promise<{ freeBytes: number; totalBytes: number }>;
  warnBytes?: number;
  warnFreeRatio?: number;
}

/** Tệp KHÔNG được xác nhận là đã nằm trong khu cách ly — nơi gọi không được nói "đã chuyển vào khu cách ly". */
export class QuarantineMoveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QuarantineMoveError';
  }
}

type QuarantineLogger = Pick<Logger, 'info' | 'warn'>;

export function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

async function defaultStatfs(path: string): Promise<{ freeBytes: number; totalBytes: number }> {
  const stats = await statfs(path);
  return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
}

/**
 * Khu cách ly của danh sách — Mục 5 (2026-10-02).
 * - MỘT chỗ duy nhất: <ổ của tệp>:\Tubmedia\quarantine\<tên danh sách (mã ngắn)>, nơi gọi không chọn thư mục.
 * - Cùng ổ với tệp gốc nên chỉ đổi tên; kiểm tra lại sau khi chuyển (B4) rồi mới ghi nhận/báo.
 * - Mọi tệp được theo dõi trong CSDL tới khi người dùng xóa; Tubmedia KHÔNG có cơ chế tự xóa nào ở đây.
 */
export class QuarantineService {
  private readonly items: QuarantineRepository | null;
  private readonly projects: QuarantineServiceOptions['projects'];
  private readonly rootOf: RootResolver;
  private readonly renameFile: (from: string, to: string) => Promise<void>;
  private readonly makeDirectory: (path: string, options: { recursive: true }) => Promise<unknown>;
  private readonly statfs: (path: string) => Promise<{ freeBytes: number; totalBytes: number }>;
  private readonly warnBytes: number;
  private readonly warnFreeRatio: number;

  public constructor(
    private readonly logger: QuarantineLogger,
    options: QuarantineServiceOptions = {}
  ) {
    this.items = options.items ?? null;
    this.projects = options.projects ?? null;
    this.rootOf = options.rootOf ?? driveRootOf;
    this.renameFile = options.fsOps?.rename ?? rename;
    this.makeDirectory = options.fsOps?.mkdir ?? mkdir;
    this.statfs = options.statfs ?? defaultStatfs;
    this.warnBytes = options.warnBytes ?? QUARANTINE_WARN_BYTES;
    this.warnFreeRatio = options.warnFreeRatio ?? QUARANTINE_WARN_FREE_RATIO;
  }

  /** Thư mục khu cách ly của một danh sách trên ổ chứa `nearPath` (để hiển thị). */
  public folderFor(nearPath: string, project: Pick<Project, 'id' | 'name'> | null): string {
    return projectQuarantineFolderForFile(nearPath, project, this.rootOf);
  }

  public async move(file: string, reason: string, context: QuarantineContext): Promise<string> {
    const original = resolve(file);
    const before = await lstat(original).catch(() => null);
    if (!before || before.isSymbolicLink() || !before.isFile()) {
      throw new QuarantineMoveError(`Không chuyển được vào khu cách ly: không tìm thấy tệp ${original}.`);
    }

    const owner = context.projectId ? (this.projects?.get(context.projectId) ?? null) : null;
    const folderName = projectQuarantineFolderName(owner);
    const prefix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    let target = '';
    try {
      const quarantineRoot = await this.prepareRoot(original, folderName, owner?.outputFolder ?? null, context);
      target = quarantineTargetPath(join(quarantineRoot, folderName), basename(original), prefix);
      await ensureQuarantineReadme(quarantineRoot, this.makeDirectory).catch(() => undefined);
      try {
        await this.renameFile(original, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        // Hiếm (điểm gắn ổ khác bên trong cùng ký tự ổ): chép, đối chiếu kích thước rồi mới xóa gốc.
        await copyFile(original, target);
        if ((await lstat(target)).size !== before.size) {
          await rm(target, { force: true });
          throw new Error('bản chép khác kích thước bản gốc');
        }
        await rm(original, { force: true });
      }
    } catch (error) {
      throw new QuarantineMoveError(
        `Không chuyển được ${original} vào khu cách ly: ${error instanceof Error ? error.message : String(error)}. Tệp vẫn ở chỗ cũ.`
      );
    }

    // B4: chỉ coi là đã cách ly khi tệp THẬT SỰ nằm trong khu cách ly, đủ kích thước, và không còn ở chỗ cũ.
    const after = await lstat(target).catch(() => null);
    const originalStillThere = await lstat(original).then(() => true, () => false);
    if (!after?.isFile() || after.size !== before.size || originalStillThere) {
      throw new QuarantineMoveError(
        `Không xác nhận được tệp đã nằm trong khu cách ly (${target}). Tệp gốc: ${original}.`
      );
    }

    const kind = context.kind ?? 'invalid-file';
    this.items?.add({
      projectId: context.projectId ?? null,
      jobId: context.jobId,
      sourceId: context.sourceId ?? null,
      kind,
      originalPath: original,
      quarantinePath: target,
      bytes: after.size,
      reason
    });
    this.logger.warn('quarantine', 'FILE_QUARANTINED', reason, {
      jobId: context.jobId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      metadata: { original, target, bytes: after.size, kind, verified: true }
    });
    return target;
  }

  /**
   * Tạo <gốc ổ>\Tubmedia\quarantine\<tên (mã)>; nếu gốc ổ không ghi được thì lùi về thư mục thành phẩm (cùng ổ)
   * và ghi nhật ký. Trả về thư mục quarantine đã dùng.
   */
  private async prepareRoot(
    original: string,
    folderName: string,
    outputFolder: string | null,
    context: QuarantineContext
  ): Promise<string> {
    const primary = quarantineRootForFile(original, this.rootOf);
    try {
      await this.makeDirectory(join(primary, folderName), { recursive: true });
      return primary;
    } catch (error) {
      const fallback = fallbackQuarantineRootForFile(original, outputFolder, this.rootOf);
      await this.makeDirectory(join(fallback, folderName), { recursive: true });
      this.logger.warn(
        'quarantine',
        'QUARANTINE_ROOT_FALLBACK',
        `Không tạo được khu cách ly ở ${primary} (${error instanceof Error ? error.message : String(error)}); dùng ${fallback} trên cùng ổ.`,
        {
          jobId: context.jobId,
          ...(context.projectId ? { projectId: context.projectId } : {}),
          metadata: { primary, fallback }
        }
      );
      return fallback;
    }
  }

  /**
   * B3: bản mới đã tải xong → các bản cũ đang chờ của cùng nguồn (dù được cách ly ở lượt trước, phiên trước,
   * hay bởi tác vụ khác) được đánh dấu "đã có bản thay" và GIỮ NGUYÊN trong khu cách ly.
   */
  public settleReplacement(input: {
    jobId: string;
    projectId: string | null;
    sourceId: string | null;
    replacementPath: string;
  }): Promise<QuarantineItem[]> {
    if (!this.items) return Promise.resolve([]);
    const pending = this.items.listAwaitingReplacement(input.sourceId, input.jobId);
    const settled: QuarantineItem[] = [];
    for (const item of pending) {
      this.items.markReplaced(item.id, input.replacementPath);
      const updated = this.items.get(item.id) ?? item;
      settled.push(updated);
      this.logger.info(
        'download',
        'SOURCE_OLD_VERSION_KEPT',
        `Đã giữ bản cũ của ${basename(item.originalPath)} (${formatBytes(item.bytes)}) trong khu cách ly ${dirname(item.quarantinePath)}. Bản mới đã đạt chính sách chất lượng; Tubmedia không tự xóa bản cũ.`,
        {
          jobId: input.jobId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          metadata: { keptBackup: item.quarantinePath, replacement: input.replacementPath, bytes: item.bytes }
        }
      );
    }
    return Promise.resolve(settled);
  }

  public async overview(): Promise<QuarantineOverview> {
    const projects = this.projects?.list?.(true) ?? [];
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const items: QuarantineOverviewItem[] = await Promise.all(
      (this.items?.listActive() ?? []).map(async (item) => {
        const info = await lstat(item.quarantinePath).catch(() => null);
        return {
          ...item,
          projectName: item.projectId ? (names.get(item.projectId) ?? null) : null,
          exists: Boolean(info?.isFile())
        };
      })
    );
    const present = items.filter((item) => item.exists);
    const totalBytes = present.reduce((sum, item) => sum + item.bytes, 0);

    const perDrive = new Map<string, number>();
    for (const item of present) {
      const root = this.rootOf(item.quarantinePath);
      perDrive.set(root, (perDrive.get(root) ?? 0) + item.bytes);
    }
    const drives: QuarantineDriveUsage[] = [];
    for (const [root, quarantineBytes] of perDrive) {
      const space = await this.statfs(root).catch(() => null);
      drives.push({ root, quarantineBytes, freeBytes: space?.freeBytes ?? null, totalBytes: space?.totalBytes ?? null });
    }

    const warnings: string[] = [];
    if (totalBytes > this.warnBytes) {
      warnings.push(
        `Khu cách ly đang chiếm ${formatBytes(totalBytes)}, vượt ngưỡng ${formatBytes(this.warnBytes)}. Hãy xem lại và xóa các bản cũ không cần nữa.`
      );
    }
    for (const drive of drives) {
      if (drive.freeBytes === null || !drive.totalBytes) continue;
      if (drive.freeBytes / drive.totalBytes < this.warnFreeRatio) {
        warnings.push(
          `Ổ ${drive.root} chỉ còn ${formatBytes(drive.freeBytes)} trống (dưới ${Math.round(this.warnFreeRatio * 100)}%); khu cách ly trên ổ này đang chiếm ${formatBytes(drive.quarantineBytes)}.`
        );
      }
    }

    return { items, totalBytes, drives, warnings, legacyFolders: await findLegacyQuarantineFolders(projects) };
  }

  /** "Xóa các bản cũ đã chọn" — chỉ xóa tệp thường nằm thật trong một …\Tubmedia\quarantine\… (gốc ổ hoặc thư mục lùi), ghi nhật ký từng tệp. */
  public async deleteItems(ids: readonly string[]): Promise<QuarantineDeleteOutcome[]> {
    const results: QuarantineDeleteOutcome[] = [];
    for (const id of ids) {
      const item = this.items?.get(id);
      if (!item || item.deletedAt) {
        results.push({ id, ok: false, message: 'Không tìm thấy mục này trong khu cách ly.' });
        continue;
      }
      if (!isInsideAnyQuarantineFolder(item.quarantinePath)) {
        results.push({ id, ok: false, message: 'Đường dẫn không nằm trong khu cách ly — Tubmedia không xóa.' });
        continue;
      }
      const info = await lstat(item.quarantinePath).catch(() => null);
      if (info && (info.isSymbolicLink() || !info.isFile())) {
        results.push({ id, ok: false, message: 'Không phải tệp thường — Tubmedia không xóa.' });
        continue;
      }
      try {
        if (info) await rm(item.quarantinePath, { force: true });
      } catch (error) {
        results.push({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      this.items!.markDeleted(id);
      const bytes = info?.size ?? 0;
      this.logger.info(
        'quarantine',
        'QUARANTINE_ITEM_DELETED',
        info
          ? `Đã xóa ${basename(item.quarantinePath)} (${formatBytes(bytes)}) khỏi khu cách ly theo yêu cầu của người dùng.`
          : `${basename(item.quarantinePath)} không còn trên ổ; đã bỏ khỏi danh sách khu cách ly.`,
        {
          ...(item.projectId ? { projectId: item.projectId } : {}),
          metadata: { path: item.quarantinePath, originalPath: item.originalPath, bytes }
        }
      );
      results.push({ id, ok: true });
    }
    return results;
  }
}
