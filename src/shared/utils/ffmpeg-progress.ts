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
