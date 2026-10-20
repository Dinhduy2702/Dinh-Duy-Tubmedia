/** Tiến độ của một lượt "Xuất báo cáo lỗi" (giao diện hỏi định kỳ như Dọn dẹp máy). */
export interface ErrorReportStatus {
  runId: string;
  jobId: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  step: string;
  /** Số tệp đã kiểm / tổng số tệp cần kiểm (0/0 khi chưa tới bước kiểm tệp). */
  current: number;
  total: number;
  outputPath: string;
  error: string | null;
}
