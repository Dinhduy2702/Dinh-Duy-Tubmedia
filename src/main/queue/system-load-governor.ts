/**
 * VẤN ĐỀ 2 mục 1 (2026-09-22): bộ điều tiết tải theo CPU HỆ THỐNG (không chỉ của app) đã đo sẵn trong
 * queue-manager.ts. Chỉ ảnh hưởng tới việc CÓ CHO TÁC VỤ MỚI BẮT ĐẦU hay không ở lượt kiểm tiếp theo —
 * KHÔNG BAO GIỜ hủy hay tạm dừng tác vụ đang chạy dở.
 *
 * Có độ trễ (hysteresis) hai chiều để tránh "nhấp nháy" bật/tắt liên tục khi CPU dao động quanh một
 * ngưỡng duy nhất: phải ở TRÊN ngưỡng cao liên tục đủ lâu mới bắt đầu giảm tải, và phải ở DƯỚI ngưỡng
 * thấp hơn (khác ngưỡng cao) liên tục đủ lâu mới cho tăng lại — giữa hai ngưỡng là "vùng đệm" không tính
 * dồn thời gian cho chiều nào cả, tránh dao động ngay tại biên.
 */
export interface SystemLoadGovernorOptions {
  /** % CPU hệ thống — ở mức này liên tục đủ lâu thì bắt đầu giảm tải. */
  highPercent: number;
  /** % CPU hệ thống — phải THẤP hơn highPercent; ở mức này liên tục đủ lâu thì cho tăng tải lại. */
  lowPercent: number;
  /** Thời gian (ms) phải giữ liên tục ở một phía trước khi đổi trạng thái. */
  sustainedMs: number;
}

export class SystemLoadGovernor {
  private throttled = false;
  private aboveSince: number | null = null;
  private belowSince: number | null = null;

  public constructor(private readonly options: SystemLoadGovernorOptions) {}

  /** Đưa vào một lần đo CPU mới (0-100) và thời điểm đo (Date.now() thật, hoặc thời điểm giả lập khi test). */
  public sample(cpuPercent: number, now: number): boolean {
    const { highPercent, lowPercent, sustainedMs } = this.options;
    if (cpuPercent >= highPercent) {
      this.belowSince = null;
      if (this.aboveSince === null) this.aboveSince = now;
      if (!this.throttled && now - this.aboveSince >= sustainedMs) this.throttled = true;
    } else if (cpuPercent <= lowPercent) {
      this.aboveSince = null;
      if (this.belowSince === null) this.belowSince = now;
      if (this.throttled && now - this.belowSince >= sustainedMs) this.throttled = false;
    } else {
      // Vùng đệm giữa hai ngưỡng: không tính dồn thời gian cho chiều nào — tránh dao động ở biên.
      this.aboveSince = null;
      this.belowSince = null;
    }
    return this.throttled;
  }

  public isThrottled(): boolean {
    return this.throttled;
  }
}

/** Ngưỡng thấp mặc định cách ngưỡng cao (cpuSoftLimitPercent của hồ sơ) một khoảng an toàn, không dưới 40%. */
export function defaultLowPercentFor(highPercent: number): number {
  return Math.max(40, highPercent - 25);
}

/** Vài giây liên tục đúng theo yêu cầu — đủ để lọc dao động tức thời, không quá chậm để phản hồi thật. */
export const DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS = 5_000;
