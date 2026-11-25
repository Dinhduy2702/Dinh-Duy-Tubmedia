import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexSrc = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
const contextSrc = readFileSync(resolve(process.cwd(), 'src/main/app/app-context.ts'), 'utf8');
const ipcSrc = readFileSync(resolve(process.cwd(), 'src/main/ipc/register-ipc.ts'), 'utf8');
const toolUpdateSrc = readFileSync(resolve(process.cwd(), 'src/main/updates/tool-update-service.ts'), 'utf8');

describe('Đếm việc bận dùng chung cho đóng cửa sổ, chống ngủ, cập nhật và backup (#8)', () => {
  it('ToolUpdateService có isActive() theo dõi lượt cập nhật công cụ đang chạy', () => {
    expect(toolUpdateSrc).toContain('public isActive(): boolean');
  });

  it('AppContext có activeWorkSummary()/activeWorkCount() dùng chung, gom cả toolUpdates và probe ngoài', () => {
    expect(contextSrc).toContain('public registerActiveWorkProbe(');
    expect(contextSrc).toContain('public activeWorkSummary(');
    expect(contextSrc).toContain('public activeWorkCount(');
    expect(contextSrc).toContain('this.toolUpdates.isActive()');
  });

  it('register-ipc.ts đăng ký đủ localCut, videoLinkFilter, systemCleanup, errorReports và chặn backup restore qua activeWorkCount', () => {
    expect(ipcSrc).toContain("ctx.registerActiveWorkProbe('localCut'");
    expect(ipcSrc).toContain("ctx.registerActiveWorkProbe('videoLinkFilter'");
    expect(ipcSrc).toContain("ctx.registerActiveWorkProbe('systemCleanup'");
    expect(ipcSrc).toContain("ctx.registerActiveWorkProbe('errorReports'");
    const restoreStart = ipcSrc.indexOf('handle(IPC.backups.restore');
    const restoreBody = ipcSrc.slice(restoreStart, restoreStart + 400);
    expect(restoreBody).toContain('ctx.activeWorkCount()');
  });

  it('index.ts dùng activeWorkCount() cho cả requestClose (X) và syncPowerSaveBlocker', () => {
    const closeStart = indexSrc.indexOf('async function requestClose(');
    const closeEnd = indexSrc.indexOf('function wireWindow(', closeStart);
    expect(indexSrc.slice(closeStart, closeEnd)).toContain('context.activeWorkCount()');

    const powerStart = indexSrc.indexOf('function syncPowerSaveBlocker(');
    const powerEnd = indexSrc.indexOf('function startStatsTimer(', powerStart);
    expect(indexSrc.slice(powerStart, powerEnd)).toContain('current.activeWorkCount()');
  });
});
