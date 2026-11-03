/**
 * 2026-11-02 (người dùng duyệt): chống lag khi tải vào ổ cứng cơ (HDD). Ca thật: ổ lưu E: là HDD, 2 danh sách vừa tải vừa tạo
 * bản dựng CapCut (23,7 GB ghi trong 30 phút) → mọi thứ khác dùng ổ E: khựng; tắt Tubmedia thì mượt lại.
 *
 * Mọi ngưỡng tự dò theo máy đang chạy — loại ổ thật của ổ đang ghi (Get-PhysicalDisk, xem hardware-service.ts), độ bận đo
 * thật (DiskBusyMonitor) và số nhân CPU; máy dev chỉ là mẫu kiểm logic.
 */

export type DiskKind = 'hdd' | 'ssd' | 'unknown';

/**
 * Độ bận (%) từ đó coi ổ là nghẽn. Ổ cứng cơ chỉ có một đầu đọc: thời gian chờ mỗi lần đọc/ghi tăng theo 1 / (1 − độ bận) —
 * bận 60% đã chậm ~2,5 lần, nên chương trình khác dùng ổ đó (CapCut, Explorer) khựng rõ trước khi ổ "đầy tải". SSD xử lý song
 * song nhiều yêu cầu nên giữ mức cũ. Ổ không rõ loại giữ mức cũ (không đoán).
 */
export function diskBusyThresholdPercent(kind: DiskKind): number {
  return kind === 'hdd' ? 60 : 85;
}

/** Các ổ đang nhận video → ngưỡng khắt khe nhất (ổ chậm nhất quyết định); không có ổ nào → mức cũ. */
export function diskBusyThresholdForDrives(letters: Iterable<string>, kindOf: (letter: string) => DiskKind): number {
  let threshold = diskBusyThresholdPercent('unknown');
  for (const letter of letters) threshold = Math.min(threshold, diskBusyThresholdPercent(kindOf(letter)));
  return threshold;
}
