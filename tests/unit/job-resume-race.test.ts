import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canTransitionJob, resolveResumeStatus } from '../../src/shared/utils/job-state-machine.js';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('race-safe queue resume', () => {
  it('keeps the live downloading phase when a progress callback wins the resume race', () => {
    const target = resolveResumeStatus('downloading', 'analyzing', 'download');
    expect(target).toBe('downloading');
    expect(canTransitionJob('downloading', target)).toBe(true);
  });

  it('restores the remembered phase when the repository is still paused', () => {
    expect(resolveResumeStatus('paused', 'downloading', 'download')).toBe('downloading');
    expect(resolveResumeStatus('paused', 'verifying', 'download')).toBe('verifying');
    expect(canTransitionJob('paused', 'downloading')).toBe(true);
    expect(canTransitionJob('paused', 'verifying')).toBe(true);
  });

  it('uses pending for interrupted or inactive retries', () => {
    expect(resolveResumeStatus('interrupted', 'downloading', 'download')).toBe('pending');
    expect(resolveResumeStatus('paused', 'retrying', 'download')).toBe('analyzing');
  });

  it('re-reads repository state after process resume and shares the resolver with DISK_FULL recovery', () => {
    const queue = source('src/main/queue/queue-manager.ts');
    expect(queue).toContain('TUBMEDIA RACE SAFE RESUME R29');
    expect(queue).toContain('const observed = this.repo.get(current.id)');
    expect(queue).toContain('resolveResumeStatus(');
    expect(queue).toContain('await this.resumeActiveJobState(current, active, preserveCookieMarker)');
    expect(queue).toContain('resumed = await this.resumeActiveJobState(job, active, false)');
    expect(queue).not.toContain('status: initialJobStatus(active.job.type)');
  });
});
