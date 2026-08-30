import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('R55 installed-user runtime hardening', () => {
  it('uses one updater and installs only from the explicit in-app action', () => {
    const updater = read('src/main/updates/app-update-service.ts');
    const downloadBody =
      updater.match(/public async download\(\)[\s\S]*?public async install\(\)/)?.[0] ?? '';

    expect(existsSync(resolve(root, 'src/main/update/startup-update-awareness.ts'))).toBe(false);
    expect(existsSync(resolve(root, 'src/preload/update-awareness-bridge.ts'))).toBe(false);
    expect(existsSync(resolve(root, 'src/renderer/src/update-awareness.ts'))).toBe(false);
    expect(downloadBody).not.toContain('quitAndInstall');
    expect(updater.match(/quitAndInstall\(true, true\)/g)).toHaveLength(1);
    expect(updater).toContain('updater.autoInstallOnAppQuit = false');
  });

  it('guards disk space before and during queue and Quick Download writes', () => {
    const queue = read('src/main/queue/queue-manager.ts');
    const quick = read('src/main/download/quick-download-service.ts');

    expect(queue).toContain('guardActiveDiskSpace');
    expect(queue).toContain('ACTIVE_DISK_GUARD_PAUSED');
    expect(queue).toContain('project.outputFolder');
    expect(quick).toContain('scheduleQuickDiskGuard');
    expect(quick).toContain('QUICK_DOWNLOAD_DISK_GUARD_PAUSED');
    expect(quick).toContain("active.status.errorCode = 'DISK_FULL'");
  });

  it('never sends full-disk inventory paths to the cleanup command', () => {
    const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');
    const helper = read('resources/system-cleanup-helper.ps1');

    expect(panel).toContain('categories.filter((id) => !isInspectionOnlyCleanupCategory(id))');
    expect(helper).toContain('Inspection-only by policy');
    expect(helper).toContain('Test-TubmediaOwnershipMarker');
    expect(helper).toContain('trackedTempFiles');
  });
});
