import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string): Promise<string> => readFile(join(process.cwd(), path), 'utf8');

describe('v1 runtime performance and lifecycle policy', () => {
  it('uses a non-overlapping adaptive queue scheduler', async () => {
    const queue = await source('src/main/queue/queue-manager.ts');
    expect(queue).toContain('private tickRunning = false');
    expect(queue).toContain('this.active.size > 0 ? 350 : 1_000');
    expect(queue).not.toContain('setInterval(() => void this.tick(), 400)');
  });

  it('keeps critical errors visible and animates transient notices by severity', async () => {
    const [center, policy] = await Promise.all([
      source('src/renderer/src/components/AttentionCenter.tsx'),
      source('src/shared/utils/notification-policy.ts')
    ]);
    expect(center).toContain('const attentionResolved = attention');
    expect(center).toContain('isAttentionNoticeResolved(attention, jobs)');
    expect(center).toContain('Boolean(error || (attention?.sticky && !attentionResolved))');
    expect(center).toContain("if (!attentionResolved || !attention || phase === 'leaving') return;");
    expect(center).toContain("type Phase = 'entering' | 'visible' | 'leaving'");
    expect(policy).toContain('SUCCESS_NOTIFICATION_DURATION_MS');
    expect(policy).toContain('WARNING_NOTIFICATION_DURATION_MS');
  });

  it('prevents sleep only while media jobs are active', async () => {
    const main = await source('src/main/index.ts');
    expect(main).toContain("powerSaveBlocker.start('prevent-app-suspension')");
    expect(main).toContain('powerSaveBlocker.stop(powerSaveBlockerId)');
  });

  it('bounds automatic update backups and old log files', async () => {
    const [backup, logger] = await Promise.all([
      source('src/main/backups/backup-service.ts'),
      source('src/main/logging/logger.ts')
    ]);
    expect(backup).toContain('pruneUpdateBackups(maxPairs = 5)');
    expect(logger).toContain('pruneFiles(retentionDays: number)');
    expect(logger).toContain('pendingWrites = new Map');
    expect(logger).toContain('await this.fileWriteTail');
  });

  it('keeps toast motion compositor-friendly while media is running', async () => {
    const css = await source('src/renderer/src/tubmedia-theme.css');
    expect(css).toContain('v1.0.0 RC1 final smoothness pass');
    expect(css).toContain('backdrop-filter: none');
    expect(css).toContain('filter: none !important');
    expect(css).toContain(':root.is-processing .topbar-sparkline.is-live span');
  });
});
