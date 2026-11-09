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
// "tạo thêm bản CapCut" = bật. Chỉ gỡ khi còn DẤU VẾT RÕ của nút cũ — đúng bộ giá trị nút đã ghi một lượt (hồ sơ "Tự động theo
// máy", "Theo nguồn", chất lượng nguồn cao nhất không giới hạn, số mảnh tự dò). Thiếu dấu vết (người dùng đã tự chỉnh sau đó,
// hoặc bật có chủ ý theo cách khác) → giữ nguyên, không tắt mất lựa chọn của người dùng.

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

/** Đúng bộ giá trị nút "Theo máy" của bản ≤ 1.7.5 ghi (DownloadWorkbenchPage applyRecommendation cũ). */
const LEGACY_THEO_MAY: Partial<AppSettings> = {
  defaultResourceProfileId: 'resource-auto',
  downloadCompatibilityMode: 'source',
  downloadEditCopyMode: 'capcut_sdr_1080p',
  downloadMinHeight: 0,
  downloadMaxHeight: 0,
  downloadMinFps: 0,
  downloadMaxFps: 0,
  downloadCodecPreference: 'auto',
  downloadContainerPreference: 'auto',
  downloadMinVideoBitrateKbps: 0,
  downloadVideoBitrateKbps: 0,
  downloadMinAudioBitrateKbps: 0,
  downloadAudioBitrateKbps: 0,
  downloadAllowBelowMinimum: false,
  downloadFragmentsAuto: true
};

describe('nâng cấp lên 1.7.6: CÓ dấu vết rõ của nút "Theo máy" cũ → gỡ bản thêm, về CapCut trực tiếp một tệp', () => {
  it('bản 1080p → "CapCut trực tiếp · 1080p", một tệp', () => {
    const settings = open(oldInstall(LEGACY_THEO_MAY));
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_1080p');
  });

  it('bản 2K → "CapCut trực tiếp · 2K", một tệp', () => {
    const settings = open(oldInstall({ ...LEGACY_THEO_MAY, downloadEditCopyMode: 'capcut_sdr_2k' }));
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_2k');
  });

  it('hồ sơ tự động có số đuôi (resource-auto-<số>, bản cũ đổi tên) vẫn là dấu vết của nút', () => {
    const settings = open(oldInstall({ ...LEGACY_THEO_MAY, defaultResourceProfileId: 'resource-auto-1784736276851' }));
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_1080p');
  });

  it('chỉ chạy một lần: người dùng chọn lại "Theo nguồn" sau nâng cấp thì giữ', () => {
    const repo = oldInstall(LEGACY_THEO_MAY);
    open(repo);
    repo.saveAppSettings({ ...repo.getAppSettings(defaultAppSettings), downloadCompatibilityMode: 'source' });
    expect(open(repo).downloadCompatibilityMode).toBe('source');
  });
});

describe('nâng cấp lên 1.7.6: KHÔNG có dấu vết rõ → giữ nguyên lựa chọn của người dùng', () => {
  it('bật bản thêm nhưng chất lượng đã tự chỉnh khác nút (tối đa 1080p) → giữ bật, giữ "Theo nguồn"', () => {
    const settings = open(oldInstall({ ...LEGACY_THEO_MAY, downloadMaxHeight: 1080 }));
    expect(settings.downloadEditCopyMode).toBe('capcut_sdr_1080p');
    expect(settings.downloadCompatibilityMode).toBe('source');
    expect(settings.downloadMaxHeight).toBe(1080);
  });

  it('bật bản thêm với hồ sơ hiệu năng tự chọn (không phải "Tự động theo máy") → giữ nguyên', () => {
    const settings = open(oldInstall({ ...LEGACY_THEO_MAY, defaultResourceProfileId: 'resource-interactive' }));
    expect(settings.downloadEditCopyMode).toBe('capcut_sdr_1080p');
    expect(settings.downloadCompatibilityMode).toBe('source');
  });

  it('bật bản thêm và người dùng đã tự chọn chế độ CapCut ở Cài đặt → giữ cả hai', () => {
    const settings = open(oldInstall({ ...LEGACY_THEO_MAY, downloadCompatibilityMode: 'capcut_sdr_2k' }));
    expect(settings.downloadEditCopyMode).toBe('capcut_sdr_1080p');
    expect(settings.downloadCompatibilityMode).toBe('capcut_sdr_2k');
  });

  it('bản thêm đang tắt → không đụng gì, kể cả khi đang "Theo nguồn"', () => {
    const settings = open(oldInstall({ ...LEGACY_THEO_MAY, downloadEditCopyMode: 'off' }));
    expect(settings.downloadEditCopyMode).toBe('off');
    expect(settings.downloadCompatibilityMode).toBe('source');
  });
});