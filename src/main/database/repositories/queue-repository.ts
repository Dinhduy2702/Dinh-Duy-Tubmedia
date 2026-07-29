import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../sqlite.js';
import type { JobStatus, JobType, QueueJob } from '@shared/types/domain.js';
import { containsUnicodeReplacement } from '@shared/utils/text-encoding.js';
import { sanitizeNullableSeconds, sanitizeProgress } from '@shared/utils/progress-policy.js';
import { assertJobTransition } from '@shared/utils/job-state-machine.js';
import { parseJsonRecord } from '@shared/utils/safe-json.js';
interface Row {
  id: string;
  project_id: string | null;
  type: JobType;
  status: JobStatus;
  priority: number;
  source_id: string | null;
  item_id: string | null;
  input_json: string;
  progress: number;
  speed: string | null;
  eta_seconds: number | null;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}
const map = (r: Row): QueueJob => ({
  id: r.id,
  projectId: r.project_id,
  type: r.type,
  status: r.status,
  priority: r.priority,
  sourceId: r.source_id,
  itemId: r.item_id,
  input: parseJsonRecord(r.input_json),
  progress: sanitizeProgress(r.progress, 0),
  speed: r.speed,
  etaSeconds: sanitizeNullableSeconds(r.eta_seconds),
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  errorCode: r.error_code,
  errorMessage: r.error_message,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at
});
export class QueueRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public list(projectId?: string): QueueJob[] {
    const rows = projectId
      ? this.db
          .prepare('SELECT * FROM queue_jobs WHERE project_id=? ORDER BY priority DESC,created_at')
          .all(projectId)
      : this.db.prepare('SELECT * FROM queue_jobs ORDER BY priority DESC,created_at').all();
    return (rows as unknown as Row[]).map(map);
  }
  public next(types?: JobType[]): QueueJob | null {
    let row: Row | undefined;
    if (types?.length) {
      const p = types.map(() => '?').join(',');
      row = this.db
        .prepare(
          `SELECT * FROM queue_jobs WHERE status='pending' AND type IN (${p}) ORDER BY priority DESC,created_at LIMIT 1`
        )
        .get(...types) as Row | undefined;
    } else
      row = this.db
        .prepare("SELECT * FROM queue_jobs WHERE status='pending' ORDER BY priority DESC,created_at LIMIT 1")
        .get() as Row | undefined;
    return row ? map(row) : null;
  }
  public create(input: {
    projectId: string | null;
    type: JobType;
    sourceId?: string | null;
    itemId?: string | null;
    input: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
  }): QueueJob {
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO queue_jobs(id,project_id,type,status,priority,source_id,item_id,input_json,progress,speed,eta_seconds,attempts,max_attempts,error_code,error_message,created_at,updated_at,started_at,finished_at) VALUES(?,?,?,'pending',?,?,?,?,0,NULL,NULL,0,?,NULL,NULL,?,?,NULL,NULL)`
      )
      .run(
        id,
        input.projectId,
        input.type,
        input.priority ?? 0,
        input.sourceId ?? null,
        input.itemId ?? null,
        JSON.stringify(input.input),
        input.maxAttempts ?? 3,
        now,
        now
      );
    return this.get(id)!;
  }
  public get(id: string): QueueJob | null {
    const row = this.db.prepare('SELECT * FROM queue_jobs WHERE id=?').get(id) as Row | undefined;
    return row ? map(row) : null;
  }
  public update(
    id: string,
    patch: Partial<
      Pick<
        QueueJob,
        | 'status'
        | 'progress'
        | 'speed'
        | 'etaSeconds'
        | 'attempts'
        | 'errorCode'
        | 'errorMessage'
        | 'startedAt'
        | 'finishedAt'
      >
    >,
    inputPatch?: Record<string, unknown>
  ): QueueJob {
    const current = this.get(id);
    if (!current) throw new Error('Tác vụ không tồn tại.');
    if (patch.status) assertJobTransition(current.status, patch.status);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const safeProgress = sanitizeProgress(next.progress, current.progress);
    const safeEta = sanitizeNullableSeconds(next.etaSeconds, current.etaSeconds);
    const safeAttempts = Number.isFinite(next.attempts)
      ? Math.max(0, Math.floor(next.attempts))
      : current.attempts;
    const input = inputPatch ? { ...current.input, ...inputPatch } : current.input;
    this.db
      .prepare(
        `UPDATE queue_jobs SET status=?,progress=?,speed=?,eta_seconds=?,attempts=?,error_code=?,error_message=?,input_json=?,updated_at=?,started_at=?,finished_at=? WHERE id=?`
      )
      .run(
        next.status,
        safeProgress,
        next.speed,
        safeEta,
        safeAttempts,
        next.errorCode,
        next.errorMessage,
        JSON.stringify(input),
        next.updatedAt,
        next.startedAt,
        next.finishedAt,
        id
      );
    return this.get(id)!;
  }
  public updateInput(id: string, patch: Record<string, unknown>): QueueJob {
    const current = this.get(id);
    if (!current) throw new Error('Tác vụ không tồn tại.');
    const next = { ...current.input, ...patch };
    this.db
      .prepare('UPDATE queue_jobs SET input_json=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(next), new Date().toISOString(), id);
    return this.get(id)!;
  }
  public recoverInterrupted(): number {
    return Number(
      this.db
        .prepare(
          "UPDATE queue_jobs SET status='interrupted',updated_at=? WHERE status IN ('analyzing','downloading','verifying','normalizing','processing','merging','retrying')"
        )
        .run(new Date().toISOString()).changes
    );
  }
  public resetInterrupted(): number {
    return Number(
      this.db
        .prepare(
          "UPDATE queue_jobs SET status='pending',progress=0,error_code=NULL,error_message=NULL,updated_at=? WHERE status='interrupted'"
        )
        .run(new Date().toISOString()).changes
    );
  }
  public retryFailed(projectId?: string): number {
    const sql = projectId
      ? "UPDATE queue_jobs SET status='pending',error_code=NULL,error_message=NULL,progress=0,updated_at=? WHERE status='failed' AND project_id=?"
      : "UPDATE queue_jobs SET status='pending',error_code=NULL,error_message=NULL,progress=0,updated_at=? WHERE status='failed'";
    return Number(
      (projectId
        ? this.db.prepare(sql).run(new Date().toISOString(), projectId)
        : this.db.prepare(sql).run(new Date().toISOString())
      ).changes
    );
  }
  public repairCorruptedDisplayNames(): number {
    let changed = 0;
    for (const job of this.list()) {
      const displayName = job.input.displayName;
      if (!containsUnicodeReplacement(displayName)) continue;
      const url =
        typeof job.input.url === 'string' && job.input.url.trim()
          ? job.input.url.trim()
          : 'Đang đọc lại tên video';
      this.updateInput(job.id, { displayName: url });
      changed += 1;
    }
    return changed;
  }
  public recoverToolBlocked(): { jobs: number; projectIds: string[] } {
    const all = this.list();
    const toolCodes = new Set(['TOOL_NOT_FOUND', 'TOOL_HEALTH_CHECK_FAILED']);
    const blocked = all.filter((job) => {
      if (job.status !== 'failed' && job.status !== 'paused') return false;
      const message = (job.errorMessage ?? '').toLowerCase();
      return (
        toolCodes.has(job.errorCode ?? '') ||
        message.includes('không tìm thấy công cụ yt-dlp') ||
        message.includes('không tìm thấy công cụ ffmpeg') ||
        message.includes('không tìm thấy công cụ ffprobe') ||
        message.includes('thiếu công cụ bắt buộc')
      );
    });
    const blockedIds = new Set(blocked.map((job) => job.id));
    const projectIds = [
      ...new Set(
        blocked.map((job) => job.projectId).filter((value): value is string => typeof value === 'string')
      )
    ];
    const projectSet = new Set(projectIds);
    const recoverable = all.filter(
      (job) =>
        blockedIds.has(job.id) ||
        (Boolean(job.projectId) &&
          projectSet.has(job.projectId!) &&
          job.status === 'failed' &&
          job.errorCode === 'DEPENDENCY_FAILED')
    );
    for (const job of recoverable)
      this.update(job.id, {
        status: 'pending',
        progress: 0,
        speed: null,
        etaSeconds: null,
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null
      });
    return { jobs: recoverable.length, projectIds };
  }
  public releaseInheritedCookieBlocks(): number {
    const cookieCodes = new Set([
      'AUTHENTICATION_REQUIRED',
      'COOKIES_EXPIRED',
      'BROWSER_COOKIE_DATABASE_LOCKED'
    ]);
    const inherited = this.list().filter(
      (job) =>
        job.status === 'paused' &&
        cookieCodes.has(job.errorCode ?? '') &&
        job.input.cookieFailureConfirmed !== true
    );
    for (const job of inherited)
      this.update(job.id, {
        status: 'pending',
        speed: null,
        etaSeconds: null,
        errorCode: null,
        errorMessage: null,
        finishedAt: null
      });
    return inherited.length;
  }
  public recoverLegacySizeEstimateFailures(): number {
    const legacy = this.list().filter(
      (job) =>
        job.status === 'failed' &&
        job.errorCode === 'DOWNLOAD_FAILED' &&
        (job.errorMessage ?? '').includes('Tệp tải về có dung lượng thấp bất thường')
    );
    for (const job of legacy)
      this.update(
        job.id,
        {
          status: 'pending',
          progress: 0,
          speed: null,
          etaSeconds: null,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null
        },
        { progressStage: 'Đang tải lại sau khi sửa kiểm tra dung lượng ước tính' }
      );
    return legacy.length;
  }
  public clearProject(projectId: string): number {
    return Number(this.db.prepare('DELETE FROM queue_jobs WHERE project_id=?').run(projectId).changes);
  }

  public remove(id: string): number {
    return Number(this.db.prepare('DELETE FROM queue_jobs WHERE id=?').run(id).changes);
  }
  public clearAll(): number {
    return Number(this.db.prepare('DELETE FROM queue_jobs').run().changes);
  }
  public clearFinished(projectId?: string): number {
    const terminal = ['completed', 'skipped', 'cancelled', 'failed'];
    const marks = terminal.map(() => '?').join(',');
    const sql = projectId
      ? `DELETE FROM queue_jobs WHERE project_id=? AND status IN (${marks})`
      : `DELETE FROM queue_jobs WHERE status IN (${marks})`;
    const result = projectId
      ? this.db.prepare(sql).run(projectId, ...terminal)
      : this.db.prepare(sql).run(...terminal);
    return Number(result.changes);
  }
}
