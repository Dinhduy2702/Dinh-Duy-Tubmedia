import { describe, expect, it } from 'vitest';
import {
  classifyShortVisualBoundaryTransition,
  type VisualIntegrityIssue
} from '../../src/main/media/file-verifier.js';
import { applyShortVisualBoundaryPolicy } from '../../src/main/merge/merge-engine.js';

const issue = (
  type: VisualIntegrityIssue['type'],
  startSeconds: number,
  endSeconds: number | null,
  durationSeconds: number | null
): VisualIntegrityIssue => ({
  type,
  startSeconds,
  endSeconds,
  durationSeconds,
  message: type + ' test issue'
});

describe('merge visual boundary Hotfix 11', () => {
  it('accepts the reported 0.225622-second black transition at the exact clip edge', () => {
    const result = classifyShortVisualBoundaryTransition(
      issue('black', 2492.466233, 2492.691855, 0.225622),
      [2492.691856]
    );
    expect(result).not.toBeNull();
    expect(result?.classification).toBe('boundary-transition');
    expect(result?.boundaryIndex).toBe(0);
    expect(result?.durationSeconds).toBeCloseTo(0.225622, 6);
    expect(result?.distanceSeconds).toBeLessThan(0.000_01);
  });

  it('does not accept the same short black interval away from a boundary', () => {
    expect(
      classifyShortVisualBoundaryTransition(issue('black', 99, 99.225622, 0.225622), [100])
    ).toBeNull();
  });

  it('does not hide a material black interval even when it crosses a boundary', () => {
    expect(
      classifyShortVisualBoundaryTransition(issue('black', 99.7, 100.3, 0.6), [100])
    ).toBeNull();
  });

  it('accepts only the detector-minimum freeze close to a real boundary', () => {
    expect(
      classifyShortVisualBoundaryTransition(issue('freeze', 59.05, 60.1, 1.05), [60])
    ).not.toBeNull();
    expect(
      classifyShortVisualBoundaryTransition(issue('freeze', 59, 61, 2), [60])
    ).toBeNull();
  });

  it('never accepts decoder failures', () => {
    expect(
      classifyShortVisualBoundaryTransition(issue('decode', 100, null, null), [100])
    ).toBeNull();
  });

  it('removes only safe boundary transitions and keeps genuine blockers', () => {
    const safe = issue('black', 59.8, 60, 0.2);
    const blocker = issue('black', 80, 86, 6);
    const result = applyShortVisualBoundaryPolicy(
      { ok: false, reasons: [safe.message, blocker.message], issues: [safe, blocker] },
      [60]
    );
    expect(result.accepted.map((entry) => entry.issue)).toEqual([safe]);
    expect(result.integrity.ok).toBe(false);
    expect(result.integrity.issues).toEqual([blocker]);
    expect(result.integrity.reasons).toEqual([blocker.message]);
  });
});
