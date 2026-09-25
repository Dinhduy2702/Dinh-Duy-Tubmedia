import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildTimelineOnlyArtifact,
  decideMergeRecoveryCandidate,
  type TimelineOnlyInput
} from '../../src/main/merge/merge-engine.js';

function input(label: string, start: number | null, end: number | null): TimelineOnlyInput {
  return {
    path: label + '.mp4',
    label,
    note: '',
    sourceStartSeconds: start,
    sourceEndSeconds: end
  };
}

describe('timeline-only Hotfix 12', () => {
  it('applies source start/end ranges without creating a merged video', () => {
    const result = buildTimelineOnlyArtifact(
      [input('A', 10, 50), input('B', null, null)],
      [120, 90]
    );
    expect(result.txt).toBeNull();
    expect(result.totalDuration).toBe(130);
    expect(result.rows.map((row) => [row.start, row.end, row.duration])).toEqual([
      [0, 40, 40],
      [40, 130, 90]
    ]);
  });

  it('clamps requested ranges to the actual source duration', () => {
    const result = buildTimelineOnlyArtifact([input('A', 5, 500)], [20]);
    expect(result.totalDuration).toBe(15);
    expect(result.rows[0]?.file).toBe('A.mp4');
  });

  it('keeps duplicate source entries as independent timeline rows', () => {
    const source = input('same-source', 0, 10);
    const result = buildTimelineOnlyArtifact([source, source], [100, 100]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]?.start).toBe(10);
  });

  it('rejects an empty effective range with a clear error', () => {
    expect(() => buildTimelineOnlyArtifact([input('A', 30, 20)], [60])).toThrow(
      'không còn thời lượng hợp lệ'
    );
  });

  it('rejects an empty list, mismatched metadata and non-finite duration', () => {
    expect(() => buildTimelineOnlyArtifact([], [])).toThrow('Không có video hợp lệ');
    expect(() => buildTimelineOnlyArtifact([input('A', 0, null)], [])).toThrow('không đồng bộ');
    expect(() => buildTimelineOnlyArtifact([input('A', 0, null)], [Number.NaN])).toThrow(
      'không còn thời lượng hợp lệ'
    );
  });

  it('clamps negative source marks without shifting later rows', () => {
    const result = buildTimelineOnlyArtifact(
      [input('A', -5, 10), input('B', -20, null)],
      [30, 15]
    );
    expect(result.rows.map((row) => [row.start, row.end])).toEqual([[0, 10], [10, 25]]);
  });

  it('keeps the verified recovery gates in source', () => {
    const merge = readFileSync('src/main/merge/merge-engine.ts', 'utf8');
    expect(merge).toContain('validateReusableMergeCandidate(');
    expect(merge).toContain('verifyPendingTwice(candidate');
    expect(merge).toContain('verifyVisualIntegrity(');
    expect(merge).toContain('validateMergeOutputSize([...inputInfos]');
    expect(merge).toContain('commitFileWithoutOverwrite(pending, final)');
  });

  it('never keys a merge checkpoint by the transient job id', () => {
    const merge = readFileSync('src/main/merge/merge-engine.ts', 'utf8');
    expect(merge).toContain('checkpointSignature}.pending.mp4');
    expect(merge).not.toContain('safeName}.tubmedia-${job.id}.pending.mp4');
  });

  it('reuses clip work only after both signature and media verification', () => {
    const clip = readFileSync('src/main/clips/clip-engine.ts', 'utf8');
    expect(clip).toContain('checkpointMatches');
    expect(clip).toContain('existingCheck.ok');
    expect(clip).toContain('item.timestampEndSeconds <= rangeStart');
    expect(clip.indexOf('checkpointMatches')).toBeLessThan(clip.indexOf('existingCheck.ok'));
  });
});

describe('verified merge recovery decision matrix', () => {
  it('reuses a valid final only after verification', () => {
    expect(decideMergeRecoveryCandidate('final', true)).toEqual({
      action: 'reuse-final',
      mode: 'verified-final',
      quarantineCheckpoint: false
    });
  });

  it('commits a valid checkpoint instead of concatenating again', () => {
    expect(decideMergeRecoveryCandidate('checkpoint', true)).toEqual({
      action: 'commit-checkpoint',
      mode: 'verified-checkpoint',
      quarantineCheckpoint: false
    });
  });

  it('preserves an invalid final and rebuilds', () => {
    expect(decideMergeRecoveryCandidate('final', false)).toEqual({
      action: 'rebuild',
      mode: 'new-merge',
      quarantineCheckpoint: false
    });
  });

  it('quarantines an invalid owned checkpoint and rebuilds', () => {
    expect(decideMergeRecoveryCandidate('checkpoint', false)).toEqual({
      action: 'rebuild',
      mode: 'new-merge',
      quarantineCheckpoint: true
    });
  });

  it('keeps changed input/config candidates outside the trusted recovery list', () => {
    const workbench = readFileSync('src/main/workbench/workbench-service.ts', 'utf8');
    const merge = readFileSync('src/main/merge/merge-engine.ts', 'utf8');
    const ownership = readFileSync('src/main/files/file-ownership.ts', 'utf8');
    expect(workbench).toContain('mergeRequestSignature(value)');
    expect(workbench).toContain('mergeRequestUnchanged(existing, value)');
    expect(workbench).toContain('const previousMergeJobs = unchanged && existing');
    expect(workbench).toContain('const trustedOutputPath = !value.timelineOnly && unchanged && existing');
    expect(workbench).toContain('const legacyPendingPaths = unchanged && existing');
    expect(workbench).toContain("if (!unchanged) this.input.import(project.id, value.linksText, 'replace')");
    expect(workbench).toContain('value.timelineOnly === true');
    // Giai đoạn 6 mục 4 (2026-09-24): đổi preset tỉ lệ phải làm chữ ký khác đi, nếu không đổi tỉ lệ rồi
    // chạy lại sẽ bị coi là "không đổi gì" và dùng lại thành phẩm CŨ (sai tỉ lệ) qua trustedOutputPath.
    expect(workbench).toContain("value.aspectRatio ?? 'original'");
    expect(workbench).toContain("project.aspectRatio === (value.aspectRatio ?? 'original')");
    expect(ownership.includes("'merge-checkpoints'") || ownership.includes('"merge-checkpoints"')).toBe(true);
    expect(merge).toContain('parsed.signature !== signature');
    expect(merge).toContain('Math.round(file.mtimeMs)');
    expect(merge).toContain('sampledFileFingerprint(sourcePath, file.size)');
    expect(merge).toContain('profileFacts');
    expect(merge).toContain('targetPath: recoveryPathKey(targetPath)');
  });

  it('covers all complete-output rejection gates before reuse', () => {
    const merge = readFileSync('src/main/merge/merge-engine.ts', 'utf8');
    expect(merge).toContain('verifyPendingTwice(candidate');
    expect(merge).toContain('verifyVisualIntegrity(');
    expect(merge).toContain('Thành phẩm thiếu audio stream.');
    expect(merge).toContain('if (avDrift > tolerance)');
    expect(merge).toContain('validateMergeOutputSize([...inputInfos]');
  });
});
