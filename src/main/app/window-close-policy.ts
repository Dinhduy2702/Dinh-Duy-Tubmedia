import type { AppSettings } from '@shared/types/domain.js';

/**
 * Chính sách nút X và nút thu nhỏ (—) — vấn đề #3 khám phá bản cài 2026-10-05.
 * Trước đây công tắc "Thu nhỏ xuống khay hệ thống" lấn át ô "Khi đóng ứng dụng": bấm X luôn ẩn xuống khay
 * dù chọn "Luôn hỏi", để lại tiến trình chạy ẩn nhiều giờ. Quyết định của người dùng: hai cài đặt tách bạch —
 * nút X CHỈ theo ô "Khi đóng ứng dụng", công tắc CHỈ áp dụng cho nút thu nhỏ.
 */
export type CloseAction = 'hide-to-tray' | 'quit' | 'ask' | 'pause_and_exit' | 'cancel_and_exit';
export type MinimizeAction = 'hide-to-tray' | 'default';

/** Cố ý KHÔNG nhận minimizeToTray: nút X không bao giờ phụ thuộc công tắc của nút thu nhỏ. */
export function decideCloseAction(input: {
  closeBehavior: AppSettings['closeBehavior'];
  activeCount: number;
}): CloseAction {
  if (input.closeBehavior === 'tray') return 'hide-to-tray';
  // Không có tác vụ nào chạy: thoát hẳn ngay, kể cả với "Luôn hỏi" (không còn gì để hỏi giữ hay hủy).
  if (input.activeCount <= 0) return 'quit';
  return input.closeBehavior;
}

export function decideMinimizeAction(input: { minimizeToTray: boolean }): MinimizeAction {
  return input.minimizeToTray ? 'hide-to-tray' : 'default';
}
