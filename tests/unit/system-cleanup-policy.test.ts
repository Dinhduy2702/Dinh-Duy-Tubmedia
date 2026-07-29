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

  it('requests elevation only for administrator categories', () => {
    expect(systemCleanupRequiresAdmin(['userTemp', 'browserCache'])).toBe(false);
    expect(systemCleanupRequiresAdmin(['windowsTemp'])).toBe(true);
  });

  it('recognizes irreversible selections', () => {
    expect(isIrreversibleCleanupSelection(['userTemp'])).toBe(false);
    expect(isIrreversibleCleanupSelection(['recycleBin'])).toBe(true);
    expect(isIrreversibleCleanupSelection(['disableHibernate'])).toBe(true);
  });
});
