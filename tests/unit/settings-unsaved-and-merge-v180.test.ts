import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';

const root = process.cwd();
const settingsPage = readFileSync(join(root, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8');
const appStore = readFileSync(join(root, 'src/renderer/src/stores/app-store.ts'), 'utf8');

describe('#27: SettingsPage không mất mục đang sửa khi đổi Sáng/Tối hoặc Cookies, nhắc chưa lưu & giữ nguyên <select>', () => {
  it('mergeExternalSettingsUpdate cập nhật theme/cookies mới mà không ghi đè mục người dùng đang sửa', async () => {
    const { mergeExternalSettingsUpdate, hasUnsavedSettingsChanges } = await import(
      '../../src/shared/utils/settings-draft.js'
    );
    const base = { ...defaultAppSettings };
    const local = { ...base, proxy: 'http://127.0.0.1:8888', rateLimit: '5M' };
    const afterThemeToggle = { ...base, theme: 'light' as const };

    const merged = mergeExternalSettingsUpdate(local, base, afterThemeToggle);
    expect(merged.theme).toBe('light');
    expect(merged.proxy).toBe('http://127.0.0.1:8888');
    expect(merged.rateLimit).toBe('5M');
    expect(hasUnsavedSettingsChanges(merged, afterThemeToggle)).toBe(true);

    const afterCookies = { ...afterThemeToggle, cookiesBrowser: 'firefox' as const, cookiesFilePath: '' };
    const merged2 = mergeExternalSettingsUpdate(merged, afterThemeToggle, afterCookies);
    expect(merged2.cookiesBrowser).toBe('firefox');
    expect(merged2.proxy).toBe('http://127.0.0.1:8888');
    expect(hasUnsavedSettingsChanges(merged2, afterCookies)).toBe(true);
    expect(hasUnsavedSettingsChanges(afterCookies, afterCookies)).toBe(false);
  });

  it('SettingsPage dùng mergeExternalSettingsUpdate, hiện thanh nhắc chưa lưu và ConfirmDialog khi rời trang', () => {
    expect(settingsPage).toContain('mergeExternalSettingsUpdate(');
    expect(settingsPage).toContain('hasUnsavedSettingsChanges(');
    expect(settingsPage).toContain('settings-unsaved-bar');
    expect(settingsPage).toContain('Bạn có thay đổi cài đặt chưa lưu');
    expect(settingsPage).toContain('<ConfirmDialog');
    expect(appStore).toContain('pendingNavigationPage');
    expect(appStore).toContain('settingsDirty');
  });

  it('GIỮ NGUYÊN 100% các <select> từ commit fa39c08, KHÔNG đổi ngược thành type="number"', () => {
    expect(settingsPage).not.toContain('type="number"');
    expect(settingsPage).toContain('<NumericSelect');
    expect(settingsPage).toContain('<NullableNumericSelect');
  });
});
