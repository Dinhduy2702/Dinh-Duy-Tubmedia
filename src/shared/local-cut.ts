/**
 * Giai đoạn 6 mục 2 (2026-09-23) — "Cắt tệp có sẵn": cắt một đoạn từ MỘT VIDEO ĐÃ CÓ SẴN TRÊN MÁY
 * (không qua tải), tích hợp vào bước "Xem trước & Cắt" theo đúng yêu cầu người dùng. Khác hẳn việc cắt
 * NGAY LÚC TẢI (Tải nhanh, Giai đoạn 3) — ở đây không có yt-dlp/mạng nào cả, chỉ ffmpeg chạy trên một
 * tệp cục bộ. Dùng lại parseQuickDownloadTime/formatQuickDownloadTime (không trùng lặp bộ phân tích
 * giờ) và cùng khái niệm "cắt chính xác" (accurateCut) đã quen thuộc từ Tải nhanh.
 */
import { formatQuickDownloadTime, parseQuickDownloadTime } from './quick-download.js';

export interface LocalCutRequest {
  filePath: string;
  outputDirectory: string;
  startTime: string;
  endTime: string;
  accurateCut: boolean;
}

export type LocalCutPhase = 'queued' | 'processing' | 'verifying' | 'completed' | 'cancelled' | 'failed';

export interface LocalCutStatus {
  taskId: string;
  phase: LocalCutPhase;
  progress: number;
  message: string;
  sourceFilePath: string;
  sourceFileName: string;
  outputPath: string | null;
  requestedStartSeconds: number;
  requestedEndSeconds: number;
  actualDurationSeconds: number | null;
  accurateCut: boolean;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  warnings: string[];
}

export interface ValidatedLocalCutRequest {
  filePath: string;
  outputDirectory: string;
  accurateCut: boolean;
  startSeconds: number;
  endSeconds: number;
}

export function validateLocalCutRequest(value: unknown): ValidatedLocalCutRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Yêu cầu cắt tệp không hợp lệ.');
  }

  const candidate = value as Partial<LocalCutRequest>;
  const filePath = typeof candidate.filePath === 'string' ? candidate.filePath.trim() : '';

  if (!filePath || filePath.length > 4_096) {
    throw new Error('Đường dẫn tệp nguồn không hợp lệ.');
  }

  const outputDirectory =
    typeof candidate.outputDirectory === 'string' ? candidate.outputDirectory.trim() : '';

  if (!outputDirectory || outputDirectory.length > 1_024) {
    throw new Error('Thư mục lưu kết quả không hợp lệ.');
  }

  const accurateCut = candidate.accurateCut === true;
  const startSeconds = parseQuickDownloadTime(
    typeof candidate.startTime === 'string' ? candidate.startTime : ''
  );
  const endSeconds = parseQuickDownloadTime(typeof candidate.endTime === 'string' ? candidate.endTime : '');

  if (endSeconds <= startSeconds) {
    throw new Error('Mốc kết thúc phải lớn hơn mốc bắt đầu.');
  }

  if (endSeconds - startSeconds < 1) {
    throw new Error('Đoạn cắt phải dài ít nhất 1 giây.');
  }

  return { filePath, outputDirectory, accurateCut, startSeconds, endSeconds };
}

export { formatQuickDownloadTime, parseQuickDownloadTime };
