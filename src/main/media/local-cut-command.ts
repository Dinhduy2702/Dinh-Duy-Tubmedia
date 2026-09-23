/**
 * Giai đoạn 6 mục 2 — lệnh ffmpeg cho tính năng "Cắt tệp có sẵn". Không dùng ClipEngine (gắn chặt với
 * QueueJob/ProjectItem/checkpoint DB và LUÔN mã hóa lại) vì đây là công cụ độc lập, đơn giản, thao tác
 * trực tiếp trên một tệp người dùng tự chọn — không qua hàng đợi/dự án nào.
 */

/** Trích một khung hình tại đúng mốc thời gian của MỘT TỆP CỤC BỘ — không cần yt-dlp/mạng. */
export function buildLocalFrameExtractArguments(
  filePath: string,
  timestampSeconds: number,
  framePath: string
): string[] {
  const safeTimestamp = Math.max(0, timestampSeconds);
  return ['-y', '-v', 'error', '-ss', String(safeTimestamp), '-i', filePath, '-frames:v', '1', '-q:v', '3', framePath];
}

export interface LocalCutArgumentsInput {
  filePath: string;
  startSeconds: number;
  endSeconds: number;
  accurateCut: boolean;
  outputPath: string;
}

/**
 * Cắt đoạn [startSeconds, endSeconds) của một tệp cục bộ.
 * - Sao chép nhanh (accurateCut=false): -ss trước -i (tua theo keyframe gần nhất — nhanh, giữ nguyên
 *   chất lượng, có thể lệch vài giây quanh điểm cắt — đúng như đã giải thích và được người dùng chấp
 *   nhận).
 * - Chính xác (accurateCut=true): mã hóa lại (giống thông số ClipEngine đang dùng cho nhất quán chất
 *   lượng trong toàn app: libx264 veryfast crf 18, aac 48kHz) để cắt đúng từng khung hình.
 */
export function buildLocalCutArguments(input: LocalCutArgumentsInput): string[] {
  const duration = Math.max(0.01, input.endSeconds - input.startSeconds);
  const base = ['-hide_banner', '-y', '-ss', String(input.startSeconds), '-i', input.filePath, '-t', String(duration)];

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
