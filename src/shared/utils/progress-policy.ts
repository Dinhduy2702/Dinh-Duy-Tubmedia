import type { JobStatus } from '../types/domain.js';

const ANIMATED_PROGRESS_STATUSES: ReadonlySet<JobStatus> = new Set([
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying'
]);

export function shouldAnimateJobProgress(status: JobStatus): boolean {
  return ANIMATED_PROGRESS_STATUSES.has(status);
}

export function sanitizeProgress(value: number, fallback = 0): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : 0;
  const candidate = Number.isFinite(value) ? value : safeFallback;
  return Math.max(0, Math.min(100, candidate));
}

export function sanitizeNullableSeconds(
  value: number | null | undefined,
  fallback: number | null = null
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) {
    return fallback !== null && Number.isFinite(fallback)
      ? Math.max(0, Math.floor(fallback))
      : null;
  }
  return Math.max(0, Math.floor(value));
}

export function sanitizeNonNegativeNumber(value: number, fallback = 0): number {
  const safeFallback = Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
  return Number.isFinite(value) ? Math.max(0, value) : safeFallback;
}
