import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { SettingsRepository } from '@main/database/repositories/settings-repository.js';
import { defaultAppSettings } from '@main/settings/defaults.js';

let folder = '';
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

// Quay lui 1.5.1 → 1.5.0: trang Cài đặt của 1.5.0 lưu bằng settings.update(<toàn bộ cài đặt đọc từ CSDL>) và
// schema của 1.5.0 là .strict() — một khóa lạ trong khối 'app' làm 1.5.0 KHÔNG lưu được cài đặt nữa.
// Vì vậy khóa mới của 1.5.1 phải nằm ngoài khối 'app'.
describe('cài đặt 1.5.1 không làm hỏng việc quay lui về 1.5.0', () => {
  it('khối "app" trong CSDL không chứa khóa mới; đọc lại vẫn đúng giá trị', () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-settings-compat-'));
    const database = new AppDatabase(join(folder, 'db.sqlite'));
    const repo = new SettingsRepository(database.db);

    repo.saveAppSettings({ ...defaultAppSettings, autoResumeInterruptedOnStartup: true });

    const stored = JSON.parse(
      (database.db.prepare("SELECT value_json FROM app_settings WHERE key='app'").get() as { value_json: string })
        .value_json
    ) as Record<string, unknown>;
    expect(Object.keys(stored)).not.toContain('autoResumeInterruptedOnStartup');
    expect(repo.getAppSettings(defaultAppSettings).autoResumeInterruptedOnStartup).toBe(true);

    repo.saveAppSettings({ ...defaultAppSettings, autoResumeInterruptedOnStartup: false });
    expect(repo.getAppSettings(defaultAppSettings).autoResumeInterruptedOnStartup).toBe(false);
    database.close();
  });
});
