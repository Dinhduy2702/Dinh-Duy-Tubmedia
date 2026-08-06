import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('disk-full automatic recovery', () => {
  it('rechecks paused DISK_FULL projects and resumes only after free space is sufficient', () => {
    const queue = source('src/main/queue/queue-manager.ts');
    expect(queue).toContain('TUBMEDIA DISK SPACE AUTO RECOVERY R28');
    expect(queue).toContain('recoverDiskFullProjects');
    expect(queue).toContain('diskSpaceStateForJobs');
    expect(queue).toContain("job.errorCode !== 'DISK_FULL'");
    expect(queue).toContain("code: 'DISK_SPACE_RECOVERED'");
    expect(queue).toContain('if (await this.recoverDiskFullProjects(all))');
    expect(queue).toContain('errorCode: code');
  });

  it('removes stale DISK_FULL notifications when the queue no longer has a disk block', () => {
    const store = source('src/renderer/src/stores/app-store.ts');
    const events = source('src/renderer/src/hooks/use-desktop-events.ts');
    expect(store).toContain('TUBMEDIA STALE DISK NOTICE RECONCILIATION R28');
    expect(store).toContain('reconcileDiskFullNotifications');
    expect(store).toContain('notifications.filter((notice) => !matches(notice))');
    expect(events).toContain("notice.code === 'DISK_SPACE_RECOVERED'");
    expect(events).toContain("dismissAttentionByCodes(['DISK_FULL'], notice.projectId)");
  });

  it('deduplicates disk warnings with a stable project-scoped notification id', () => {
    const queue = source('src/main/queue/queue-manager.ts');
    expect(queue).toContain('blocking-${scope}-${code}');
    expect(queue).toContain('this.blockingNoticeKeys.has(noticeKey)');
  });
});
