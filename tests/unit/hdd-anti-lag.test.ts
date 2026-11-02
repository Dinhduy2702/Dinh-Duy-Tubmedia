import { describe, expect, it } from 'vitest';
import {
  ADAPTIVE_CEILING_RESET_MAX_MS,
  ADAPTIVE_CEILING_RESET_MS,
  ADAPTIVE_WINDOW_MS,
  AdaptiveDownloadController,
  type AdaptiveSample
} from '../../src/shared/utils/adaptive-download.js';
import {
  ConcurrencyGate,
  diskBusyThresholdForDrives,
  diskBusyThresholdPercent,
  editEncodeConcurrency
} from '../../src/shared/utils/disk-load.js';

// 2026-11-02 (người dùng duyệt): máy lag khi Tubmedia tải vào ổ HDD — ổ E: (HDD) bận liên tục, bộ tự tăng tốc cứ ~5 phút lại
// thử tăng lên 4/4 (mỗi lần máy khựng), và nhiều bản dựng CapCut mã hoá cùng lúc trên cùng ổ. Mọi ngưỡng tự dò theo máy đang
// chạy: loại ổ thật của ổ đang ghi (Get-PhysicalDisk) + độ bận đo thật + số nhân CPU — không theo máy dev.

const sample = (at: number, busy: number | null, threshold?: number): AdaptiveSample => ({
  at,
  bytesPerSecond: 10_000_000,
  activeDownloads: 2,
  demand: true,
  diskBusyPercent: busy,
  ...(threshold === undefined ? {} : { diskBusyThresholdPercent: threshold })
});

/** Đưa đủ một lượt đánh giá (mỗi 5 s một số đo) và trả quyết định cuối lượt. */
function feedWindow(controller: AdaptiveDownloadController, start: number, busy: number | null, threshold?: number) {
  let decision = null;
  for (let t = start; t <= start + ADAPTIVE_WINDOW_MS; t += 5_000) decision = controller.observe(sample(t, busy, threshold)) ?? decision;
  return { decision, end: start + ADAPTIVE_WINDOW_MS };
}

describe('ngưỡng "ổ bận" theo loại ổ thật', () => {
  it('HDD chậm đi rõ ở độ bận thấp hơn SSD → ngưỡng HDD thấp hơn; ổ không rõ loại giữ ngưỡng cũ', () => {
    expect(diskBusyThresholdPercent('hdd')).toBeLessThan(diskBusyThresholdPercent('ssd'));
    expect(diskBusyThresholdPercent('ssd')).toBe(85);
    expect(diskBusyThresholdPercent('unknown')).toBe(85);
  });

  it('nhiều ổ đang nhận video → dùng ngưỡng khắt khe nhất (ổ chậm nhất quyết định)', () => {
    const types: Record<string, 'hdd' | 'ssd' | 'unknown'> = { C: 'ssd', E: 'hdd' };
    expect(diskBusyThresholdForDrives(['C', 'E'], (letter) => types[letter] ?? 'unknown')).toBe(diskBusyThresholdPercent('hdd'));
    expect(diskBusyThresholdForDrives(['C'], (letter) => types[letter] ?? 'unknown')).toBe(85);
    expect(diskBusyThresholdForDrives([], () => 'hdd')).toBe(85);
  });

  it('ổ HDD bận 70% → lùi; cùng mức bận trên SSD → không lùi', () => {
    const hdd = new AdaptiveDownloadController();
    let t = 0;
    ({ end: t } = feedWindow(hdd, t, 20, diskBusyThresholdPercent('hdd'))); // bậc 0 → 1
    expect(hdd.level).toBe(1);
    const busyHdd = feedWindow(hdd, t + 5_000, 70, diskBusyThresholdPercent('hdd'));
    expect(busyHdd.decision?.reason).toBe('disk_busy');

    const ssd = new AdaptiveDownloadController();
    t = 0;
    ({ end: t } = feedWindow(ssd, t, 20, diskBusyThresholdPercent('ssd')));
    const busySsd = feedWindow(ssd, t + 5_000, 70, diskBusyThresholdPercent('ssd'));
    expect(busySsd.decision?.reason).not.toBe('disk_busy');
  });
});

