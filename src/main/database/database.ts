import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './migrations.js';
import { runInTransaction, type SqliteDatabase } from './sqlite.js';
import { DatabaseMigrationError } from '@shared/errors/app-errors.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? 'Lỗi không xác định';
  } catch {
    return 'Lỗi không xác định';
  }
}

export class AppDatabase {
  public readonly db: SqliteDatabase;

  public constructor(public readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
    );
    const appliedRows = this.db
      .prepare('SELECT version FROM schema_migrations')
      .all() as Array<{ version: number }>;
    const applied = new Set<number>(appliedRows.map((row) => Number(row.version)));

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      try {
        runInTransaction(this.db, () => {
          this.db.exec(migration.up);
          this.db
            .prepare(
              'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)'
            )
            .run(migration.version, migration.name, new Date().toISOString());
        });
      } catch (error) {
        throw new DatabaseMigrationError(
          `Migration ${migration.version} (${migration.name}) thất bại: ${errorMessage(error)}`
        );
      }
    }
  }

  public checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  public integrityCheck(): string[] {
    const rows = this.db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    return rows.map((row) => row.integrity_check);
  }

  public close(): void {
    this.checkpoint();
    this.db.close();
  }
}
