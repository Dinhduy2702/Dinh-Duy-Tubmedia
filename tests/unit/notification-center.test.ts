import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('Trung tâm thông báo độc lập', () => {
  it('opens a dedicated notification panel instead of navigating the bell to diagnostics', async () => {
    const [topbar, app, center] = await Promise.all([
      source('src/renderer/src/layout/Topbar.tsx'),
      source('src/renderer/src/app/App.tsx'),
      source('src/renderer/src/components/NotificationCenter.tsx')
    ]);

    expect(topbar).toContain('id="notification-center-trigger"');
    expect(topbar).toContain('onClick={notificationSummary.toggle}');
    expect(topbar).toContain('aria-controls="notification-center-panel"');
    expect(topbar).not.toContain('title="Mở chẩn đoán"');
    expect(app).toContain('<NotificationCenter />');
    expect(center).toContain('id="notification-center-panel"');
    expect(center).toContain('Trung tâm thông báo');
  });

  it('persists read, pin and retention state without exposing raw technical data', async () => {
    const [store, center] = await Promise.all([
      source('src/renderer/src/stores/app-store.ts'),
      source('src/renderer/src/components/NotificationCenter.tsx')
    ]);

    expect(store).toContain("const NOTIFICATION_STORAGE_KEY = 'tubmedia.notification-center.v1'");
    expect(store).toContain('const MAX_NOTIFICATIONS = 150');
    expect(store).toContain('success: DAY_MS');
    expect(store).toContain('info: 3 * DAY_MS');
    expect(store).toContain('markAllNotificationsRead');
    expect(store).toContain('toggleNotificationPin');
    expect(store).toContain('if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;');
    expect(center).not.toContain('JSON.stringify');
    expect(center).not.toContain('eventCode');
    expect(center).not.toContain('progressPhases');
    expect(center).not.toContain('cookieFailureConfirmed');
  });

  it('offers useful actions while diagnostics remains an explicit secondary choice', async () => {
    const center = await source('src/renderer/src/components/NotificationCenter.tsx');

    expect(center).toContain("return { page: 'updates', label: 'Mở cập nhật' }");
    expect(center).toContain("return { page: 'cleanup', label: 'Dọn dung lượng' }");
    expect(center).toContain("return { page: 'tools', label: 'Mở công cụ' }");
    expect(center).toContain("return { page: 'activity', label: 'Xem tác vụ' }");
    expect(center).toContain('Mở chẩn đoán');
    expect(center).toContain('Mở thư mục');
    expect(center).toContain('Sao chép đường dẫn');
  });
});
