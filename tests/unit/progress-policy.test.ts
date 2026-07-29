import { describe, expect, it } from 'vitest';
import type { JobStatus } from '../../src/shared/types/domain.js';
import {
  sanitizeNonNegativeNumber,
  sanitizeNullableSeconds,
  sanitizeProgress,
  shouldAnimateJobProgress
} from '@shared/utils/progress-policy.js';

describe('progress animation policy', () => {
  it.each<JobStatus>([
    'analyzing',
    'downloading',
    'verifying',
    'normalizing',
    'processing',
    'merging',
    'retrying'
  ])('animates while the job is actively moving: %s', (status) => {
    expect(shouldAnimateJobProgress(status)).toBe(true);
  });

  it.each<JobStatus>([
    'pending',
    'ready',
    'downloaded',
    'paused',
    'completed',
    'skipped',
    'cancelled',
    'failed',
    'interrupted'
  ])('keeps the bar still when the job is not actively moving: %s', (status) => {
    expect(shouldAnimateJobProgress(status)).toBe(false);
  });
});


describe('progress value safety', () => {
  it('never lets NaN or Infinity reach the database progress column', () => {
    expect(sanitizeProgress(Number.NaN, 65)).toBe(65);
    expect(sanitizeProgress(Number.POSITIVE_INFINITY, 20)).toBe(20);
    expect(sanitizeProgress(-50)).toBe(0);
    expect(sanitizeProgress(150)).toBe(100);
  });

  it('normalizes invalid ETA and auxiliary progress numbers', () => {
    expect(sanitizeNullableSeconds(Number.NaN, 12)).toBe(12);
    expect(sanitizeNullableSeconds(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sanitizeNonNegativeNumber(Number.NaN, 4)).toBe(4);
    expect(sanitizeNonNegativeNumber(-2)).toBe(0);
  });
});
