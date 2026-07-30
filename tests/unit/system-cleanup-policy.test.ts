import { describe, expect, it } from 'vitest';
import {
  SYSTEM_CLEANUP_CATEGORIES,
  isIrreversibleCleanupSelection,
  systemCleanupRequiresAdmin,
  validateSystemCleanupRequest
} from '../../src/shared/system-cleanup.js';

describe('system cleanup policy', () => {
  it('only accepts category identifiers from the fixed allowlist', () => {
    expect(
      validateSystemCleanupRequest({
        mode: 'clean',
        categories: ['userTemp', 'browserCache', 'userTemp']
      })
    ).toEqual({
      mode: 'clean',
      scope: 'currentUser',
      categories: ['userTemp', 'browserCache']
    });

    expect(() =>
      validateSystemCleanupRequest({
        mode: 'clean',
        categories: ['C:\\Users\\Hi\\Downloads']
      })
    ).toThrow();
  });

  it('keeps irreversible operations disabled by default', () => {
    const defaults = SYSTEM_CLEANUP_CATEGORIES.filter((item) => item.defaultSelected);

    expect(defaults.every((item) => !item.irreversible)).toBe(true);
    expect(SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === 'disableHibernate')?.defaultSelected).toBe(
      false
    );
    expect(SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === 'recycleBin')?.defaultSelected).toBe(false);
  });

  it('requests elevation for administrator categories or a whole-machine scan', () => {
    expect(systemCleanupRequiresAdmin(['userTemp', 'browserCache'])).toBe(false);
    expect(systemCleanupRequiresAdmin(['windowsTemp'])).toBe(true);
    expect(systemCleanupRequiresAdmin(['userTemp'], 'wholeMachine')).toBe(true);
  });

  it('accepts only the two fixed cleanup scopes', () => {
    expect(
      validateSystemCleanupRequest({
        mode: 'estimate',
        scope: 'wholeMachine',
        categories: ['userTemp']
      }).scope
    ).toBe('wholeMachine');

    expect(() =>
      validateSystemCleanupRequest({
        mode: 'estimate',
        scope: 'entireDisk',
        categories: ['userTemp']
      })
    ).toThrow();
  });

  it('recognizes irreversible selections', () => {
    expect(isIrreversibleCleanupSelection(['userTemp'])).toBe(false);
    expect(isIrreversibleCleanupSelection(['recycleBin'])).toBe(true);
    expect(isIrreversibleCleanupSelection(['disableHibernate'])).toBe(true);
  });
});
