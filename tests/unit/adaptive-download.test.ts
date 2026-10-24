import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_CEILING_RESET_MS,
  ADAPTIVE_IDLE_RESET_MS,
  ADAPTIVE_MAX_LEVEL,
  ADAPTIVE_THROTTLE_COOLDOWN_MS,
  ADAPTIVE_WINDOW_MS,
  AdaptiveDownloadController,
  adaptiveConnectionBudget,
  adaptiveFragments,
  adaptivePerListLimit,
  driveLetterOf,
  parseSpeedBytesPerSecond,
  type AdaptiveSample
} from '../../src/shared/utils/adaptive-download.js';
import { parseDiskBusyLine, DiskBusyMonitor } from '../../src/main/queue/disk-busy-monitor.js';

// Đề xuất A (người dùng duyệt 2026-10-24): tự tận dụng phần trống, tự lùi theo tốc độ thật / độ bận ổ / 429-403 — chung mọi máy.
const MB = 1024 * 1024;

/** Cho bộ điều khiển một lượt đo (đủ ADAPTIVE_WINDOW_MS) với tốc độ / độ bận ổ cho trước; trả quyết định cuối lượt. */
function runWindow(
  controller: AdaptiveDownloadController,
  start: number,
  patch: Partial<AdaptiveSample> = {}
): { decision: ReturnType<AdaptiveDownloadController['observe']>; end: number } {
  // Đo mỗi 5 s như hàng đợi thật; dừng ngay sau quyết định đầu tiên để mỗi lần gọi ứng đúng một lượt đo.
  let decision: ReturnType<AdaptiveDownloadController['observe']> = null;
  let at = start;
  for (; at <= start + ADAPTIVE_WINDOW_MS && !decision; at += 5_000) {
    decision = controller.observe({
      at,
      bytesPerSecond: 10 * MB,
      activeDownloads: 2,
      demand: true,
      diskBusyPercent: 20,
      ...patch
    });
  }
  return { decision, end: at };
}

