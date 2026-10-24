import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AttentionNotice } from '../../src/shared/types/domain.js';

// 2026-10-24 (người dùng duyệt): đã vào trang Cập nhật trong phiên đang mở thì không hiện lại thông báo "có bản mới" /
// "cần khởi động lại" nữa, kể cả khi chuyển sang trang khác — tới lần mở app sau. Việc dò bản mới vẫn chạy ngầm.

// Kho trạng thái của giao diện nằm ngoài dự án TypeScript của tiến trình chính — nạp bằng đường dẫn tính lúc chạy.
interface StoreLike {
  getState(): {
    page: string;
    attention: AttentionNotice | null;
    attentionQueue: AttentionNotice[];
    updateCenterVisited: boolean;
    setAttention(notice: AttentionNotice): void;
    setPage(page: string): void;
  };
  setState(partial: Record<string, unknown>): void;
}
interface NoticeModule {
  shouldShowUpdateNotice(input: { updateCenterVisited: boolean; shownThisSession: ReadonlySet<string>; key: string }): boolean;
  updateNoticeKey(state: 'available' | 'downloaded', version: string): string;
  isUpdateAttention(notice: { id: string } | null): boolean;
}
const storePath = '../../src/renderer/src/stores/app-store.js';
const noticePath = '../../src/renderer/src/utils/update-notice.js';
const installFlowPath = '../../src/renderer/src/hooks/use-install-update.js';
const { useAppStore } = (await import(/* @vite-ignore */ storePath)) as { useAppStore: StoreLike };
const notice = (await import(/* @vite-ignore */ noticePath)) as NoticeModule;
const { activeWorkLines } = (await import(/* @vite-ignore */ installFlowPath)) as {
  activeWorkLines(work: { queueJobs: number; quickDownload: boolean; otherProcesses: number }): string[];
};

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const updateNotice = (state: 'available' | 'downloaded', version = '1.7.2'): AttentionNotice => ({
  id: `app-update-${state}:${version}`,
  severity: state === 'downloaded' ? 'success' : 'info',
  title: state === 'downloaded' ? 'Bản cập nhật đã sẵn sàng' : `Đã có Tubmedia ${version}`,
  message: 'x',
  sticky: state === 'downloaded'
});
const otherNotice: AttentionNotice = { id: 'khac-1', severity: 'warning', title: 'Việc khác', message: 'y', code: 'DISK_FULL' };

beforeEach(() => {
  useAppStore.setState({
    page: 'editor-home',
    attention: null,
    attentionQueue: [],
    notifications: [],
    dismissedIssues: [],
    updateCenterVisited: false
  });
});

describe('thông báo cập nhật theo phiên', () => {
  it('mỗi trạng thái + phiên bản hiện một lần trong phiên; đã vào trang Cập nhật thì không hiện nữa', () => {
    const key = notice.updateNoticeKey('downloaded', '1.7.2');
    expect(notice.shouldShowUpdateNotice({ updateCenterVisited: false, shownThisSession: new Set(), key })).toBe(true);
    expect(notice.shouldShowUpdateNotice({ updateCenterVisited: false, shownThisSession: new Set([key]), key })).toBe(false);
    expect(notice.shouldShowUpdateNotice({ updateCenterVisited: true, shownThisSession: new Set(), key })).toBe(false);
  });

  it('vào trang Cập nhật: đóng thông báo cập nhật đang hiện và đang chờ, giữ thông báo khác', () => {
    const store = useAppStore.getState();
    store.setAttention(updateNotice('available'));
    store.setAttention(otherNotice);
    store.setAttention(updateNotice('downloaded'));
    useAppStore.getState().setPage('updates');
    const after = useAppStore.getState();
    expect(after.updateCenterVisited).toBe(true);
    const visible = [after.attention, ...after.attentionQueue].filter(Boolean).map((item) => item!.id);
    expect(visible).toEqual(['khac-1']);
  });

  it('sau khi đã vào trang Cập nhật, chuyển trang khác vẫn không hiện lại thông báo cập nhật; thông báo khác vẫn hiện', () => {
    useAppStore.getState().setPage('updates');
    useAppStore.getState().setPage('download-workbench');
    useAppStore.getState().setAttention(updateNotice('downloaded'));
    expect(useAppStore.getState().attention).toBeNull();
    useAppStore.getState().setAttention(otherNotice);
    expect(useAppStore.getState().attention?.id).toBe('khac-1');
  });

  it('chưa vào trang Cập nhật thì thông báo vẫn hiện bình thường', () => {
    useAppStore.getState().setAttention(updateNotice('downloaded'));
    expect(notice.isUpdateAttention(useAppStore.getState().attention)).toBe(true);
  });

  it('không còn ghi "đã hiện" vĩnh viễn vào localStorage — mở lại app thì nhắc lại bản còn chờ', () => {
    const events = source('src/renderer/src/hooks/use-desktop-events.ts');
    expect(events).not.toMatch(/localStorage\.(get|set)Item/);
    expect(events).toContain('updateNoticesShownThisSession');
  });
});

describe('nút khởi động lại trong thông báo', () => {
  it('thông báo "đã sẵn sàng" có nút cài & khởi động lại ngay dùng chung luồng với trang Cập nhật (không chỉ mở trang)', () => {
    const center = source('src/renderer/src/components/AttentionCenter.tsx');
    const page = source('src/renderer/src/pages/UpdatesPage.tsx');
    expect(center).toContain('useInstallUpdate()');
    expect(center).toContain('installUpdate.start()');
    expect(center).toContain("'Cài đặt & khởi động lại'");
    expect(page).toContain('useInstallUpdate()');
    expect(page).toContain('installUpdate.start()');
  });

  it('hộp hỏi lại liệt kê đúng việc đang chạy', () => {
    expect(activeWorkLines({ queueJobs: 3, quickDownload: true, otherProcesses: 0 })).toEqual([
      '3 tác vụ tải, cắt hoặc ghép đang chạy',
      'Tải nhanh đang chạy'
    ]);
    expect(activeWorkLines({ queueJobs: 0, quickDownload: false, otherProcesses: 2 })).toEqual([
      '2 tiến trình công cụ (yt-dlp, FFmpeg…) còn đang chạy'
    ]);
    expect(activeWorkLines({ queueJobs: 0, quickDownload: false, otherProcesses: 0 })).toEqual([]);
  });
});
