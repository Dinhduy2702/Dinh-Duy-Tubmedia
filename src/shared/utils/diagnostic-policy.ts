import type { LogEntry, QueueJob } from '../types/domain.js';
import { isCookieBlockingCode } from './cookie-policy.js';

const NON_ACTIONABLE_EVENT_CODES = new Set([
  'TOOL_RELEASE_API_DIRECT_FALLBACK',
  'PROCESS_STARTED',
  'PROCESS_FINISHED',
  'TOOLS_AUTO_CONNECTED',
  'JOB_RETRY_SCHEDULED',
  'COOKIE_RETRY_SCHEDULED',
  'COOKIE_BLOCKS_AUTO_RESUMED',
  'LEGACY_SIZE_ESTIMATE_FAILURES_RECOVERED',
  'SOURCE_CACHE_MISSING',
  'DOWNLOAD_QUALITY_FALLBACK',
  'DOWNLOAD_SIZE_ESTIMATE_MISMATCH'
]);

const BLOCKING_STATUSES: ReadonlySet<QueueJob['status']> = new Set(['paused', 'interrupted', 'failed']);

export const TRANSIENT_DIAGNOSTIC_DURATION_MS = 8_000;

export function isActionableDiagnostic(entry: Pick<LogEntry, 'level' | 'eventCode'>): boolean {
  if (NON_ACTIONABLE_EVENT_CODES.has(entry.eventCode)) return false;
  return entry.level === 'error' || entry.level === 'warn';
}

export function isDiagnosticStillBlocking(
  entry: Pick<LogEntry, 'jobId' | 'projectId' | 'eventCode'>,
  jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[]
): boolean {
  const candidates = jobs.filter((job) => {
    if (!BLOCKING_STATUSES.has(job.status)) return false;
    if (entry.jobId) return job.id === entry.jobId;
    if (entry.projectId) return job.projectId === entry.projectId;
    return false;
  });
  if (candidates.length === 0) return false;
  return candidates.some((job) => {
    if (entry.eventCode === 'JOB_FAILED') return Boolean(job.errorCode);
    if (entry.eventCode === job.errorCode) return true;
    if (isCookieBlockingCode(entry.eventCode) && isCookieBlockingCode(job.errorCode)) {
      return true;
    }
    return entry.eventCode.endsWith('_FAILED') && Boolean(job.errorCode);
  });
}

export function shouldDisplayDiagnostic(
  entry: LogEntry,
  jobs: readonly Pick<QueueJob, 'id' | 'projectId' | 'status' | 'errorCode'>[],
  now = Date.now()
): boolean {
  if (!isActionableDiagnostic(entry)) return false;
  if (entry.jobId || entry.projectId) {
    return isDiagnosticStillBlocking(entry, jobs);
  }
  const timestamp = Date.parse(entry.timestamp);
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp <= TRANSIENT_DIAGNOSTIC_DURATION_MS;
}
