/**
 * Đề xuất A (người dùng duyệt 2026-10-24): tự tận dụng phần còn trống khi tải — áp dụng chung mọi máy, không theo máy dev.
 *
 * Đo thật (đề xuất C): 1 danh sách chạy chỉ 2 video (số luồng cố định của hồ sơ) + 2 mảnh/video → mạng ~100–125 Mbit/s trong
 * khi đường mạng chịu ≥530 và ổ lưu (HDD) chỉ bận 10–25%. Nên:
 *   1. Ít danh sách chạy → mỗi danh sách được chạy thêm video, tối đa phần chia đều của trần tổng theo máy
 *      (automaticGlobalDownloadCap); trần YouTube 6 và cổng chờ 429 vẫn áp dụng như cũ.
 *   2. Ít video đang tải → mỗi video mới được thêm mảnh, chia từ một "ngân sách kết nối" theo máy (trần tổng × số mảnh gốc).
 *   3. Không tăng một lần: bắt đầu đúng mức cũ (bậc 0) rồi tăng dần từng bậc; bậc vừa tăng mà tổng tốc độ không tăng rõ,
 *      ổ đang lưu bận liên tục, hoặc nền tảng trả 429/403 → lùi lại. Máy yếu (trần tổng nhỏ) gần như không có gì để tăng;
 *      mạng chậm → tăng không ăn thua → tự lùi; ổ chậm/ổ ngoài → bận → tự lùi.
 */

/** Số bậc tăng thêm. Bậc 0 = đúng như trước khi có đề xuất A. */
export const ADAPTIVE_MAX_LEVEL = 4;
/** Mỗi lượt đánh giá dùng số đo của chừng này thời gian (video mới cần ~10 s lấy thông tin rồi mới tải). */
export const ADAPTIVE_WINDOW_MS = 30_000;
/** Bậc vừa tăng phải làm tổng tốc độ tăng ít nhất chừng này mới giữ. */
export const ADAPTIVE_MIN_GAIN = 1.05;
/** Ổ đang lưu bận trung bình từ mức này trong một lượt → coi là ổ nghẽn. */
export const ADAPTIVE_DISK_BUSY_PERCENT = 85;
/** Sau khi lùi vì không tăng được / ổ bận: chờ chừng này mới thử tăng lại quá mức đã chạm. */
export const ADAPTIVE_CEILING_RESET_MS = 5 * 60_000;
/** Sau 429/403: không tăng lại trong chừng này. */
export const ADAPTIVE_THROTTLE_COOLDOWN_MS = 5 * 60_000;
/** Không còn video nào tải chừng này → về bậc 0 (lượt tải sau bắt đầu thận trọng lại). */
export const ADAPTIVE_IDLE_RESET_MS = 2 * 60_000;

export interface AdaptiveSample {
  at: number;
  /** Tổng tốc độ tải của mọi video đang tải (byte/giây). */
  bytesPerSecond: number;
  /** Số video đang tải. */
  activeDownloads: number;
  /** Còn video chờ có thể bắt đầu — không còn thì tăng bậc cũng chẳng để làm gì. */
  demand: boolean;
  /** Độ bận cao nhất (%) trong các ổ mà video đang ghi; null = không đo được (máy không phải Windows, ổ mạng…). */
  diskBusyPercent: number | null;
}

export type AdaptiveReason = 'probe' | 'no_gain' | 'disk_busy' | 'throttled' | 'idle_reset';

export interface AdaptiveDecision {
  level: number;
  previousLevel: number;
  reason: AdaptiveReason;
  bytesPerSecond: number;
  diskBusyPercent: number | null;
}

export class AdaptiveDownloadController {
  private levelValue = 0;
  private ceiling = ADAPTIVE_MAX_LEVEL;
  private ceilingResetAt = 0;
  private cooldownUntil = 0;
  private lastAction: 'up' | 'down' | 'hold' = 'hold';
  private previousThroughput: number | null = null;
  private windowStart: number | null = null;
  private samples: AdaptiveSample[] = [];
  private lastActiveAt: number | null = null;
  private throttledInWindow = false;

  public get level(): number {
    return this.levelValue;
  }

  /** Nền tảng vừa trả 429/403 cho một video: lùi ngay 2 bậc và không tăng lại một lúc. */
  public noteThrottled(now: number): AdaptiveDecision | null {
    this.throttledInWindow = true;
    this.cooldownUntil = now + ADAPTIVE_THROTTLE_COOLDOWN_MS;
    if (this.levelValue === 0) return null;
    return this.move(Math.max(0, this.levelValue - 2), 'throttled', 0, null, true);
  }

