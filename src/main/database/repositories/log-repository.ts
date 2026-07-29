import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../sqlite.js';
import type { LogEntry } from '@shared/types/domain.js';

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function requiredString(value: unknown): string {
  return optionalString(value) ?? '';
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export class LogRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  public insert(entry: Omit<LogEntry, 'id'>): LogEntry {
    const full: LogEntry = { id: randomUUID(), ...entry };
    this.db
      .prepare(
        'INSERT INTO event_logs(id,timestamp,level,module,project_id,job_id,attempt_id,event_code,message,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        full.id,
        full.timestamp,
        full.level,
        full.module,
        full.projectId ?? null,
        full.jobId ?? null,
        full.attemptId ?? null,
        full.eventCode,
        full.message,
        full.metadata ? JSON.stringify(full.metadata) : null
      );
    return full;
  }

  public list(query: {
    projectId?: string;
    jobId?: string;
    level?: string;
    module?: string;
    limit: number;
  }): LogEntry[] {
    const where: string[] = [];
    const args: Array<string | number | null> = [];
    if (query.projectId) {
      where.push('project_id=?');
      args.push(query.projectId);
    }
    if (query.jobId) {
      where.push('job_id=?');
      args.push(query.jobId);
    }
    if (query.level) {
      where.push('level=?');
      args.push(query.level);
    }
    if (query.module) {
      where.push('module=?');
      args.push(query.module);
    }
    args.push(query.limit);

    const rows = this.db
      .prepare(
        `SELECT * FROM event_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY timestamp DESC LIMIT ?`
      )
      .all(...args) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const projectId = optionalString(row.project_id);
      const jobId = optionalString(row.job_id);
      const attemptId = optionalString(row.attempt_id);
      const metadata = parseMetadata(row.metadata_json);
      return {
        id: requiredString(row.id),
        timestamp: requiredString(row.timestamp),
        level: requiredString(row.level) as LogEntry['level'],
        module: requiredString(row.module),
        ...(projectId ? { projectId } : {}),
        ...(jobId ? { jobId } : {}),
        ...(attemptId ? { attemptId } : {}),
        eventCode: requiredString(row.event_code),
        message: requiredString(row.message),
        ...(metadata ? { metadata } : {})
      };
    });
  }

  public clear(projectId?: string): number {
    const result = projectId
      ? this.db.prepare('DELETE FROM event_logs WHERE project_id=?').run(projectId)
      : this.db.prepare('DELETE FROM event_logs').run();
    return Number(result.changes);
  }

  public prune(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return Number(
      this.db.prepare('DELETE FROM event_logs WHERE timestamp<?').run(cutoff).changes
    );
  }
}
