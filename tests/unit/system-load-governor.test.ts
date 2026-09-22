import { describe, expect, it } from 'vitest';
import {
  SystemLoadGovernor,
  defaultLowPercentFor,
  DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS
} from '@main/queue/system-load-governor.js';

// Vấn đề 2 mục 1 (2026-09-22): logic hysteresis THUẦN (không phụ thuộc CPU thật/đồng hồ thật) — đưa thời
// điểm giả lập vào trực tiếp để kiểm tra chính xác từng nhánh, đặc biệt là chống "nhấp nháy" khi CPU dao
// động quanh ngưỡng.
describe('SystemLoadGovernor — chống nhấp nháy bật/tắt khi CPU dao động quanh ngưỡng', () => {
  it('KHÔNG giảm tải nếu CPU cao chưa đủ lâu (dưới sustainedMs)', () => {
    const governor = new SystemLoadGovernor({ highPercent: 85, lowPercent: 60, sustainedMs: 5_000 });
    let now = 0;
    expect(governor.sample(90, now)).toBe(false);
    now += 4_999;
    expect(governor.sample(90, now)).toBe(false);
    expect(governor.isThrottled()).toBe(false);
  });

  it('bắt đầu giảm tải khi CPU ở trên ngưỡng cao LIÊN TỤC đủ sustainedMs', () => {
    const governor = new SystemLoadGovernor({ highPercent: 85, lowPercent: 60, sustainedMs: 5_000 });
    let now = 0;
    governor.sample(90, now);
    now += 5_000;
    expect(governor.sample(90, now)).toBe(true);
    expect(governor.isThrottled()).toBe(true);
  });

  it('một lần CPU tụt xuống VÙNG ĐỆM (giữa 2 ngưỡng) làm reset bộ đếm "đang cao" — không cộng dồn qua lần tụt', () => {
    // Gọi sample() đều đặn mỗi 1s, mô phỏng đúng cách bộ lập lịch gọi thật (mỗi lượt tick).
    const governor = new SystemLoadGovernor({ highPercent: 85, lowPercent: 60, sustainedMs: 5_000 });
    let now = 0;
    governor.sample(90, now); // t=0: bắt đầu đếm cao (aboveSince = 0)
    now += 1_000;
    governor.sample(90, now); // t=1s: vẫn đang đếm (1s < 5s)
    now += 1_000;
    governor.sample(70, now); // t=2s: rơi vào vùng đệm (60 < 70 < 85) → HỦY bộ đếm đã tích lũy (2s)
    now += 1_000;
    governor.sample(90, now); // t=3s: cao trở lại — bộ đếm bắt đầu lại từ t=3s (aboveSince = 3s)
    now += 1_000; // t=4s: mới 1s kể từ khi đếm lại — nếu KHÔNG bị reset ở t=2s thì đã là 4s tích lũy
    expect(governor.sample(90, now)).toBe(false);
    now += 4_000; // t=8s: đủ 5s liên tục kể từ mốc đếm lại (t=3s → t=8s)
    expect(governor.sample(90, now)).toBe(true);
  });

  it('đây chính là kịch bản "nhấp nháy": CPU dao động NHANH quanh ngưỡng cao trong lúc CHƯA giảm tải — không được giảm tải liên tục ngắt quãng', () => {
    const governor = new SystemLoadGovernor({ highPercent: 85, lowPercent: 60, sustainedMs: 5_000 });
    let now = 0;
    // Dao động 84/86 quanh ngưỡng 85 mỗi 500ms trong 4.5s — không lần nào đủ 5s liên tục ở một phía.
    for (let i = 0; i < 9; i += 1) {
      now += 500;
      const cpu = i % 2 === 0 ? 86 : 70; // xen kẽ trên ngưỡng cao / vùng đệm
      expect(governor.sample(cpu, now)).toBe(false);
    }
  });

  it('sau khi đã giảm tải, CPU phải xuống DƯỚI ngưỡng THẤP (không phải ngưỡng cao) liên tục đủ lâu mới tăng lại', () => {
    const governor = new SystemLoadGovernor({ highPercent: 85, lowPercent: 60, sustainedMs: 5_000 });
    let now = 0;
    governor.sample(90, now);
    now += 5_000;
    expect(governor.sample(90, now)).toBe(true); // đã giảm tải

    now += 1_000;
    expect(governor.sample(70, now)).toBe(true); // 70 nằm trong vùng đệm — CHƯA đủ điều kiện tăng lại
    now += 10_000;
    expect(governor.sample(70, now)).toBe(true); // vẫn vùng đệm dù đã rất lâu — không tự tăng lại

    now += 1_000;
    governor.sample(55, now); // bắt đầu đếm thấp
    now += 4_999;
    expect(governor.sample(55, now)).toBe(true); // chưa đủ 5s liên tục dưới ngưỡng thấp
    now += 1;
    expect(governor.sample(55, now)).toBe(false); // đủ 5s liên tục → cho tăng lại
  });

  it('defaultLowPercentFor: cách ngưỡng cao 25 điểm, không thấp hơn sàn 40%', () => {
    expect(defaultLowPercentFor(85)).toBe(60);
    expect(defaultLowPercentFor(98)).toBe(73);
    expect(defaultLowPercentFor(50)).toBe(40); // 50-25=25 < sàn 40 → lấy sàn
  });

  it('DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS là "vài giây" hợp lý (không quá ngắn gây nhấp nháy, không quá dài mất phản hồi)', () => {
    expect(DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS).toBeGreaterThanOrEqual(3_000);
    expect(DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS).toBeLessThanOrEqual(10_000);
  });
});
