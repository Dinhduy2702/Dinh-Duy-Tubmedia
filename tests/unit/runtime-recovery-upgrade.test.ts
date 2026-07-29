import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('runtime recovery upgrade', () => {
  it('resumes cookie-blocked jobs without manual list restart', async () => {
    const queue = await source('src/main/queue/queue-manager.ts');
    expect(queue).toMatch(/resumeCookieBlockedJobs\(\): number/);
    expect(queue).toMatch(/cookieRetryRequested:\s*true/);
    expect(queue).toMatch(/errorCode:\s*null/);
    expect(queue).toMatch(/this\.emitProgress\(resumedJob\)/);
    const resumeMethod =
      queue.split('public resumeCookieBlockedJobs(): number')[1]?.split('public retry(jobId: string)')[0] ??
      '';
    expect(resumeMethod).not.toContain('this.active.has(job.id)');
  });

  it('clears cookie notices and refreshes jobs immediately after saving cookies', async () => {
    const dialog = await source('src/renderer/src/components/CookieManagerDialog.tsx');
    const store = await source('src/renderer/src/stores/app-store.ts');
    expect(dialog).toContain('dismissAttentionByCodes(COOKIE_BLOCKING_CODES)');
    expect(dialog).toContain('await refreshJobs()');
    expect(store).toContain('dismissAttentionByCodes');
  });

  it('recovers old false-positive size failures on startup', async () => {
    const queue = await source('src/main/queue/queue-manager.ts');
    const repository = await source('src/main/database/repositories/queue-repository.ts');
    expect(queue).toContain('recoverLegacySizeEstimateFailures()');
    expect(repository).toMatch(/recoverLegacySizeEstimateFailures\(\)\s*:\s*number/);
    expect(repository).toContain('Tệp tải về có dung lượng thấp bất thường');
  });

  it('keeps verified media when platform size metadata is inaccurate', async () => {
    const engine = await source('src/main/downloader/download-engine.ts');
    expect(engine).toContain('DOWNLOAD_SIZE_ESTIMATE_MISMATCH');
    expect(engine).toContain('selectedDurationSeconds ?? undefined');
    expect(engine).toContain('Tệp đã vượt qua kiểm tra thời lượng và giải mã');
    expect(engine).not.toContain('Tệp tải về có dung lượng thấp bất thường và đã chuyển vào khu cách ly');
  });
});
