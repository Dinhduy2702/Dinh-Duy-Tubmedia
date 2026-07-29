import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('FIX10 timestamp repair and in-workflow error details', () => {
  it('repairs absurd concat timestamps before quarantine', () => {
    const merge = read('src/main/merge/merge-engine.ts');
    const normalize = read('src/main/normalize/normalize-engine.ts');
    const verifier = read('src/main/media/file-verifier.ts');

    expect(merge).toContain('Phát hiện timestamp bất thường · đang tự sửa và ghép lại');
    expect(merge).toContain('shouldRepairTimestamps');
    expect(merge).toContain('timestampRepairAttempted');
    expect(merge).toContain('duration ${Math.max(0.001, item.info.duration).toFixed(6)}');
    expect(normalize).toContain("operation: 'remux-v3-timestamp-reset'");
    expect(normalize).toContain("'-copyts'");
    expect(normalize).toContain("'-start_at_zero'");
    expect(verifier).toContain('const sampleDuration = expectedDuration');
  });

  it('keeps rich JOB_FAILED metadata and a visible merge error panel', () => {
    const queue = read('src/main/queue/queue-manager.ts');
    const page = read('src/renderer/src/pages/DownloadMergePage.tsx');
    const css = read('src/renderer/src/tubmedia-theme.css');

    expect(queue).toContain('details: appError.details ?? null');
    expect(queue).toContain('jobType: job.type');
    expect(page).toContain('Chi tiết lỗi của quy trình');
    expect(page).toContain('Sao chép chi tiết lỗi');
    expect(page).toContain('mergeErrorTechnical');
    expect(css).toMatch(/\.merge-error-detail\s*\{/);
    expect(css).toMatch(/\.merge-error-technical\s*\{/);
  });
});
