import type { JobStatus, JobType } from '../types/domain.js';
import { InvalidInputError } from '../errors/app-errors.js';

const allowedTransitions: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  pending: new Set([
    'analyzing',
    'downloading',
    'processing',
    'normalizing',
    'verifying',
    'merging',
    'paused',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  analyzing: new Set([
    'ready',
    'downloading',
    'processing',
    'verifying',
    'retrying',
    'paused',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  ready: new Set([
    'pending',
    'downloading',
    'processing',
    'normalizing',
    'verifying',
    'merging',
    'paused',
    'cancelled',
    'failed'
  ]),
  downloading: new Set([
    'downloaded',
    'processing',
    'verifying',
    'retrying',
    'paused',
    'completed',
    'skipped',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  downloaded: new Set([
    'processing',
    'verifying',
    'paused',
    'completed',
    'skipped',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  verifying: new Set([
    'analyzing',
    'downloading',
    'processing',
    'retrying',
    'paused',
    'completed',
    'skipped',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  normalizing: new Set(['retrying', 'paused', 'completed', 'cancelled', 'failed', 'interrupted']),
  processing: new Set([
    'verifying',
    'retrying',
    'paused',
    'completed',
    'skipped',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  merging: new Set(['retrying', 'paused', 'completed', 'cancelled', 'failed', 'interrupted']),
  paused: new Set([
    'pending',
    'analyzing',
    'downloading',
    'processing',
    'normalizing',
    'verifying',
    'merging',
    'cancelled',
    'failed',
    'interrupted'
  ]),
  retrying: new Set(['pending', 'paused', 'cancelled', 'failed', 'interrupted']),
  completed: new Set(),
  skipped: new Set(),
  cancelled: new Set(),
  failed: new Set(['pending', 'cancelled']),
  interrupted: new Set(['pending', 'paused', 'cancelled'])
};

export function initialJobStatus(type: JobType): JobStatus {
  switch (type) {
    case 'analyze':
      return 'analyzing';
    case 'download':
      return 'analyzing';
    case 'clip':
      return 'processing';
    case 'normalize':
      return 'normalizing';
    case 'merge':
      return 'merging';
    case 'verify':
      return 'verifying';
  }
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return from === to || allowedTransitions[from].has(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new InvalidInputError(`Không thể chuyển tác vụ từ ${from} sang ${to}.`);
  }
}
