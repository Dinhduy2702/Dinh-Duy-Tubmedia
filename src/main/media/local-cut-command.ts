/**
 * Giai đoạn 6 mục 2/3 — lệnh ffmpeg cho tính năng "Cắt tệp có sẵn" (+ đổi tỉ lệ khung hình). Không dùng
 * ClipEngine (gắn chặt với QueueJob/ProjectItem/checkpoint DB và LUÔN mã hóa lại) vì đây là công cụ độc
 * lập, đơn giản, thao tác trực tiếp trên một tệp người dùng tự chọn — không qua hàng đợi/dự án nào.
 */
import type { LocalCutAspectRatio } from '@shared/local-cut.js';
// Giai đoạn 6 mục 4 (2026-09-24): bộ lọc nền mờ kiểu CapCut được tách ra tệp dùng chung để "preset xuất
// theo nền tảng" ở Ghép theo Timeline tái dùng nguyên vẹn — không định nghĩa lại.
import { ASPECT_RATIO_DIMENSIONS, buildAspectRatioFilter } from './aspect-ratio-filter.js';

/** Trích một khung hình tại đúng mốc thời gian của MỘT TỆP CỤC BỘ — không cần yt-dlp/mạng. Khi
 * aspectRatio khác 'original', khung hình xem trước phản ánh ĐÚNG kết quả sau khi đổi tỉ lệ (nền mờ +
 * video gốc giữa) — không phải khung hình gốc chưa xử lý. */
export function buildLocalFrameExtractArguments(
  filePath: string,
  timestampSeconds: number,
  framePath: string,
  aspectRatio: LocalCutAspectRatio = 'original'
): string[] {
  const safeTimestamp = Math.max(0, timestampSeconds);
  const base = ['-y', '-v', 'error', '-ss', String(safeTimestamp), '-i', filePath];

  if (aspectRatio === 'original') {
    return [...base, '-frames:v', '1', '-q:v', '3', framePath];
  }

  const { width, height } = ASPECT_RATIO_DIMENSIONS[aspectRatio];
  return [...base, '-filter_complex', buildAspectRatioFilter(width, height), '-frames:v', '1', '-q:v', '3', framePath];
}

export interface LocalCutArgumentsInput {
  filePath: string;
  startSeconds: number;
  endSeconds: number;
  accurateCut: boolean;
  aspectRatio: LocalCutAspectRatio;
  outputPath: string;
}

/**
 * Cắt đoạn [startSeconds, endSeconds) của một tệp cục bộ, có thể kèm đổi tỉ lệ khung hình.
 * - Sao chép nhanh (accurateCut=false, CHỈ khi aspectRatio='original'): -ss trước -i (tua theo keyframe
 *   gần nhất — nhanh, giữ nguyên chất lượng, có thể lệch vài giây quanh điểm cắt — đúng như đã giải
 *   thích và được người dùng chấp nhận).
 * - Chính xác (accurateCut=true, hoặc BẮT BUỘC khi đổi tỉ lệ vì bộ lọc pixel không thể đi cùng -c copy):
 *   mã hóa lại (cùng thông số ClipEngine đang dùng cho nhất quán chất lượng trong toàn app: libx264
 *   veryfast crf 18, aac 48kHz).
 */
export function buildLocalCutArguments(input: LocalCutArgumentsInput): string[] {
  const duration = Math.max(0.01, input.endSeconds - input.startSeconds);
  const base = ['-hide_banner', '-y', '-ss', String(input.startSeconds), '-i', input.filePath, '-t', String(duration)];

  if (input.aspectRatio === 'original') {
    if (!input.accurateCut) {
      return [...base, '-map', '0', '-c', 'copy', '-progress', 'pipe:1', '-nostats', input.outputPath];
    }

    return [
      ...base,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      input.outputPath
    ];
  }

  // Đổi tỉ lệ: luôn mã hóa lại — filter_complex xử lý pixel (nền mờ + đặt giữa) không thể đi cùng -c copy.
  const { width, height } = ASPECT_RATIO_DIMENSIONS[input.aspectRatio];
  return [
    ...base,
    '-filter_complex',
    buildAspectRatioFilter(width, height),
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    input.outputPath
  ];
}
