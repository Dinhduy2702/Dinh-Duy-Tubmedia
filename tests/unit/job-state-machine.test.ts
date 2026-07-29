import { describe, expect, it } from 'vitest';
import {
  assertJobTransition,
  canTransitionJob,
  initialJobStatus
} from '../../src/shared/utils/job-state-machine.js';

describe('job state machine', () => {
  it('allows normal execution and recovery transitions', () => {
    expect(canTransitionJob('pending', 'downloading')).toBe(true);
    expect(canTransitionJob('downloading', 'paused')).toBe(true);
    expect(canTransitionJob('paused', 'downloading')).toBe(true);
    expect(canTransitionJob('failed', 'pending')).toBe(true);
    expect(canTransitionJob('interrupted', 'pending')).toBe(true);
  });

  it('models the real download workflow from analysis through reuse or completion', () => {
    expect(initialJobStatus('download')).toBe('analyzing');
    expect(canTransitionJob('pending', 'analyzing')).toBe(true);
    expect(canTransitionJob('analyzing', 'downloading')).toBe(true);
    expect(canTransitionJob('analyzing', 'verifying')).toBe(true);
    expect(canTransitionJob('downloading', 'processing')).toBe(true);
    expect(canTransitionJob('downloading', 'verifying')).toBe(true);
    expect(canTransitionJob('verifying', 'processing')).toBe(true);
    expect(canTransitionJob('processing', 'verifying')).toBe(true);
    expect(canTransitionJob('verifying', 'analyzing')).toBe(true);
    expect(canTransitionJob('verifying', 'skipped')).toBe(true);
  });

  it('rejects reopening terminal jobs in place', () => {
    expect(canTransitionJob('completed', 'pending')).toBe(false);
    expect(canTransitionJob('skipped', 'pending')).toBe(false);
    expect(canTransitionJob('cancelled', 'pending')).toBe(false);
    expect(() => assertJobTransition('completed', 'paused')).toThrow(/completed.*paused/);
  });
});