describe('bộ tự tận dụng phần trống — tăng dần, tự lùi', () => {
  it('bắt đầu ở bậc 0 (đúng như cũ); mỗi lượt đo còn video chờ thì thử tăng một bậc', () => {
    const controller = new AdaptiveDownloadController();
    expect(controller.level).toBe(0);
    const first = runWindow(controller, 0);
    expect(first.decision).toMatchObject({ level: 1, reason: 'probe' });
  });

  it('bậc vừa tăng mà tổng tốc độ không tăng rõ (mạng chậm / nền tảng giới hạn) → lùi lại và không thử lại ngay', () => {
    const controller = new AdaptiveDownloadController();
    let t = runWindow(controller, 0, { bytesPerSecond: 10 * MB }).end; // → bậc 1
    const second = runWindow(controller, t, { bytesPerSecond: 15 * MB }); // tăng rõ → bậc 2
    expect(second.decision).toMatchObject({ level: 2, reason: 'probe' });
    t = second.end;
    const flat = runWindow(controller, t, { bytesPerSecond: 15.2 * MB }); // không tăng → lùi
    expect(flat.decision).toMatchObject({ level: 1, reason: 'no_gain' });
    t = flat.end;
    const after = runWindow(controller, t, { bytesPerSecond: 15 * MB });
    expect(after.decision, 'đã chạm trần vừa thử — giữ, không tăng lại ngay').toBeNull();
    expect(controller.level).toBe(1);
  });

  it('sau ADAPTIVE_CEILING_RESET_MS mới thử vượt mức đã chạm (mạng có thể đã rảnh hơn)', () => {
    const controller = new AdaptiveDownloadController();
    let t = runWindow(controller, 0).end;
    t = runWindow(controller, t, { bytesPerSecond: 20 * MB }).end;
    const backedOffAt = t;
    t = runWindow(controller, t, { bytesPerSecond: 20 * MB }).end; // không tăng → lùi về 1
    expect(controller.level).toBe(1);
    // Vẫn đang tải liên tục: mỗi lượt đo giữ bậc 1 cho tới khi hết ADAPTIVE_CEILING_RESET_MS mới thử bậc 2.
    let probedAt: number | null = null;
    while (probedAt === null && t < backedOffAt + 3 * ADAPTIVE_CEILING_RESET_MS) {
      const result = runWindow(controller, t, { bytesPerSecond: 20 * MB });
      if (result.decision?.reason === 'probe') probedAt = t;
      t = result.end;
    }
    expect(probedAt).not.toBeNull();
    expect(probedAt! - backedOffAt).toBeGreaterThanOrEqual(ADAPTIVE_CEILING_RESET_MS - ADAPTIVE_WINDOW_MS * 2);
    expect(controller.level).toBe(2);
  });

  it('ổ đang lưu bận liên tục (bất kể loại ổ) → lùi một bậc', () => {
    const controller = new AdaptiveDownloadController();
    let t = runWindow(controller, 0, { bytesPerSecond: 10 * MB }).end;
    t = runWindow(controller, t, { bytesPerSecond: 20 * MB }).end;
    expect(controller.level).toBe(2);
    const busy = runWindow(controller, t, { bytesPerSecond: 30 * MB, diskBusyPercent: 100 });
    expect(busy.decision).toMatchObject({ level: 1, reason: 'disk_busy' });
    expect(busy.decision!.diskBusyPercent).toBeGreaterThanOrEqual(85);
  });

  it('không đo được ổ (ổ mạng, ngoài Windows) → vẫn chạy theo tốc độ thật', () => {
    const controller = new AdaptiveDownloadController();
    const result = runWindow(controller, 0, { diskBusyPercent: null });
    expect(result.decision).toMatchObject({ level: 1, reason: 'probe', diskBusyPercent: null });
  });

  it('nền tảng trả 429/403 → lùi ngay 2 bậc và không tăng lại trong ADAPTIVE_THROTTLE_COOLDOWN_MS', () => {
    const controller = new AdaptiveDownloadController();
    let t = 0;
    for (let i = 0; i < 3; i += 1) t = runWindow(controller, t, { bytesPerSecond: (10 + i * 10) * MB }).end;
    expect(controller.level).toBe(3);
    const throttledAt = t;
    expect(controller.noteThrottled(t)).toMatchObject({ level: 1, reason: 'throttled' });
    // Vẫn tải liên tục, tốc độ tăng đều: trong thời gian chờ không tăng; hết thời gian chờ mới thử lại.
    let probedAt: number | null = null;
    let speed = 50;
    while (probedAt === null && t < throttledAt + 3 * ADAPTIVE_THROTTLE_COOLDOWN_MS) {
      const result = runWindow(controller, t, { bytesPerSecond: speed * MB });
      if (result.decision?.reason === 'probe') probedAt = t;
      else expect(controller.level, 'đang trong thời gian chờ — không tăng').toBe(1);
      t = result.end;
      speed += 10;
    }
    expect(probedAt! - throttledAt).toBeGreaterThanOrEqual(ADAPTIVE_THROTTLE_COOLDOWN_MS - ADAPTIVE_WINDOW_MS * 2);
    expect(controller.level).toBe(2);
  });

  it('không còn video chờ → giữ nguyên (tăng cũng chẳng để làm gì)', () => {
    const controller = new AdaptiveDownloadController();
    expect(runWindow(controller, 0, { demand: false }).decision).toBeNull();
    expect(controller.level).toBe(0);
  });

  it('không vượt bậc tối đa', () => {
    const controller = new AdaptiveDownloadController();
    let t = 0;
    for (let i = 0; i < ADAPTIVE_MAX_LEVEL + 3; i += 1) t = runWindow(controller, t, { bytesPerSecond: 10 * MB * 2 ** i }).end;
    expect(controller.level).toBe(ADAPTIVE_MAX_LEVEL);
  });

  it('hết video tải đủ lâu → lượt tải sau bắt đầu lại từ bậc 0, kể cả khi video mới đã chạy trước lần đo', () => {
    const controller = new AdaptiveDownloadController();
    let t = runWindow(controller, 0, { bytesPerSecond: 10 * MB }).end;
    t = runWindow(controller, t, { bytesPerSecond: 20 * MB }).end;
    expect(controller.level).toBe(2);
    const reset = controller.observe({
      at: t + ADAPTIVE_IDLE_RESET_MS,
      bytesPerSecond: 0,
      activeDownloads: 3,
      demand: true,
      diskBusyPercent: null
    });
    expect(reset).toMatchObject({ level: 0, reason: 'idle_reset' });
  });
});

