import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', setLoginItemSettings: vi.fn(), getPath: () => tmpdir() }
}));

import { AppDatabase } from '@main/database/database.js';
import { SettingsRepository } from '@main/database/repositories/settings-repository.js';
import { SettingsService } from '@main/settings/settings-service.js';
import type { HardwareService } from '@main/settings/hardware-service.js';

// Người dùng duyệt (2026-10-06, cùng đợt sửa "bấm X không đóng hẳn"): lần ĐẦU nút "—" ẩn app xuống khay hệ thống thì
// nhắc rằng Tubmedia vẫn đang chạy — cửa sổ biến mất khỏi thanh tác vụ nên dễ tưởng app đã đóng.

let folder = '';
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function openService(): SettingsService {
  if (!folder) folder = mkdtempSync(join(tmpdir(), 'tubmedia-tray-hint-'));
  const database = new AppDatabase(join(folder, 'app.sqlite'));
  databases.push(database);
  return new SettingsService(new SettingsRepository(database.db), {} as HardwareService);
}

describe('nhắc lần đầu khi nút "—" ẩn app xuống khay', () => {
  it('chỉ nhắc đúng một lần, kể cả sau khi mở lại app', () => {
    const first = openService();
    expect(first.consumeTrayMinimizeHint()).toBe(true);
    expect(first.consumeTrayMinimizeHint()).toBe(false);
    databases.splice(0).forEach((database) => database.close());
    const afterRestart = openService();
    expect(afterRestart.consumeTrayMinimizeHint()).toBe(false);
  });

  it('index.ts: nhánh thu nhỏ xuống khay hiện thông báo của Windows lần đầu và ghi nhật ký', () => {
    const index = readFileSync('src/main/index.ts', 'utf8');
    const minimize = index.slice(index.indexOf("window.on('minimize'"), index.indexOf('async function connectToolsAtStartup'));
    expect(minimize).toContain('consumeTrayMinimizeHint()');
    expect(minimize).toContain('displayBalloon(');
    expect(minimize).toContain('Thoát an toàn');
    expect(minimize).toContain('TRAY_MINIMIZE_HINT_SHOWN');
  });
});
