import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../sqlite.js';
import type { QuarantineItem, QuarantineItemKind } from '@shared/types/domain.js';

interface Row {
  id: string;
  project_id: string | null;
  job_id: string | null;
  source_id: string | null;
  kind: QuarantineItemKind;
  original_path: string;
  quarantine_path: string;
  bytes: number;
  reason: string;
  created_at: string;
  replacement_path: string | null;
  replaced_at: string | null;
  deleted_at: string | null;
}

const map = (row: Row): QuarantineItem => ({
  id: row.id,
  projectId: row.project_id,
  jobId: row.job_id,
  sourceId: row.source_id,
  kind: row.kind,
  originalPath: row.original_path,
  quarantinePath: row.quarantine_path,
  bytes: Number(row.bytes),
  reason: row.reason,
  createdAt: row.created_at,
  replacementPath: row.replacement_path,
  replacedAt: row.replaced_at,
  deletedAt: row.deleted_at
});

/** Mục 5 (2026-10-02): sổ theo dõi khu cách ly — một dòng cho mỗi tệp tới khi người dùng xóa. */
export class QuarantineRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  public add(input: {
    projectId: string | null;
    jobId: string | null;
    sourceId: string | null;
    kind: QuarantineItemKind;
    originalPath: string;
    quarantinePath: string;
    bytes: number;
    reason: string;
  }): QuarantineItem {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO quarantine_items(id,project_id,job_id,source_id,kind,original_path,quarantine_path,bytes,reason,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.projectId,
        input.jobId,
        input.sourceId,
        input.kind,
        input.originalPath,
        input.quarantinePath,
        input.bytes,
        input.reason,
        new Date().toISOString()
      );
    return this.get(id)!;
  }

  public get(id: string): QuarantineItem | null {
    const row = this.db.prepare('SELECT * FROM quarantine_items WHERE id=?').get(id) as Row | undefined;
    return row ? map(row) : null;
  }

  public listActive(): QuarantineItem[] {
    return (
      this.db.prepare('SELECT * FROM quarantine_items WHERE deleted_at IS NULL ORDER BY created_at, rowid').all() as unknown as Row[]
    ).map(map);
  }

  /** Bản cũ đang chờ bản mới — theo nguồn (mọi tác vụ của cùng nguồn) hoặc theo đúng tác vụ. */
  public listAwaitingReplacement(sourceId: string | null, jobId: string): QuarantineItem[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM quarantine_items
           WHERE kind='outdated-source' AND replaced_at IS NULL AND deleted_at IS NULL
             AND ((? IS NOT NULL AND source_id=?) OR job_id=?)
           ORDER BY created_at, rowid`
        )
        .all(sourceId, sourceId, jobId) as unknown as Row[]
    ).map(map);
  }

  public markReplaced(id: string, replacementPath: string): void {
    this.db
      .prepare('UPDATE quarantine_items SET replacement_path=?, replaced_at=? WHERE id=? AND replaced_at IS NULL')
      .run(replacementPath, new Date().toISOString(), id);
  }

  public markDeleted(id: string): void {
    this.db.prepare('UPDATE quarantine_items SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(new Date().toISOString(), id);
  }
}
