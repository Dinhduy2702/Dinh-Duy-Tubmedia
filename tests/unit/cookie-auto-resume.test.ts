import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(path, 'utf8');

function extractCookieHandler(sourceText: string, name: string): string {
  const pattern = new RegExp(`const ${name} = async \\(\\): Promise<void> => \\{[\\s\\S]*?\\n\\s*\\};`);
  const match = sourceText.match(pattern);
  expect(match, `Không tìm thấy callback ${name}`).not.toBeNull();
  return match?.[0] ?? '';
}

describe('cookie auto-resume upgrade', () => {
  it('resumes only cookie-blocked jobs after a successful cookie update', () => {
    const queue = source('src/main/queue/queue-manager.ts');
    expect(queue).toContain('public resumeCookieBlockedJobs(): number');
    expect(queue).toContain('isCookieBlockingCode(job.errorCode)');
    expect(queue).toContain("['paused', 'failed', 'interrupted'].includes(job.status)");
    expect(queue).toContain("status: 'pending'");
    expect(queue).toContain('COOKIE_BLOCKS_AUTO_RESUMED');
  });

  it('applies automatic resume to browser, pasted and file cookies', () => {
    const ipc = source('src/main/ipc/register-ipc.ts');
    expect(ipc).toContain('ctx.queue.resumeCookieBlockedJobs()');
    expect(ipc.match(/configureCookies\(\(\) => ctx\.cookies\./g)).toHaveLength(3);
  });

  it('does not manually retry or resume lists inside cookie callbacks', () => {
    const download = source('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
    const merge = source('src/renderer/src/pages/DownloadMergePage.tsx');

    const downloadCookieHandler = extractCookieHandler(download, 'resumeAfterCookie');
    const mergeCookieHandler = extractCookieHandler(merge, 'resumeAfterCookies');

    for (const handler of [downloadCookieHandler, mergeCookieHandler]) {
      expect(handler).toContain('window.desktop.workbench.state()');
      expect(handler).toContain('await refreshJobs()');
      expect(handler).not.toContain('queue.retryFailed(');
      expect(handler).not.toContain('workbench.resume(');
      expect(handler).not.toContain("control('pause')");
      expect(handler).not.toContain("control('resume')");
    }
  });

  it('keeps the independent manual retry action for unrelated failures', () => {
    const download = source('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
    const merge = source('src/renderer/src/pages/DownloadMergePage.tsx');

    expect(download).toContain('window.desktop.queue.retryFailed(projectId)');
    expect(merge).toContain('window.desktop.queue.retryFailed(projectId)');
  });
});
