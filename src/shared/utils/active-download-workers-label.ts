/**
 * Nhãn "Thiết lập tải đang dùng" ở trang Tải danh sách: số video cùng lúc THẬT của các danh sách đang hiện.
 * Trước đây nhãn lấy số đề xuất theo máy (planForListCount) nên hiện "1/danh sách" trong khi các danh sách
 * đang chạy 2 (khám phá bản cài #7). Số đề xuất vẫn hiện riêng ở ô "Khuyến nghị".
 */
export function activeDownloadWorkersLabel(laneWorkers: readonly number[]): string {
  if (laneWorkers.length === 0) return 'Chưa có danh sách';
  const low = Math.min(...laneWorkers);
  const high = Math.max(...laneWorkers);
  const value = low === high ? String(low) : `${low}–${high}`;
  return `${value}/danh sách · chạy song song độc lập`;
}
