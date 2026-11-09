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
import { HardwareService } from '@main/settings/hardware-service.js';
import { defaultAppSettings } from '@main/settings/defaults.js';
import type { AppSettings } from '@shared/types/domain.js';

// 1.7.6 việc E — phần nâng cấp (người dùng yêu cầu 2026-11-09): ai đã bấm "Theo máy" ở bản ≤ 1.7.5 thì cài đặt đã lưu
// "tạo thêm bản CapCut" = bật (capcut_sdr_1080p/2k) + chế độ "Theo nguồn". Không có nút nào khác đặt được downloadEditCopyMode
// (Cài đặt không có ô này) → giá trị khác 'off' là do nút tự đặt. Mở bản mới: đưa về "CapCut trực tiếp, một tệp" cùng độ
// phân giải; chế độ CapCut người dùng tự chọn ở Cài đặt thì giữ nguyên; không có dấu vết của nút thì không đụng.

let folder = '';
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

/** Bản ≤ 1.7.5 đã chạy mọi bước nâng cấp cũ, với cài đặt cho trước. */
function oldInstall(patch: Partial<AppSettings>): SettingsRepository {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-theo-may-v176-'));
  const database = new AppDatabase(join(folder, 'app.sqlite'));
  databases.push(database);
  const repo = new SettingsRepository(database.db);
  repo.saveAppSettings({ ...defaultAppSettings, ...patch });
  repo.set('initialized', true);
  const source = readFileSync('src/main/settings/settings-service.ts', 'utf8');
  for (const match of source.matchAll(/this\.repo\.set\('([a-z0-9_]+)', true\)/g)) {
    if (match[1] !== 'theo_may_edit_copy_reset_v176' && match[1] !== 'initialized') repo.set(match[1]!, true);
  }
  return repo;
}

function open(repo: SettingsRepository): AppSettings {
  const service = new SettingsService(repo, new HardwareService());
  service.initialize();
  return service.get();
}

describe('nâng cấp lên 1.7.6: gỡ "tạo thêm bản CapCut" do nút "Theo máy" tự bật', () => {
  it('đã bấm "Theo máy" (1080p) → mở lên là "CapCut trực tiếp · 1080p", một tệp', () => {
    const settings = open(oldInstall({ downloadCompatibilityMode: 'source', downloadEditCopyMode: 'capcut_sdr_1080p' }));
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_1080p');
  });

  it('nút đã chọn bản 2K → "CapCut trực tiếp · 2K", một tệp', () => {
    const settings = open(oldInstall({ downloadCompatibilityMode: 'source', downloadEditCopyMode: 'capcut_sdr_2k' }));
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_2k');
  });

  it('sau đó người dùng tự chọn chế độ CapCut ở Cài đặt → giữ đúng chế độ đã chọn, chỉ gỡ bản thêm', () => {
    const settings = open(oldInstall({ downloadCompatibilityMode: 'capcut_sdr_2k', downloadEditCopyMode: 'capcut_sdr_1080p' }));
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_2k');
    expect(settings.downloadEditCopyMode).toBe('off');
  });

  it('không có dấu vết của nút (không bật bản thêm) → không đụng gì, kể cả khi đang "Theo nguồn"', () => {
    const before = { ...defaultAppSettings, downloadCompatibilityMode: 'source' as const, downloadEditCopyMode: 'off' as const, downloadMaxHeight: 1080 };
    const settings = open(oldInstall(before));
    expect(settings.downloadCompatibilityMode).toBe('source');
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadMaxHeight).toBe(1080);
  });

  it('chỉ chạy một lần: mở lại lần nữa không đổi gì thêm', () => {
    const repo = oldInstall({ downloadCompatibilityMode: 'source', downloadEditCopyMode: 'capcut_sdr_1080p' });
    open(repo);
    const changed = { ...repo.getAppSettings(defaultAppSettings), downloadCompatibilityMode: 'source' as const };
    repo.saveAppSettings(changed);
    expect(open(repo).downloadCompatibilityMode, 'lựa chọn sau nâng cấp của người dùng được giữ').toBe('source');
  });
});
