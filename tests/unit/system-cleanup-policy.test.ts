import { describe, expect, it } from 'vitest';
import {
  SYSTEM_CLEANUP_ADMIN_INFO_ITEMS,
  SYSTEM_CLEANUP_CATEGORIES,
  validateSystemCleanupRequest
} from '../../src/shared/system-cleanup.js';

describe('system cleanup policy (GĐ4a — bỏ PowerShell/Admin/wholeMachine)', () => {
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

  it('never accepts a scope field — wholeMachine scanning was removed with the PowerShell helper', () => {
    expect(
      validateSystemCleanupRequest({
        mode: 'estimate',
        categories: ['userTemp']
      })
    ).not.toHaveProperty('scope');

    // Một payload cũ còn gửi "scope" (ví dụ bản build trước) không được phép lọt qua validate.
    expect(
      validateSystemCleanupRequest({
        mode: 'estimate',
        scope: 'wholeMachine',
        categories: ['userTemp']
      })
    ).toEqual({ mode: 'estimate', categories: ['userTemp'] });
  });

  it('has exactly 7 categories left, none needing admin/UAC and none irreversible', () => {
    const ids = SYSTEM_CLEANUP_CATEGORIES.map((item) => item.id).sort();

    expect(ids).toEqual(
      ['browserCache', 'capcutCache', 'crashReports', 'thumbnailCache', 'tubmediaResidue', 'userTemp', 'zaloCache'].sort()
    );

    for (const item of SYSTEM_CLEANUP_CATEGORIES) {
      expect(item).not.toHaveProperty('requiresAdmin');
      expect(item).not.toHaveProperty('irreversible');
      expect(item).not.toHaveProperty('group');
    }
  });

  it('removed the categories that required admin or were irreversible (decision 2026-09-21/23)', () => {
    const ids = new Set(SYSTEM_CLEANUP_CATEGORIES.map((item) => item.id));

    expect(ids.has('recycleBin' as never)).toBe(false);
    expect(ids.has('windowsTemp' as never)).toBe(false);
    expect(ids.has('windowsUpdate' as never)).toBe(false);
    expect(ids.has('deliveryOptimization' as never)).toBe(false);
    expect(ids.has('componentStore' as never)).toBe(false);
    expect(ids.has('diskInventory' as never)).toBe(false);
    expect(ids.has('disableHibernate' as never)).toBe(false);
  });

  it('keeps a report-only list of admin-required maintenance with no scan/delete affordance', () => {
    const ids = SYSTEM_CLEANUP_ADMIN_INFO_ITEMS.map((item) => item.id).sort();

    expect(ids).toEqual(
      ['componentStore', 'deliveryOptimization', 'windowsTemp', 'windowsUpdate'].sort()
    );

    for (const item of SYSTEM_CLEANUP_ADMIN_INFO_ITEMS) {
      expect(typeof item.label).toBe('string');
      expect(typeof item.description).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('rejects unknown categories even if they look like admin-info ids', () => {
    expect(() =>
      validateSystemCleanupRequest({
        mode: 'estimate',
        categories: ['windowsTemp']
      })
    ).toThrow();
  });

  it('requires at least one category and rejects an invalid mode', () => {
    expect(() => validateSystemCleanupRequest({ mode: 'estimate', categories: [] })).toThrow();
    expect(() => validateSystemCleanupRequest({ mode: 'delete-everything', categories: ['userTemp'] })).toThrow();
  });
});
