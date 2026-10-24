import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '49.0.0', getPath: () => '' }
}));

import { AppUpdateService, hasActiveWork } from '../../src/main/updates/app-update-service.js';
import type { AppUpdateActiveWork } from '../../src/shared/types/domain.js';

// 2026-10-24 (người dùng duyệt): nút "khởi động lại" trong thông báo và ở trang Cập nhật cùng một hành vi; đang có việc chạy
// thì hỏi lại người dùng (không tự hủy, không tự hoãn); dò bản mới chạy ngầm đều đặn, cùng phiên bản đã tải thì giữ "sẵn sàng".

type FakeUpdater = EventEmitter & {
  quitAndInstall: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
};

let work: AppUpdateActiveWork;
let updater: FakeUpdater;
let backups: { create: ReturnType<typeof vi.fn> };
let prepareForInstall: ReturnType<typeof vi.fn<() => Promise<void>>>;
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
let settings: { appFeedUrl: string; appUpdateChannel: 'stable' | 'beta'; autoCheckAppUpdates: boolean };
let service: AppUpdateService;

// Phiên bản giả lập: app đang chạy 49.0.0 (mock electron), máy chủ có NEXT/LATER (không phải số phiên bản thật của app — quy tắc verify-version-consistency).
const NEXT = '50.0.0';
const LATER = '50.0.1';
const releaseInfo = (version: string): Record<string, unknown> => ({ version, releaseDate: '2026-10-24', releaseNotes: '' });

beforeEach(() => {
  work = { queueJobs: 0, quickDownload: false, otherProcesses: 0 };
  updater = Object.assign(new EventEmitter(), {
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([]))
  });
  backups = { create: vi.fn(() => Promise.resolve()) };
  prepareForInstall = vi.fn<() => Promise<void>>(() => Promise.resolve());
  logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  settings = { appFeedUrl: 'https://example.com/tubmedia', appUpdateChannel: 'stable', autoCheckAppUpdates: true };
  service = new AppUpdateService(
    { get: () => settings } as never,
    { activeCount: () => 0 } as never,
    backups as never,
    logger as never,
    prepareForInstall,
    () => work
  );
  const internals = service as unknown as { updater: unknown; bindEvents: (value: unknown) => void };
  internals.bindEvents(updater);
  internals.updater = updater;
});

const markDownloaded = (version = NEXT): void => {
  updater.emit('update-available', releaseInfo(version));
  updater.emit('update-downloaded', releaseInfo(version));
};

describe('cài bản mới & khởi động lại', () => {
  it('không có việc chạy: cài và khởi động lại ngay (sao lưu, chuẩn bị thoát, cài im lặng rồi mở lại)', async () => {
    markDownloaded();
    await service.install();
    expect(backups.create).toHaveBeenCalledOnce();
    expect(prepareForInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('đang có việc chạy mà chưa xác nhận: chặn như cũ, không đụng gì', async () => {
    markDownloaded();
    work = { queueJobs: 3, quickDownload: true, otherProcesses: 0 };
    await expect(service.install()).rejects.toMatchObject({ code: 'UPDATE_BLOCKED_ACTIVE_WORK' });
    expect(prepareForInstall).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('đang có việc chạy và người dùng chọn "Vẫn khởi động lại": cài ngay, ghi nhật ký', async () => {
    markDownloaded();
    work = { queueJobs: 2, quickDownload: false, otherProcesses: 0 };
    await service.install({ allowActiveWork: true });
    expect(prepareForInstall, 'bước thoát giữ tác vụ dở dang như khi đóng app').toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(logger.warn).toHaveBeenCalledWith(
      'update',
      'APP_UPDATE_INSTALL_WITH_ACTIVE_WORK',
      expect.stringContaining('2 tác vụ hàng đợi'),
      expect.anything()
    );
  });

  it('chưa có bản mới đã tải thì không cài, kể cả khi đã xác nhận', async () => {
    updater.emit('update-available', releaseInfo(NEXT));
    await expect(service.install({ allowActiveWork: true })).rejects.toMatchObject({ code: 'UPDATE_NOT_NEWER' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('báo đúng việc đang chạy cho hộp hỏi lại', () => {
    work = { queueJobs: 1, quickDownload: true, otherProcesses: 0 };
    expect(service.activeWork()).toEqual(work);
    expect(hasActiveWork(work)).toBe(true);
    expect(hasActiveWork({ queueJobs: 0, quickDownload: false, otherProcesses: 0 })).toBe(false);
    expect(hasActiveWork({ queueJobs: 0, quickDownload: false, otherProcesses: 1 })).toBe(true);
  });
});

describe('dò bản mới chạy ngầm', () => {
  it('lượt dò định kỳ khi bản mới đã tải xong: cùng phiên bản → vẫn "sẵn sàng cài đặt" (không quay về "có bản mới")', () => {
    markDownloaded(NEXT);
    updater.emit('update-available', releaseInfo(NEXT));
    expect(service.getStatus().state).toBe('downloaded');
    expect(service.getStatus().info?.version).toBe(NEXT);
  });

  it('có bản còn mới hơn bản đã tải → báo "có bản mới" cho bản đó', () => {
    markDownloaded(NEXT);
    updater.emit('update-available', releaseInfo(LATER));
    expect(service.getStatus()).toMatchObject({ state: 'available', info: { version: LATER } });
  });

  it('chỉ dò khi lần dò gần nhất đã cũ; không dò khi đang tải/cài hoặc người dùng tắt tự kiểm tra', () => {
    const check = vi.spyOn(service, 'check').mockResolvedValue(service.getStatus());
    const now = Date.now();
    updater.emit('update-not-available', releaseInfo('49.0.0'));
    expect(service.refreshIfStale(10 * 60_000, now + 60_000), 'vừa dò 1 phút trước').toBe(false);
    expect(service.refreshIfStale(10 * 60_000, now + 11 * 60_000)).toBe(true);
    expect(check).toHaveBeenCalledWith(true);

    settings.autoCheckAppUpdates = false;
    expect(service.refreshIfStale(10 * 60_000, now + 60 * 60_000)).toBe(false);
    settings.autoCheckAppUpdates = true;

    updater.emit('download-progress', { percent: 10, bytesPerSecond: 1, transferred: 1, total: 10 });
    expect(service.refreshIfStale(10 * 60_000, now + 60 * 60_000), 'đang tải bản mới').toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