describe('ổ cứ bận lại → giãn dần thời gian chờ trước khi thử tăng lại (không khựng máy mỗi 5 phút)', () => {
  /**
   * Mô phỏng liên tục (mỗi 5 s một số đo, như máy thật): ổ chỉ bận khi đang ở bậc ≥ 1 — đúng ca HDD thật (bậc 0 ổn, tăng là
   * nghẽn). Trả các thời điểm bộ điều khiển thử tăng.
   */
  const simulate = (controller: AdaptiveDownloadController, start: number, durationMs: number): number[] => {
    const probes: number[] = [];
    for (let t = start; t < start + durationMs; t += 5_000) {
      const decision = controller.observe(sample(t, controller.level >= 1 ? 95 : 10));
      if (decision?.reason === 'probe') probes.push(t);
    }
    return probes;
  };

  it('ổ cứ bận mỗi lần tăng → khoảng cách giữa các lần thử tăng dần gấp đôi, tối đa 60 phút', () => {
    const probes = simulate(new AdaptiveDownloadController(), 0, 4 * 60 * 60_000);
    const gaps = probes.slice(1).map((at, index) => at - probes[index]!);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    for (let index = 1; index < gaps.length; index += 1) expect(gaps[index]!).toBeGreaterThanOrEqual(gaps[index - 1]!);
    expect(gaps[1]!).toBeGreaterThan(gaps[0]! * 1.5);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(ADAPTIVE_CEILING_RESET_MAX_MS + 2 * ADAPTIVE_WINDOW_MS);
    // Trước bản sửa: thử lại đều đặn mỗi ~5 phút → 4 giờ có ~45 lần khựng; giờ chỉ vài lần.
    expect(probes.length).toBeLessThan(12);
  });

  it('nghỉ tải đủ lâu (về bậc 0) → lượt tải sau bắt đầu lại thời gian chờ ngắn', () => {
    const controller = new AdaptiveDownloadController();
    simulate(controller, 0, 2 * 60 * 60_000);
    const pauseEnd = 2 * 60 * 60_000 + 10 * 60_000;
    controller.observe({ ...sample(pauseEnd, null), activeDownloads: 0 });
    const probes = simulate(controller, pauseEnd + 5_000, 30 * 60_000);
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(probes[1]! - probes[0]!).toBeLessThanOrEqual(ADAPTIVE_CEILING_RESET_MS + 2 * ADAPTIVE_WINDOW_MS);
  });
});

describe('số bản dựng CapCut mã hoá cùng lúc theo máy', () => {
  it('ổ HDD hoặc ổ không rõ loại (ổ USB thường báo không rõ) → mỗi lúc 1 bản', () => {
    expect(editEncodeConcurrency('hdd', 72)).toBe(1);
    expect(editEncodeConcurrency('unknown', 72)).toBe(1);
  });

  it('SSD → theo số nhân CPU (máy yếu 1, máy nhiều nhân nhiều hơn, có trần)', () => {
    expect(editEncodeConcurrency('ssd', 4)).toBe(1);
    expect(editEncodeConcurrency('ssd', 8)).toBe(1);
    expect(editEncodeConcurrency('ssd', 32)).toBe(2);
    expect(editEncodeConcurrency('ssd', 72)).toBe(4);
    expect(editEncodeConcurrency('ssd', 256)).toBe(4);
  });
});

describe('ConcurrencyGate — xếp lượt theo giới hạn đổi được', () => {
  it('giới hạn 1 → việc thứ hai chờ việc đầu xong', async () => {
    const gate = new ConcurrencyGate();
    const order: string[] = [];
    const first = await gate.acquire('E', 1);
    const secondPromise = gate.acquire('E', 1).then((release) => {
      order.push('hai bắt đầu');
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);
    order.push('một xong');
    first();
    const second = await secondPromise;
    expect(order).toEqual(['một xong', 'hai bắt đầu']);
    second();
  });

  it('khác ổ thì không chờ nhau; hủy lúc đang chờ thì rời hàng', async () => {
    const gate = new ConcurrencyGate();
    const onE = await gate.acquire('E', 1);
    const onC = await Promise.race([gate.acquire('C', 1), new Promise<null>((resolve) => setTimeout(() => resolve(null), 50))]);
    expect(onC, 'ổ C không phải chờ ổ E').not.toBeNull();
    const controller = new AbortController();
    const waiting = gate.acquire('E', 1, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow();
    onE();
    const next = await gate.acquire('E', 1);
    next();
    onC?.();
  });
});