  /** Ghi một lần đo; đủ một lượt (ADAPTIVE_WINDOW_MS) thì quyết định tăng/giữ/lùi. Trả quyết định khi bậc đổi. */
  public observe(sample: AdaptiveSample): AdaptiveDecision | null {
    const now = sample.at;
    // Đã lâu không có video nào tải (kể cả khi lượt tải mới vừa bắt đầu ngay trước lần đo này) → về bậc 0.
    let reset: AdaptiveDecision | null = null;
    if (this.lastActiveAt !== null && now - this.lastActiveAt >= ADAPTIVE_IDLE_RESET_MS) {
      this.lastActiveAt = null;
      this.previousThroughput = null;
      this.ceiling = ADAPTIVE_MAX_LEVEL;
      this.ceilingResetAt = 0;
      if (this.levelValue > 0) reset = this.move(0, 'idle_reset', 0, null, false);
      this.lastAction = 'hold';
    }
    if (sample.activeDownloads <= 0) {
      this.windowStart = null;
      this.samples = [];
      return reset;
    }
    this.lastActiveAt = now;
    if (reset) {
      this.windowStart = now;
      this.samples = [sample];
      return reset;
    }
    if (this.windowStart === null) this.windowStart = now;
    this.samples.push(sample);
    if (now - this.windowStart < ADAPTIVE_WINDOW_MS) return null;

    const window = this.samples;
    this.samples = [];
    this.windowStart = now;
    const throttled = this.throttledInWindow;
    this.throttledInWindow = false;
    if (this.ceilingResetAt && now >= this.ceilingResetAt) {
      this.ceiling = ADAPTIVE_MAX_LEVEL;
      this.ceilingResetAt = 0;
    }
    const throughput = average(window.map((item) => Math.max(0, item.bytesPerSecond)));
    const busyValues = window.map((item) => item.diskBusyPercent).filter((value): value is number => value !== null);
    const diskBusy = busyValues.length ? average(busyValues) : null;
    const demand = window.some((item) => item.demand);
    const previous = this.previousThroughput;
    this.previousThroughput = throughput;

    if (throttled) {
      this.lastAction = 'hold';
      return null; // đã lùi ngay lúc noteThrottled
    }
    if (diskBusy !== null && diskBusy >= ADAPTIVE_DISK_BUSY_PERCENT) {
      if (this.levelValue === 0) return null;
      this.ceiling = this.levelValue - 1;
      this.ceilingResetAt = now + ADAPTIVE_CEILING_RESET_MS;
      return this.move(this.levelValue - 1, 'disk_busy', throughput, diskBusy, true);
    }
    if (this.lastAction === 'up' && previous !== null && throughput < previous * ADAPTIVE_MIN_GAIN) {
      this.ceiling = this.levelValue - 1;
      this.ceilingResetAt = now + ADAPTIVE_CEILING_RESET_MS;
      return this.move(this.levelValue - 1, 'no_gain', throughput, diskBusy, true);
    }
    if (demand && now >= this.cooldownUntil && this.levelValue < Math.min(this.ceiling, ADAPTIVE_MAX_LEVEL)) {
      return this.move(this.levelValue + 1, 'probe', throughput, diskBusy, false);
    }
    this.lastAction = 'hold';
    return null;
  }

  private move(
    next: number,
    reason: AdaptiveReason,
    bytesPerSecond: number,
    diskBusyPercent: number | null,
    down: boolean
  ): AdaptiveDecision {
    const previousLevel = this.levelValue;
    this.levelValue = Math.max(0, Math.min(ADAPTIVE_MAX_LEVEL, next));
    this.lastAction = down ? 'down' : next > previousLevel ? 'up' : 'hold';
    return { level: this.levelValue, previousLevel, reason, bytesPerSecond, diskBusyPercent };
  }
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** Nội suy từ mức gốc tới mức tối đa theo bậc (bậc 0 = gốc, bậc tối đa = tối đa). */
function stepTowards(base: number, target: number, level: number): number {
  if (target <= base) return base;
  const clamped = Math.max(0, Math.min(ADAPTIVE_MAX_LEVEL, Math.trunc(level)));
  return base + Math.round(((target - base) * clamped) / ADAPTIVE_MAX_LEVEL);
}

/**
 * Số video một danh sách được chạy cùng lúc. Gốc = số luồng của hồ sơ (như trước); tối đa = phần chia đều của trần tổng
 * theo máy cho các danh sách đang có việc. Không bao giờ thấp hơn gốc.
 */
export function adaptivePerListLimit(baseWorkers: number, globalCap: number, listsWithWork: number, level: number): number {
  const base = Math.max(1, Math.min(16, Math.round(baseWorkers || 1)));
  const share = Math.floor(Math.max(1, globalCap) / Math.max(1, listsWithWork));
  return stepTowards(base, Math.min(16, share), level);
}

/** Ngân sách kết nối của máy = trần tổng video theo máy × số mảnh gốc theo máy. */
export function adaptiveConnectionBudget(globalCap: number, baseFragments: number): number {
  return Math.max(1, Math.trunc(globalCap)) * Math.max(1, Math.trunc(baseFragments));
}

/**
 * Số mảnh cho video SẮP bắt đầu: gốc theo máy; tối đa = ngân sách kết nối chia cho số video sẽ cùng tải (tính cả video này),
 * không quá 8 (trần cũ của app).
 */
export function adaptiveFragments(baseFragments: number, connectionBudget: number, downloadsIncludingThis: number, level: number): number {
  const base = Math.max(1, Math.min(8, Math.trunc(baseFragments)));
  const target = Math.min(8, Math.floor(Math.max(1, connectionBudget) / Math.max(1, downloadsIncludingThis)));
  return stepTowards(base, target, level);
}

/** Tốc độ yt-dlp in ra ("5.23MiB/s", "812.4KiB/s", "1.1GiB/s", "900B/s") → byte/giây; không đọc được → 0. */
export function parseSpeedBytesPerSecond(text: string | null | undefined): number {
  const match = /^\s*([\d.]+)\s*([KMGT]?i?B)\/s\s*$/i.exec(text ?? '');
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2]!.toUpperCase();
  const power = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit] ?? 0;
  const base = unit.includes('I') ? 1024 : 1000;
  return value * base ** power;
}

/** Ký tự ổ của một thư mục Windows ("E:\\Video" → "E"); đường dẫn mạng / không có ký tự ổ → null (không đo được). */
export function driveLetterOf(folder: string | null | undefined): string | null {
  const match = /^([A-Za-z]):[\\/]?/.exec(folder ?? '');
  return match ? match[1]!.toUpperCase() : null;
}
