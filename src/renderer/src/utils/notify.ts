import type { NoticeTone } from '@shared/utils/notice-tone';
import { useAppStore } from '../stores/app-store';

let sequence = 0;

/**
 * Hiện một thông báo có MỨC RÕ RÀNG do nơi gọi quyết định (không đoán từ chữ).
 * Dùng cho kết quả do giao diện tự tạo ra: thiếu lựa chọn, đã hủy, không có gì để làm...
 * Lỗi thật từ một thao tác vẫn đi qua setError để được dịch sang tiếng Việt dễ hiểu.
 */
export function showNotice(tone: NoticeTone, title: string, message: string, steps: string[] = []): void {
  sequence += 1;
  useAppStore.getState().setAttention({
    id: `ui-${tone}-${Date.now()}-${sequence}`,
    severity: tone,
    title,
    message,
    ...(steps.length > 0 ? { steps } : {}),
    sticky: false
  });
}
