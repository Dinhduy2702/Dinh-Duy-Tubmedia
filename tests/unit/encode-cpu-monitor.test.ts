import { describe, expect, it } from 'vitest';
import { EncodeCpuMonitor, parseProcessCpuLine } from '@main/queue/encode-cpu-monitor.js';

// 2026-11-05 (sửa B): đo CPU riêng của các ffmpeg mã hoá nền của app (lớp WMI Win32_PerfFormattedData_PerfProc_Process:
// PercentProcessorTime tính theo MỘT luồng — 4 luồng chạy hết = 400) để bộ điều tiết tải không tính phần đó.

describe('đo CPU các tiến trình mã hoá nền', () => {
  it('đọc dòng JSON của PowerShell: một hay nhiều tiến trình', () => {
    expect(parseProcessCpuLine('{"IDProcess":120,"PercentProcessorTime":350}')).toEqual(new Map([[120, 350]]));
    expect(
      parseProcessCpuLine('[{"IDProcess":120,"PercentProcessorTime":350},{"IDProcess":7,"PercentProcessorTime":20}]')
    ).toEqual(
      new Map([
        [120, 350],
        [7, 20]
      ])
    );
  });

  it('dòng hỏng / thiếu số → bỏ qua, không đoán', () => {
    expect(parseProcessCpuLine('không phải json').size).toBe(0);
    expect(parseProcessCpuLine('[{"IDProcess":"x","PercentProcessorTime":1},{"IDProcess":5}]').size).toBe(0);
    expect(parseProcessCpuLine('[]').size).toBe(0);
  });

  it('cộng đúng các PID của app, quy về % toàn máy theo số luồng', () => {
    const monitor = new EncodeCpuMonitor(false);
    monitor.accept('[{"IDProcess":120,"PercentProcessorTime":300},{"IDProcess":7,"PercentProcessorTime":90},{"IDProcess":9,"PercentProcessorTime":50}]', 1_000);
    expect(monitor.machinePercentOf([120, 9], 4, 2_000)).toBe(87.5);
    expect(monitor.machinePercentOf([], 4, 2_000)).toBe(0);
    expect(monitor.machinePercentOf([555], 4, 2_000)).toBe(0);
  });

  it('số đo cũ (tiến trình đo treo/chết) → 0, không tự trừ CPU', () => {
    const monitor = new EncodeCpuMonitor(false);
    monitor.accept('{"IDProcess":120,"PercentProcessorTime":300}', 1_000);
    expect(monitor.machinePercentOf([120], 4, 1_000 + 21_000)).toBe(0);
  });

  it('không vượt 100% dù số đo lệch', () => {
    const monitor = new EncodeCpuMonitor(false);
    monitor.accept('{"IDProcess":1,"PercentProcessorTime":900}', 1_000);
    expect(monitor.machinePercentOf([1], 4, 1_500)).toBe(100);
  });
});
