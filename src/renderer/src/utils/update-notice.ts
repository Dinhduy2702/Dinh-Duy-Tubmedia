import type { AttentionNotice } from '@shared/types/domain';

/**
 * Thông báo "có bản mới" / "bản mới đã sẵn sàng — khởi động lại" (2026-10-24, người dùng duyệt):
 * - mỗi trạng thái + phiên bản chỉ hiện một lần trong một phiên mở app;
 * - người dùng đã mở trang Cập nhật trong phiên này thì không hiện lại nữa (kể cả khi chuyển trang khác), tới lần mở app sau;
 * - việc dò bản mới vẫn chạy ngầm bình thường — chỉ thông báo bị ẩn.
 * Trước đây "đã hiện" được ghi vĩnh viễn vào localStorage theo phiên bản, nên mở lại app cũng không nhắc lại bản đang chờ cài.
 */
export const UPDATE_ATTENTION_ID_PREFIX = 'app-update-';

export function isUpdateAttention(notice: Pick<AttentionNotice, 'id'> | null | undefined): boolean {
  return Boolean(notice?.id?.startsWith(UPDATE_ATTENTION_ID_PREFIX));
}

export function updateNoticeKey(state: 'available' | 'downloaded', version: string): string {
  return `${state}:${version}`;
}

/** Có hiện thông báo cập nhật này không — chỉ dựa trên trạng thái của phiên đang mở. */
export function shouldShowUpdateNotice(input: {
  updateCenterVisited: boolean;
  shownThisSession: ReadonlySet<string>;
  key: string;
}): boolean {
  return !input.updateCenterVisited && !input.shownThisSession.has(input.key);
}
