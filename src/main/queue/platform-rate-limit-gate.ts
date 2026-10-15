import {
  RATE_LIMIT_RAMP_CLEAR_AT,
  nextRateLimitStrikes,
  rateLimitPlatformLabel,
  rateLimitWaitMs
} from '../../shared/utils/rate-limit-backoff.js';
import type { RateLimitWaitState } from '../../shared/types/domain.js';

export type RateLimitHitOutcome =
  | { kind: 'cooldown'; strikes: number; resumeAt: number }
  | { kind: 'stopped'; strikes: number }
  /** Video đã chạy từ trước lúc bắt đầu nghỉ (hoặc đang nghỉ/đã dừng): không tính thêm lần, không đổi thời gian chờ. */
  | { kind: 'ignored' };

interface PlatformState {
  strikes: number;
  lastHitAt: number;
  resumeAt: number | null;
  stopped: boolean;
  /** null = không giới hạn tạm; số = tối đa bấy nhiêu video của nền tảng chạy cùng lúc (sau khi tự tiếp tục). */
  rampLimit: number | null;
}

/**
 * Trạng thái nghỉ vì 429 theo NỀN TẢNG trên toàn ứng dụng (hướng B). Chỉ giữ trong bộ nhớ: mở lại ứng dụng thì bắt đầu lại
 * bình thường (tác vụ dở lúc đóng vẫn đi qua hộp "Có N tác vụ chưa xong" như cũ). Không có bộ hẹn giờ nào — hàng đợi hỏi
 * canStart() ở mỗi lượt tick, nên không có gì phải hủy khi người dùng bấm Tiếp tục hay khi ứng dụng đóng.
 */
export class PlatformRateLimitGate {
  private readonly states = new Map<string, PlatformState>();
  private resumed: string[] = [];

  public constructor(
    private readonly random: () => number = Math.random,
    /** Thời gian chờ thay thế cho mọi vòng — chỉ bài e2e (TUBMEDIA_E2E_RATE_LIMIT_WAIT_MS). */
    private readonly waitOverrideMs?: number
  ) {}

  public hasAny(): boolean {
    return this.states.size > 0;
  }

  /**
   * Một video của nền tảng vừa dính 429.
   * @param jobStartedAt Lúc video đó bắt đầu chạy lượt này — video chạy từ TRƯỚC lần dính gần nhất thì không tính thêm lần.
   */
  public recordHit(platform: string, jobStartedAt: number, now: number): RateLimitHitOutcome {
    const current = this.states.get(platform);
    if (current && (current.stopped || (current.resumeAt !== null && now < current.resumeAt) || jobStartedAt <= current.lastHitAt)) {
      return { kind: 'ignored' };
    }
    const strikes = nextRateLimitStrikes(current?.strikes ?? 0, current?.lastHitAt ?? null, now);
    const wait = rateLimitWaitMs(strikes, this.random, this.waitOverrideMs);
    if (wait === null) {
      this.states.set(platform, { strikes, lastHitAt: now, resumeAt: null, stopped: true, rampLimit: null });
      return { kind: 'stopped', strikes };
    }
    const resumeAt = now + wait;
    this.states.set(platform, { strikes, lastHitAt: now, resumeAt, stopped: false, rampLimit: null });
    return { kind: 'cooldown', strikes, resumeAt };
  }

  /** Được bắt đầu thêm một video của nền tảng không, khi đang có activeOfPlatform video của nó chạy. */
  public canStart(platform: string, activeOfPlatform: number, now: number): boolean {
    const state = this.states.get(platform);
    if (!state) return true;
    if (state.stopped) return false;
    if (state.resumeAt !== null) {
      if (now < state.resumeAt) return false;
      state.resumeAt = null;
      state.rampLimit = 1;
      this.resumed.push(platform);
    }
    return state.rampLimit === null || activeOfPlatform < state.rampLimit;
  }

  /** Các nền tảng vừa hết giờ nghỉ kể từ lần gọi trước (để ghi nhật ký / cập nhật thông báo). */
  public takeResumed(): string[] {
    const resumed = this.resumed;
    this.resumed = [];
    return resumed;
  }

  /** Một video của nền tảng tải xong: nới giới hạn tạm thêm 1; đủ mức thì bỏ hẳn và xóa chuỗi. */
  public recordSuccess(platform: string): void {
    const state = this.states.get(platform);
    if (!state || state.rampLimit === null) return;
    state.rampLimit += 1;
    if (state.rampLimit > RATE_LIMIT_RAMP_CLEAR_AT) this.states.delete(platform);
  }

  /** Số lần dính 429 liên tiếp gần đây của nền tảng (0 = không, hoặc đã tải lại ổn định) — hướng C giãn cách theo số này. */
  public strikesOf(platform: string): number {
    return this.states.get(platform)?.strikes ?? 0;
  }

  public isStopped(platform: string): boolean {
    return this.states.get(platform)?.stopped === true;
  }

  /** Người dùng đã xác minh và bấm Tiếp tục — tải lại bình thường. */
  public clear(platform: string): void {
    this.states.delete(platform);
  }

  public snapshot(now: number): RateLimitWaitState[] {
    return [...this.states.entries()]
      .filter(([, state]) => state.stopped || (state.resumeAt !== null && now < state.resumeAt) || state.rampLimit !== null)
      .map(([platform, state]) => ({
        platform,
        label: rateLimitPlatformLabel(platform),
        resumeAt: state.resumeAt,
        stopped: state.stopped,
        strikes: state.strikes,
        rampLimit: state.rampLimit
      }));
  }
}
