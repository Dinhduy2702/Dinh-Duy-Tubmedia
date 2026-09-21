import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', setLoginItemSettings: vi.fn(), getPath: () => tmpdir() }
}));

import { AppDatabase } from '@main/database/database.js';
import { SettingsRepository } from '@main/database/repositories/settings-repository.js';
import { BackupService } from '@main/backups/backup-service.js';
import { SettingsService } from '@main/settings/settings-service.js';
import { defaultAppSettings } from '@main/settings/defaults.js';
import { expectedToolFileName } from '@main/security/settings-policy.js';
import type { HardwareService } from '@main/settings/hardware-service.js';
import type { Logger } from '@main/logging/logger.js';

let folder = '';
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function openDatabase(name: string): AppDatabase {
  if (!folder) folder = mkdtempSync(join(tmpdir(), 'tubmedia-policy-it-'));
  const database = new AppDatabase(join(folder, name));
  databases.push(database);
  return database;
}

function fakeLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger = {
    info: () => undefined,
    warn: (_module: string, code: string, message: string) => {
      warnings.push(`${code}: ${message}`);
    },
    error: () => undefined,
    debug: () => undefined
  } as unknown as Logger;
  return { logger, warnings };
}

function newSettings(database: AppDatabase, logger?: Logger): { repo: SettingsRepository; service: SettingsService } {
  const repo = new SettingsRepository(database.db);
  return { repo, service: new SettingsService(repo, {} as HardwareService, logger) };
}

function realTool(name: string): string {
  const path = join(folder, name);
  writeFileSync(path, 'x');
  return path;
}

describe('SettingsService: đọc và lưu địa chỉ cập nhật / đường dẫn công cụ', () => {
  it('bỏ qua giá trị nguy hiểm đã nằm sẵn trong database và ghi cảnh báo một lần', () => {
    const database = openDatabase('settings.sqlite');
    const { logger, warnings } = fakeLogger();
    const { repo, service } = newSettings(database, logger);
    repo.saveAppSettings({
      ...defaultAppSettings,
      appFeedUrl: 'https://evil.example/feed/',
      ytdlpPath: 'C:\\evil\\virus.exe',
      ffmpegPath: '\\\\server\\share\\ffmpeg.exe'
    });

    const settings = service.get();
    expect(settings.appFeedUrl).toBe('');
    expect(settings.ytdlpPath).toBe('');
    expect(settings.ffmpegPath).toBe('');
    service.get();
    expect(warnings.filter((line) => line.includes('SETTING_REJECTED_BY_POLICY'))).toHaveLength(3);
  });

  it('vẫn lưu được cài đặt khác khi giá trị cũ không hợp lệ, và ghi đè giá trị cũ bằng chuỗi rỗng', () => {
    const database = openDatabase('settings.sqlite');
    const { repo, service } = newSettings(database);
    repo.saveAppSettings({ ...defaultAppSettings, ytdlpPath: 'C:\\evil\\virus.exe' });

    const saved = service.update({ ...service.get(), proxy: 'http://127.0.0.1:8080' });
    expect(saved.proxy).toBe('http://127.0.0.1:8080');
    expect(repo.getAppSettings(defaultAppSettings).ytdlpPath).toBe('');
  });

  it('từ chối lưu địa chỉ cập nhật khác host và đường dẫn công cụ sai', () => {
    const database = openDatabase('settings.sqlite');
    const { service } = newSettings(database);
    expect(() => service.update({ appFeedUrl: 'https://evil.example/feed/' })).toThrow(/Địa chỉ nhận cập nhật/);
    expect(() => service.update({ appFeedUrl: 'http://github.com/a/b/' })).toThrow(/HTTPS/);
    expect(() => service.update({ ytdlpPath: 'C:\\x\\virus.exe' })).toThrow(/Đường dẫn yt-dlp/);
    expect(service.get().appFeedUrl).toBe('');
    expect(service.get().ytdlpPath).toBe('');
  });

  it('lưu được tệp công cụ thật đúng tên và địa chỉ cập nhật cùng host mặc định', () => {
    const database = openDatabase('settings.sqlite');
    const { service } = newSettings(database);
    const tool = realTool(expectedToolFileName('ytdlpPath'));
    const feed = 'https://github.com/Dinhduy2702/Dinh-Duy-Tubmedia/releases/latest/download/';
    const saved = service.update({ ytdlpPath: tool, appFeedUrl: feed });
    expect(saved.ytdlpPath).toBe(tool);
    expect(service.get().appFeedUrl).toBe(feed);
  });
});

describe('BackupService.restore: cài đặt trong backup không đáng tin', () => {
  it('bỏ địa chỉ cập nhật, đường dẫn công cụ và trường sai schema nhưng giữ cài đặt hợp lệ', () => {
    const source = openDatabase('backup.sqlite');
    const tool = realTool(expectedToolFileName('ffprobePath'));
    const sourceRepo = new SettingsRepository(source.db);
    sourceRepo.set('app', {
      ...defaultAppSettings,
      proxy: 'http://127.0.0.1:8080',
      appFeedUrl: 'https://evil.example/feed/',
      ytdlpPath: 'C:\\evil\\virus.exe',
      ffprobePath: tool,
      aria2Connections: 9999,
      khongTonTai: 'x'
    });
    source.checkpoint();
    source.close();
    databases.splice(databases.indexOf(source), 1);

    const target = openDatabase('current.sqlite');
    const { logger, warnings } = fakeLogger();
    const { service } = newSettings(target);
    const backups = new BackupService(target, join(folder, 'backups'), logger);

    backups.restore(join(folder, 'backup.sqlite'), 'merge');

    const settings = service.get();
    expect(settings.appFeedUrl).toBe('');
    expect(settings.ytdlpPath).toBe('');
    expect(settings.ffprobePath).toBe(tool);
    expect(settings.proxy).toBe('http://127.0.0.1:8080');
    expect(settings.aria2Connections).toBe(defaultAppSettings.aria2Connections);
    const stored = new SettingsRepository(target.db).get<Record<string, unknown>>('app', {});
    expect(stored).not.toHaveProperty('khongTonTai');
    expect(stored).not.toHaveProperty('appFeedUrl');
    expect(warnings.some((line) => line.startsWith('BACKUP_SETTINGS_SANITIZED'))).toBe(true);
  });
});
