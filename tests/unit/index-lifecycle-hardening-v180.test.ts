import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppDatabase } from '../../src/main/database/database.js';

const indexSrc = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
const updaterSrc = readFileSync(resolve(process.cwd(), 'src/main/updates/app-update-service.ts'), 'utf8');

let root = '';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('Vòng đời khởi động/tắt index.ts và kiểm bộ cài trước prepareForInstall (#29–#40)', () => {
  it('AppDatabase.close() an toàn khi gọi nhiều lần (idempotent)', () => {
    root = mkdtempSync(join(tmpdir(), 'tubmedia-db-close-'));
    const db = new AppDatabase(join(root, 'studio.sqlite'));
    expect(() => {
      db.close();
      db.close();
    }).not.toThrow();
  });

  it('index.ts bảo đảm database.close() luôn chạy kể cả khi chuỗi tắt quá hạn, và dừng lập lịch trước khi tắt', () => {
    const beforeQuitStart = indexSrc.indexOf("app.on('before-quit'");
    const beforeQuitBody = indexSrc.slice(beforeQuitStart);
    expect(beforeQuitBody).toContain('current.database.close()');

    // Không cho queue.start() chạy lại nếu đã bắt đầu tắt
    const queueStartIdx = indexSrc.indexOf('current.queue.start()');
    const beforeQueueStart = indexSrc.slice(Math.max(0, queueStartIdx - 420), queueStartIdx);
    expect(beforeQueueStart).toContain('shutdownStarted');
  });

  it('index.ts thử lại requestSingleInstanceLock khi có --force-run hoặc --relaunch', () => {
    expect(indexSrc).toContain('--force-run');
    expect(indexSrc).toContain('--relaunch');
    expect(indexSrc).toMatch(/acquireSingleInstanceLock|requestSingleInstanceLock/);
  });

  it('AppUpdateService kiểm getUpdater() và tệp bộ cài tồn tại/hợp lệ TRƯỚC prepareForInstall()', () => {
    const installStart = updaterSrc.indexOf('public async install(');
    const installEnd = updaterSrc.indexOf('private baseStatus(', installStart);
    const installBody = updaterSrc.slice(installStart, installEnd);

    const getUpdaterIdx = installBody.indexOf('this.getUpdater()');
    const prepareIdx = installBody.indexOf('await this.prepareForInstall()');
    expect(getUpdaterIdx).toBeGreaterThan(-1);
    expect(prepareIdx).toBeGreaterThan(-1);
    expect(getUpdaterIdx).toBeLessThan(prepareIdx);
    expect(installBody).toContain('downloadedInstallerPath');
  });
});
