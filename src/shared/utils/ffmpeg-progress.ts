export interface FfmpegProgressSnapshot {
  percent: number;
  processedSeconds: number;
  totalSeconds: number;
  speed: string | null;
  speedRatio: number | null;
  fps: number | null;
  etaSeconds: number | null;
  elapsedSeconds: number;
  finished: boolean;
}

function parseClock(value: string): number | null {
  const parts = value.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

function compactDecimal(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

/**
 * Ngưỡng canh tiến độ đứng im cho FFmpeg (1.7.6 V6 — thiết kế cho máy 2 luồng + HDD theo CLAUDE.md mục 7):
 * - Máy 2 luồng mã hoá 4K/HDR bằng libx264 veryfast (~0.5–1 fps) kèm bộ đệm lookahead ~40–60 khung hình và ổ HDD bận
 *   vẫn nhích `out_time_ms` sau tối đa ~60–90 giây; đặt 5 phút (300 000 ms, không tính thời gian đang Tạm dừng) để có
 *   biên an toàn > 3 lần mà không phải chờ 48 giờ khi FFmpeg kẹt chết.
 * - Khi FFmpeg đã mã hoá xong và in `Starting second pass` (dồn moov `+faststart`), `out_time_ms` không tăng nữa trong
 *   lúc chép lại tệp nhiều GB trên HDD (~30–50 MB/s với tệp 20 GB mất ~7–11 phút) → nới cửa sổ hoàn tất lên 15 phút.
 */
export const FFMPEG_PROGRESS_STALL_TIMEOUT_MS = 5 * 60 * 1000;
export const FFMPEG_FASTSTART_FINALIZE_STALL_TIMEOUT_MS = 15 * 60 * 1000;

export function parseFfmpegOutTimeSeconds(line: string): number | null {
  if (line.startsWith('out_time_ms=')) {
    const microseconds = Number(line.slice(12).trim());
    return Number.isFinite(microseconds) && microseconds >= 0 ? microseconds / 1_000_000 : null;
  }
  if (line.startsWith('out_time=')) {
    const seconds = parseClock(line.slice(9));
    return seconds !== null && seconds >= 0 ? seconds : null;
  }
  return null;
}

export function isFfmpegFaststartSecondPassLine(line: string): boolean {
  return line.includes('Starting second pass');
}

export function formatStallClock(seconds: number | null): string {
  const safe = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function buildFfmpegStallMessage(input: {
  stepLabel: string;
  videoLabel?: string | null;
  sourceIndex?: number | null;
  lastProgressSeconds: number | null;
  advice?: string;
}): string {
  const cleanName = input.videoLabel?.trim().slice(0, 90) || '';
  const subject = input.sourceIndex
    ? cleanName
      ? `Video nguồn #${input.sourceIndex} ("${cleanName}")`
      : `Video nguồn #${input.sourceIndex}`
    : cleanName
      ? `Video "${cleanName}"`
      : 'Bước xử lý video';
  const clock = formatStallClock(input.lastProgressSeconds);
  const guidance =
    input.advice ??
    'Đã dừng tiến trình bị kẹt để tránh treo máy; hãy bấm Thử lại hoặc kiểm tra lại tệp nguồn này.';
  return `${subject} bị đứng tiến độ ở bước ${input.stepLabel} tại mốc ${clock}. ${guidance}`;
}

export class FfmpegProgressTracker {
  private processedSeconds = 0;
  private speedRatio: number | null = null;
  private fps: number | null = null;
  private readonly startedAt: number;

  public constructor(
    private readonly totalSeconds: number,
    private readonly now: () => number = Date.now
  ) {
    this.startedAt = now();
  }

  public update(line: string): FfmpegProgressSnapshot | null {
    const separator = line.indexOf('=');
    const key = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).trim() : '';
    let shouldEmit = false;
    let finished = false;

    if (key === 'out_time_ms') {
      const microseconds = Number(value);
      if (Number.isFinite(microseconds)) {
        this.processedSeconds = Math.max(0, microseconds / 1_000_000);
        shouldEmit = true;
      }
    } else if (key === 'out_time') {
      const seconds = parseClock(value);
      if (seconds !== null) {
        this.processedSeconds = Math.max(this.processedSeconds, seconds);
        shouldEmit = true;
      }
    } else if (key === 'speed') {
      const ratio = Number(value.replace(/x$/i, ''));
      this.speedRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : null;
    } else if (key === 'fps') {
      const fps = Number(value);
      this.fps = Number.isFinite(fps) && fps > 0 ? fps : null;
    } else if (line === 'progress=end') {
      this.processedSeconds = Math.max(this.processedSeconds, this.totalSeconds);
      shouldEmit = true;
      finished = true;
    }

    if (!shouldEmit) return null;

    const safeTotal = Number.isFinite(this.totalSeconds) ? Math.max(0, this.totalSeconds) : 0;
    const percent = finished
      ? 100
      : safeTotal > 0
        ? Math.max(0, Math.min(100, (this.processedSeconds / safeTotal) * 100))
        : 0;
    const remainingMediaSeconds = Math.max(0, safeTotal - this.processedSeconds);
    const etaSeconds = finished
      ? 0
      : this.speedRatio
        ? Math.ceil(remainingMediaSeconds / this.speedRatio)
        : null;
    const speedParts = [
      this.speedRatio ? `${compactDecimal(this.speedRatio)}x` : null,
      this.fps ? `${Math.round(this.fps)} fps` : null
    ].filter((item): item is string => Boolean(item));

    return {
      percent,
      processedSeconds: Number.isFinite(this.processedSeconds)
        ? Math.min(this.processedSeconds, safeTotal || this.processedSeconds)
        : 0,
      totalSeconds: safeTotal,
      speed: speedParts.length ? speedParts.join(' · ') : null,
      speedRatio: this.speedRatio,
      fps: this.fps,
      etaSeconds,
      elapsedSeconds: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
      finished
    };
  }
}