describe('số video mỗi danh sách và số mảnh mỗi video theo bậc', () => {
  it('bậc 0 = số luồng của hồ sơ; tối đa = phần chia đều trần tổng; không bao giờ thấp hơn hồ sơ', () => {
    expect(adaptivePerListLimit(2, 12, 1, 0)).toBe(2);
    expect(adaptivePerListLimit(2, 12, 1, 2)).toBe(7);
    expect(adaptivePerListLimit(2, 12, 1, ADAPTIVE_MAX_LEVEL)).toBe(12);
    expect(adaptivePerListLimit(2, 12, 3, ADAPTIVE_MAX_LEVEL)).toBe(4);
    expect(adaptivePerListLimit(4, 6, 3, ADAPTIVE_MAX_LEVEL), 'phần chia (2) nhỏ hơn hồ sơ → giữ hồ sơ').toBe(4);
    expect(adaptivePerListLimit(1, 2, 1, ADAPTIVE_MAX_LEVEL), 'máy yếu: trần tổng 2').toBe(2);
  });

  it('ngân sách kết nối theo máy; video càng ít càng được nhiều mảnh, tối đa 8', () => {
    expect(adaptiveConnectionBudget(12, 2)).toBe(24);
    expect(adaptiveConnectionBudget(2, 1)).toBe(2);
    expect(adaptiveFragments(2, 24, 1, 0)).toBe(2);
    expect(adaptiveFragments(2, 24, 1, ADAPTIVE_MAX_LEVEL)).toBe(8);
    expect(adaptiveFragments(2, 24, 6, ADAPTIVE_MAX_LEVEL)).toBe(4);
    expect(adaptiveFragments(2, 24, 12, ADAPTIVE_MAX_LEVEL)).toBe(2);
    expect(adaptiveFragments(1, 2, 1, ADAPTIVE_MAX_LEVEL), 'máy yếu: ngân sách 2').toBe(2);
    expect(adaptiveFragments(1, 2, 2, ADAPTIVE_MAX_LEVEL)).toBe(1);
  });
});

describe('đọc số đo', () => {
  it('tốc độ yt-dlp → byte/giây', () => {
    expect(parseSpeedBytesPerSecond('5.00MiB/s')).toBe(5 * MB);
    expect(parseSpeedBytesPerSecond(' 512.00KiB/s')).toBe(512 * 1024);
    expect(parseSpeedBytesPerSecond('1.5GiB/s')).toBe(1.5 * 1024 ** 3);
    expect(parseSpeedBytesPerSecond('900B/s')).toBe(900);
    expect(parseSpeedBytesPerSecond('2MB/s')).toBe(2_000_000);
    expect(parseSpeedBytesPerSecond(null)).toBe(0);
    expect(parseSpeedBytesPerSecond('Unknown')).toBe(0);
  });

  it('ký tự ổ của thư mục — mọi ổ như nhau; đường dẫn mạng → không đo được', () => {
    expect(driveLetterOf('E:\\DinhDuy')).toBe('E');
    expect(driveLetterOf('d:/Video')).toBe('D');
    expect(driveLetterOf('C:\\')).toBe('C');
    expect(driveLetterOf('\\\\may-chu\\chia-se\\video')).toBeNull();
    expect(driveLetterOf('')).toBeNull();
  });

  it('độ bận ổ từ WMI: theo ký tự ổ, một ổ vật lý nhiều phân vùng, bỏ ổ không có ký tự', () => {
    const busy = parseDiskBusyLine(
      '[{"Name":"0 E:","PercentIdleTime":12},{"Name":"1 C: D:","PercentIdleTime":100},{"Name":"2","PercentIdleTime":0}]'
    );
    expect([...busy]).toEqual([
      ['E', 88],
      ['C', 0],
      ['D', 0]
    ]);
    expect([...parseDiskBusyLine('{"Name":"0 F:","PercentIdleTime":140}')]).toEqual([['F', 0]]);
    expect(parseDiskBusyLine('không phải JSON').size).toBe(0);
  });

  it('độ bận cao nhất trong các ổ đang ghi; số đo cũ hoặc ổ không đo được → null', () => {
    const monitor = new DiskBusyMonitor(false);
    expect(monitor.busiestOf(['E'], 1_000)).toBeNull();
    monitor.accept('[{"Name":"0 E:","PercentIdleTime":10},{"Name":"1 C:","PercentIdleTime":95}]', 1_000);
    expect(monitor.busiestOf(['C', 'E'], 2_000)).toBe(90);
    expect(monitor.busiestOf(['C'], 2_000)).toBe(5);
    expect(monitor.busiestOf(['Z'], 2_000)).toBeNull();
    expect(monitor.busiestOf(['E'], 60_000), 'số đo đã cũ').toBeNull();
  });
});
