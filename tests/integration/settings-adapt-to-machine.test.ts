import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', setLoginItemSettings: vi.fn(), getPath: () => tmpdir() }
}));

import { AppDatabase } from '@main/database/database.js';
import { SettingsRepository } from '@main/database/repositories/settings-repository.js';
import { SettingsService } from '@main/settings/settings-service.js';
import { HardwareService } from '@main/settings/hardware-service.js';
import { defaultAppSettings } from '@main/settings/defaults.js';

// 2026-10-24 (nguyên tắc tự dò theo máy): bước nâng cấp download_speed_profile_v086 ép MỌI máy lên tối thiểu 16 kết nối
// aria2c + 2 mảnh mỗi video; số mảnh mặc định 2 cố định cho mọi máy. Giờ số mảnh để "Tự động theo máy".

let folder = '';
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function openRepo(): SettingsRepository {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-adapt-machine-it-'));
  const database = new AppDatabase(join(folder, 'app.sqlite'));
  databases.push(database);
  return new SettingsRepository(database.db);
}

/** Cài đặt của bản cũ chưa chạy bước nâng cấp nào (khóa downloadFragmentsAuto chưa có). */
function oldInstall(patch: Record<string, unknown>): SettingsRepository {
  const repo = openRepo();
  const withoutNewKey: Record<string, unknown> = { ...defaultAppSettings, ...patch };
  delete withoutNewKey.downloadFragmentsAuto;
  repo.saveAppSettings(withoutNewKey as unknown as typeof defaultAppSettings);
  repo.set('app_extra', {});
  repo.set('initialized', true);
  return repo;
}

describe('số mảnh tải mỗi video tự dò theo máy', () => {
  it('cài mới: số mảnh để tự động', () => {
    const repo = openRepo();
    const service = new SettingsService(repo, new HardwareService());
    service.initialize();
    expect(service.get().downloadFragmentsAuto).toBe(true);
  });

  it('bản cũ đang đúng 2 mảnh (mặc định cũ) → chuyển tự động', () => {
    const repo = oldInstall({ downloadConcurrentFragments: 2 });
    const service = new SettingsService(repo, new HardwareService());
    service.initialize();
    expect(service.get().downloadFragmentsAuto).toBe(true);
  });

  it('bản cũ người dùng tự chọn số khác 2 → giữ nguyên số đã chọn', () => {
    const repo = oldInstall({ downloadConcurrentFragments: 6 });
    repo.set('download_speed_profile_v086', true);
    const service = new SettingsService(repo, new HardwareService());
    service.initialize();
    expect(service.get()).toMatchObject({ downloadFragmentsAuto: false, downloadConcurrentFragments: 6 });
  });

  it('bước v086 không còn ép máy yếu lên 16 kết nối aria2c + 2 mảnh', () => {
    const repo = oldInstall({ downloadConcurrentFragments: 1, aria2Connections: 4 });
    const service = new SettingsService(repo, new HardwareService());
    service.initialize();
    expect(service.get()).toMatchObject({ downloadConcurrentFragments: 1, aria2Connections: 4, downloadFragmentsAuto: false });
  });

  it('chạy lại khi mở app lần sau không đè lựa chọn của người dùng', () => {
    const repo = openRepo();
    const service = new SettingsService(repo, new HardwareService());
    service.initialize();
    service.update({ downloadFragmentsAuto: false, downloadConcurrentFragments: 2 });
    new SettingsService(repo, new HardwareService()).initialize();
    expect(service.get()).toMatchObject({ downloadFragmentsAuto: false, downloadConcurrentFragments: 2 });
  });

  it('khóa mới lưu ngoài khối "app" để bản cũ quay lui vẫn lưu được cài đặt', () => {
    const repo = openRepo();
    new SettingsService(repo, new HardwareService()).initialize();
    expect(repo.get<Record<string, unknown>>('app', {})).not.toHaveProperty('downloadFragmentsAuto');
    expect(repo.get<Record<string, unknown>>('app_extra', {})).toHaveProperty('downloadFragmentsAuto', true);
  });
});
