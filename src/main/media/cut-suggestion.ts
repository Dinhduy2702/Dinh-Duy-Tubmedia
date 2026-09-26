/**
 * Tính năng C1 (2026-09-26) — "Gợi ý điểm cắt tự động": tìm các mốc AN TOÀN ĐỂ CẮT bên trong một video
 * cục bộ, dựa THUẦN TÚY vào 2 bộ lọc kỹ thuật có sẵn của FFmpeg — KHÔNG dùng AI/mô hình học máy nào:
 *   - silencedetect: khoảng lặng âm thanh (ranh giới câu nói tự nhiên).
 *   - scdet (qua select='gt(scene,...)' + showinfo): thời điểm đổi cảnh hình ảnh.
 * Đặt tên tính năng đúng bản chất kỹ thuật, không gọi là "AI", để không gây kỳ vọng sai cho người dùng
 * (đã thống nhất khi lập kế hoạch tích hợp AI, KE_HOACH_AI_v2.md).
 *
 * Ngưỡng độ nhạy CỐ ĐỊNH, không cho chỉnh (đã hỏi và được người dùng chọn mức tối giản trước) — dùng mức
 * hợp lý cho video nói chuyện/reup thông thường:
 *   - Im lặng: dưới -30dB, kéo dài tối thiểu 0,5 giây.
 *   - Đổi cảnh: điểm số scene > 0.4 (thang 0-1 của FFmpeg — kinh nghiệm chung là mức phân biệt tốt giữa
 *     đổi cảnh thật và chuyển động thường trong cùng cảnh).
 *
 * Chạy 2 lượt FFmpeg RIÊNG (một lượt chỉ âm thanh -vn, một lượt chỉ hình ảnh -an) thay vì gộp chung một
 * lượt filter_complex phức tạp — đơn giản hơn, dễ kiểm chứng đúng/sai riêng từng phần, chấp nhận đánh đổi
 * giải mã tệp 2 lần (đây là thao tác một lần do người dùng chủ động bấm, không phải việc chạy nền liên
 * tục — không đáng lo về hiệu năng).
 */
import type { CutSuggestion, CutSuggestionReason } from '@shared/local-cut.js';

/** Không cần thời gian thực — chạy nền dưới nút bấm chủ động, nhưng vẫn cần chặn trên video cực dài. */
export const CUT_SUGGESTION_ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;

const SILENCE_NOISE_THRESHOLD_DB = -30;
const SILENCE_MIN_DURATION_SECONDS = 0.5;
const SCENE_CHANGE_THRESHOLD = 0.4;

/** Đoạn gợi ý phải đủ dài để đáng cắt (không phải nhiễu vài trăm mili giây) nhưng không quá dài tới mức
 * không còn là "một đoạn nổi bật" — 3 giây tới 3 phút là khoảng hợp lý cho cả clip ngắn lẫn đoạn dài. */
const MIN_SUGGESTION_SECONDS = 3;
const MAX_SUGGESTION_SECONDS = 180;
const MAX_SUGGESTIONS = 8;

export function buildSilenceDetectArguments(filePath: string): string[] {
  return [
    '-hide_banner',
    '-i',
    filePath,
    '-vn',
    '-af',
    `silencedetect=noise=${SILENCE_NOISE_THRESHOLD_DB}dB:d=${SILENCE_MIN_DURATION_SECONDS}`,
    '-f',
    'null',
    '-'
  ];
}

export function buildSceneDetectArguments(filePath: string): string[] {
  return [
    '-hide_banner',
    '-i',
    filePath,
    '-an',
    '-vf',
    `select='gt(scene,${SCENE_CHANGE_THRESHOLD})',showinfo`,
    '-f',
    'null',
    '-'
  ];
}

const DURATION_PATTERN = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const SILENCE_START_PATTERN = /silence_start:\s*(-?[\d.]+)/;
const SILENCE_END_PATTERN = /silence_end:\s*(-?[\d.]+)/;
const SCENE_PTS_TIME_PATTERN = /pts_time:\s*([\d.]+)/;

/** FFmpeg luôn in dòng "Duration: HH:MM:SS.mm..." ở đầu, bất kể bộ lọc nào — không cần gọi ffprobe
 * riêng, đọc thẳng từ đúng lượt phân tích đầu tiên. */
export function parseFfmpegDurationSeconds(lines: readonly string[]): number | null {
  for (const line of lines) {
    const match = DURATION_PATTERN.exec(line);
    if (!match) continue;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (![hours, minutes, seconds].every(Number.isFinite)) continue;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

export interface SilenceInterval {
  start: number;
  end: number;
}

export function parseSilenceIntervals(lines: readonly string[]): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;
  for (const line of lines) {
    const startMatch = SILENCE_START_PATTERN.exec(line);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = SILENCE_END_PATTERN.exec(line);
    if (endMatch && pendingStart !== null) {
      const end = Number(endMatch[1]);
      if (end > pendingStart) intervals.push({ start: pendingStart, end });
      pendingStart = null;
    }
  }
  return intervals;
}

export function parseSceneTimestamps(lines: readonly string[]): number[] {
  const timestamps: number[] = [];
  for (const line of lines) {
    const match = SCENE_PTS_TIME_PATTERN.exec(line);
    if (match) timestamps.push(Number(match[1]));
  }
  return timestamps;
}

interface BoundaryPoint {
  time: number;
  reason: CutSuggestionReason;
}

/**
 * Ghép khoảng lặng (lấy ĐIỂM GIỮA — an toàn hơn cắt sát mép vì tránh hụt đầu/cuối câu nói) và thời điểm
 * đổi cảnh thành một dãy MỐC AN TOÀN ĐỂ CẮT đã sắp xếp, rồi lấy từng cặp mốc liền kề làm một đoạn gợi ý.
 * Lọc theo độ dài hợp lý, xếp đoạn DÀI NHẤT lên đầu (đã hỏi và được chọn "rõ nhất/dài nhất"), giới hạn
 * tối đa 8 đoạn để danh sách không quá dài với video nhiều điểm lặng/đổi cảnh.
 */
export function buildCutSuggestions(
  durationSeconds: number,
  silences: readonly SilenceInterval[],
  sceneTimestamps: readonly number[]
): CutSuggestion[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];

  const innerPoints: BoundaryPoint[] = [];
  for (const silence of silences) {
    const midpoint = (silence.start + silence.end) / 2;
    if (midpoint > 0 && midpoint < durationSeconds) innerPoints.push({ time: midpoint, reason: 'silence' });
  }
  for (const time of sceneTimestamps) {
    if (time > 0 && time < durationSeconds) innerPoints.push({ time, reason: 'scene' });
  }
  innerPoints.sort((a, b) => a.time - b.time);

  const boundaries: BoundaryPoint[] = [
    { time: 0, reason: 'edge' },
    ...innerPoints,
    { time: durationSeconds, reason: 'edge' }
  ];

  const candidates: CutSuggestion[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (!start || !end) continue;
    const length = end.time - start.time;
    if (length < MIN_SUGGESTION_SECONDS || length > MAX_SUGGESTION_SECONDS) continue;
    candidates.push({
      startSeconds: Math.round(start.time * 10) / 10,
      endSeconds: Math.round(end.time * 10) / 10,
      startReason: start.reason,
      endReason: end.reason
    });
  }

  const durationOf = (item: CutSuggestion): number => item.endSeconds - item.startSeconds;
  return candidates.sort((a, b) => durationOf(b) - durationOf(a)).slice(0, MAX_SUGGESTIONS);
}
