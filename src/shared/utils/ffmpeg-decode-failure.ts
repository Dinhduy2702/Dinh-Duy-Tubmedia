/**
 * Đọc stderr của ffmpeg khi giải mã thất bại: giữ nguyên các câu lỗi gốc (bỏ dòng thông tin, dòng blackdetect/freezedetect)
 * và nhận ra lỗi nằm ở luồng hình hay luồng tiếng.
 *
 * Vụ khách 2026-10-15: hậu kiểm chỉ ghi "Lỗi giải mã hình ảnh … gần 00:11:05" trong khi ffmpeg báo
 * "aac … error in spectral data" (luồng tiếng) — không có câu lỗi gốc thì không chẩn đoán được nếu không nhờ khách chạy lệnh.
 */
export type DecodeFailureStream = 'video' | 'audio';

export interface FfmpegDecodeFailure {
  stream: DecodeFailureStream | null;
  detail: string;
}

export const FFMPEG_DECODE_DETAIL_MAX_LENGTH = 1_500;

const ERROR_LINE = /error|invalid|corrupt|overflow|missing|not allowed|not allocated|could not|failed|concealing/i;
const AUDIO_DECODERS = new Set([
  'aac', 'aac_fixed', 'aac_latm', 'mp3', 'mp3float', 'mp2', 'mp2float', 'opus', 'libopus', 'vorbis', 'libvorbis',
  'ac3', 'ac3_fixed', 'eac3', 'flac', 'alac', 'dca', 'truehd', 'wmav2', 'wmapro'
]);
const VIDEO_DECODERS = new Set([
  'h264', 'hevc', 'vp8', 'vp9', 'libvpx', 'libvpx-vp9', 'av1', 'libdav1d', 'libaom-av1', 'mpeg4', 'mpeg2video',
  'mpeg1video', 'mjpeg', 'prores', 'vc1', 'h263', 'wmv3', 'h264_cuvid', 'hevc_cuvid'
]);

function streamOfLine(line: string): DecodeFailureStream | null {
  if (line.includes('[aist#')) return 'audio';
  if (line.includes('[vist#')) return 'video';
  const decoder = /^\[([\w-]+) @ /.exec(line)?.[1]?.toLowerCase();
  if (!decoder) return null;
  if (AUDIO_DECODERS.has(decoder) || decoder.startsWith('pcm_')) return 'audio';
  if (VIDEO_DECODERS.has(decoder)) return 'video';
  return null;
}

export function describeFfmpegDecodeFailure(stderr: string): FfmpegDecodeFailure {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes('Parsed_') && !/^(Input|Output|Stream) #/.test(line))
    .filter((line) => ERROR_LINE.test(line));

  let stream: DecodeFailureStream | null = null;
  for (const line of lines) {
    stream = streamOfLine(line);
    if (stream) break;
  }

  // Giữ phần CUỐI (câu ffmpeg dừng lại) khi quá dài, nhưng luôn ưu tiên câu lỗi đầu tiên vì đó là nguyên nhân gốc.
  let detail = lines.join('\n');
  if (detail.length > FFMPEG_DECODE_DETAIL_MAX_LENGTH) {
    const first = (lines[0] ?? '').slice(0, 400);
    const budget = FFMPEG_DECODE_DETAIL_MAX_LENGTH - first.length - 5;
    detail = first + '\n…\n' + detail.slice(detail.length - budget);
  }
  return { stream, detail };
}

/** Cụm từ trong câu "Tubmedia đã CHẶN thành phẩm vì phát hiện … tại khoảng …" theo vấn đề đầu tiên của hậu kiểm. */
export function blockedOutputProblemLabel(
  issue: { type: string; stream?: DecodeFailureStream | null } | undefined
): string {
  return issue?.type === 'decode' && issue.stream === 'audio' ? 'lỗi âm thanh' : 'lỗi hình ảnh';
}
