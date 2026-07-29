import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../database/database.js';
import { migrations } from '../database/migrations.js';
import {
  backupSqliteDatabase,
  runInTransaction
} from '../database/sqlite.js';
import type { Logger } from '../logging/logger.js';
import { InvalidInputError } from '@shared/errors/app-errors.js';

export interface BackupPreview {
  path: string;
  createdAt: string | null;
  appVersion: string | null;
  projects: Array<{ id: string; name: string; updatedAt: string }>;
  schemaVersion: number;
}

export class BackupService {
  public constructor(
    private readonly database: AppDatabase,
    private readonly backupFolder: string,
    private readonly logger: Logger
  ) {}

  public async create(
    projectId?: string,
    includeMedia = false,
    category: 'manual' | 'update' = 'manual'
  ): Promise<string> {
    if (includeMedia) {
      throw new InvalidInputError(
        'Backup kèm media chưa được triển khai an toàn nên tùy chọn này đã bị chặn thay vì tạo bản sao lưu giả.'
      );
    }
    const targetFolder = category === 'update' ? join(this.backupFolder, 'updates') : this.backupFolder;
    await mkdir(targetFolder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = category === 'update' ? 'Tubmedia-before-update' : 'VideoStudioPro';
    const path = join(targetFolder, `${prefix}-${stamp}.vdmsp-backup.sqlite`);
    this.database.checkpoint();
    await backupSqliteDatabase(this.database.db, path);
    await writeFile(
      `${path}.json`,
      JSON.stringify(
        {
          format: 1,
          createdAt: new Date().toISOString(),
          appVersion: app.getVersion(),
          projectId: projectId ?? null,
          includeMedia,
          category
        },
        null,
        2
      ),
      'utf8'
    );
    this.database.db
      .prepare(
        'INSERT INTO backup_history(id,project_id,path,include_media,status,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)'
      )
      .run(
        randomUUID(),
        projectId ?? null,
        path,
        includeMedia ? 1 : 0,
        'completed',
        JSON.stringify({ file: basename(path) }),
        new Date().toISOString()
      );
    if (category === 'update') {
      try {
        await this.pruneUpdateBackups();
      } catch (error) {
        this.logger.warn(
          'backup',
          'UPDATE_BACKUP_RETENTION_WARNING',
          `Đã tạo backup nhưng chưa dọn được bản update cũ: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    this.logger.info('backup', 'BACKUP_CREATED', `Đã tạo bản sao lưu ${path}.`, {
      ...(projectId ? { projectId } : {})
    });
    return path;
  }

  private async pruneUpdateBackups(maxPairs = 5): Promise<void> {
    const folder = join(this.backupFolder, 'updates');
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch {
      return;
    }
    const databases = await Promise.all(entries
      .filter((name) => name.endsWith('.vdmsp-backup.sqlite'))
      .map(async (name) => {
        const path = join(folder, name);
        return { path, mtime: (await stat(path)).mtimeMs };
      }));
    databases.sort((left, right) => right.mtime - left.mtime);
    for (const old of databases.slice(Math.max(1, maxPairs))) {
      await rm(old.path, { force: true });
      await rm(`${old.path}.json`, { force: true });
    }
  }

  public preview(path: string): BackupPreview {
    if (!existsSync(path)) throw new Error(`Không tìm thấy tệp sao lưu: ${path}`);
    let metadata: { createdAt?: string; appVersion?: string } = {};
    try {
      const metadataPath = `${path}.json`;
      if (existsSync(metadataPath)) {
        metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as typeof metadata;
      }
    } catch {
      // Backup database vẫn hợp lệ ngay cả khi sidecar metadata bị thiếu/hỏng.
    }
    const source = new DatabaseSync(path, { readOnly: true });
    try {
      const projects = source
        .prepare('SELECT id,name,updated_at FROM projects ORDER BY updated_at DESC')
        .all() as Array<{ id: string; name: string; updated_at: string }>;
      const version = Number(
        (
          source
            .prepare('SELECT COALESCE(MAX(version),0) version FROM schema_migrations')
            .get() as { version: number }
        ).version
      );
      return {
        path,
        createdAt: metadata.createdAt ?? null,
        appVersion: metadata.appVersion ?? null,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          updatedAt: project.updated_at
        })),
        schemaVersion: version
      };
    } finally {
      source.close();
    }
  }

  public restore(path: string, mode: 'merge' | 'replace'): { projects: number } {
    if (!existsSync(path)) throw new Error(`Không tìm thấy tệp sao lưu: ${path}`);
    const preview = this.preview(path);
    const currentSchemaVersion = Math.max(0, ...migrations.map((migration) => migration.version));
    if (preview.schemaVersion > currentSchemaVersion) {
      throw new InvalidInputError(
        `Backup dùng schema ${preview.schemaVersion}, mới hơn schema ứng dụng ${currentSchemaVersion}.`
      );
    }

    const sourceCheck = new DatabaseSync(path, { readOnly: true });
    try {
      const integrity = sourceCheck.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      if (integrity.some((row) => row.integrity_check !== 'ok')) {
        throw new InvalidInputError(`Backup SQLite bị hỏng: ${JSON.stringify(integrity)}`);
      }
      const foreignKeys = sourceCheck.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeys.length > 0) {
        throw new InvalidInputError(`Backup có ${foreignKeys.length} lỗi khóa ngoại.`);
      }
    } finally {
      sourceCheck.close();
    }

    const safePath = path.replaceAll("'", "''");
    const target = this.database.db;
    const tables = [
      'projects',
      'project_settings',
      'input_batches',
      'project_items',
      'media_sources',
      'source_files',
      'queue_jobs',
      'output_files',
      'resource_profiles',
      'quality_profiles',
      'app_settings'
    ];

    target.exec(`ATTACH DATABASE '${safePath}' AS backupdb`);
    if (mode === 'replace') target.exec('PRAGMA foreign_keys = OFF');
    try {
      runInTransaction(target, () => {
        if (mode === 'replace') {
          for (const table of [
            'output_files',
            'queue_jobs',
            'project_items',
            'input_batches',
            'project_settings',
            'source_files',
            'media_sources',
            'projects'
          ]) {
            target.exec(`DELETE FROM main.${table}`);
          }
        }

        for (const table of tables) {
          const exists = target
            .prepare(
              "SELECT 1 FROM backupdb.sqlite_master WHERE type='table' AND name=?"
            )
            .get(table);
          if (!exists) continue;
          const columns = (
            target.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{
              name: string;
            }>
          ).map((column) => column.name);
          const backupColumns = new Set(
            (
              target.prepare(`PRAGMA backupdb.table_info(${table})`).all() as Array<{
                name: string;
              }>
            ).map((column) => column.name)
          );
          const common = columns.filter((column) => backupColumns.has(column));
          if (common.length === 0) continue;
          target.exec(
            `INSERT OR REPLACE INTO main.${table}(${common.join(',')}) SELECT ${common.join(',')} FROM backupdb.${table}`
          );
        }

        const integrity = target.prepare('PRAGMA main.integrity_check').all() as Array<{ integrity_check: string }>;
        if (integrity.some((row) => row.integrity_check !== 'ok')) {
          throw new InvalidInputError(`Database sau phục hồi bị hỏng: ${JSON.stringify(integrity)}`);
        }
        const foreignKeys = target.prepare('PRAGMA main.foreign_key_check').all();
        if (foreignKeys.length > 0) {
          throw new InvalidInputError(`Database sau phục hồi có ${foreignKeys.length} lỗi khóa ngoại.`);
        }
      });
    } finally {
      if (mode === 'replace') target.exec('PRAGMA foreign_keys = ON');
      target.exec('DETACH DATABASE backupdb');
    }

    const count = Number(
      (target.prepare('SELECT COUNT(*) count FROM projects').get() as { count: number }).count
    );
    this.logger.info(
      'backup',
      'BACKUP_RESTORED',
      `Đã phục hồi ${count} dự án từ ${path}.`
    );
    return { projects: count };
  }
}
