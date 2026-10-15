import type { QueueJob } from '../types/domain.js';

/**
 * Lịch sử công việc (2026-10-12): video lỗi đã có job.errorCode / job.errorMessage cụ thể (đúng câu trong thông báo lúc lỗi)
 * nhưng bảng Lịch sử và tệp CSV không hiện — người dùng không biết vì sao video lỗi.
 */
export const HISTORY_CSV_HEADER = ['Thời gian', 'Dự án', 'Loại', 'Trạng thái', 'Nguồn', 'Đầu ra', 'Mã lỗi', 'Chi tiết lỗi'];

const ERROR_STATUSES = new Set(['failed', 'interrupted']);

function inputText(job: QueueJob, key: string): string {
  const value = job.input[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Câu lỗi cụ thể để hiện trên bảng Lịch sử — chỉ với tác vụ lỗi / bị gián đoạn (tác vụ hoàn tất có thể còn sót câu lỗi của
 * lượt thử trước). Không có câu lỗi thì nêu mã lỗi; không có gì thì null.
 */
export function historyErrorDetail(job: QueueJob): string | null {
  if (!ERROR_STATUSES.has(job.status)) return null;
  const message = job.errorMessage?.trim();
  if (message) return message;
  return job.errorCode ? `Mã lỗi: ${job.errorCode}` : null;
}

/** Bảng CSV của Lịch sử (dòng đầu là tiêu đề). Hai cột lỗi lấy nguyên job.errorCode / job.errorMessage, trống khi không có. */
export function historyCsvTable(
  history: readonly QueueJob[],
  projectName: (projectId: string | null) => string,
  typeLabel: (type: QueueJob['type']) => string
): [string[], ...string[][]] {
  const rows = history.map((job) => [
    job.finishedAt ?? job.updatedAt,
    projectName(job.projectId),
    typeLabel(job.type),
    job.status,
    inputText(job, 'url'),
    inputText(job, 'outputPath'),
    job.errorCode ?? '',
    job.errorMessage ?? ''
  ]);
  return [HISTORY_CSV_HEADER, ...rows];
}
