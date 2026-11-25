import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDiskKindLookup } from '../../src/main/settings/disk-kind-lookup.js';
import type { HardwareProfile } from '../../src/shared/types/domain.js';

const hardwareSrc = readFileSync(resolve(process.cwd(), 'src/main/settings/hardware-service.ts'), 'utf8');
const settingsSrc = readFileSync(resolve(process.cwd(), 'src/main/settings/settings-service.ts'), 'utf8');

function makeProfile(disks: HardwareProfile['disks']): HardwareProfile {
  return {
    platform: 'win32',
    release: '10.0',
    architecture: 'x64',
    hostname: 'test',
    physicalCpuCount: 4,
    logicalCpuCount: 8,
    cpuModel: 'Test CPU',
    totalMemoryBytes: 8 * 1024 ** 3,
    freeMemoryBytes: 4 * 1024 ** 3,
    gpuAdapters: [],
    disks,
    detectedAt: new Date().toISOString()
  };
}

describe('Cứng hóa dò phần cứng, loại ổ đĩa và cài đặt khởi động (#7)', () => {
  it('HardwareService.detect() gộp các lệnh WMI vào 1 tiến trình PowerShell duy nhất', () => {
    const start = hardwareSrc.indexOf('public async detect(');
    const end = hardwareSrc.indexOf('public recommend(', start);
    const detectBody = hardwareSrc.slice(start, end);
    const psCalls = detectBody.match(/powershellJson\s*\(/g) ?? [];
    expect(psCalls.length).toBe(1);
  });

  it('SettingsService bọc app.setLoginItemSettings trong if (app.isPackaged)', () => {
    const matches = [...settingsSrc.matchAll(/app\.setLoginItemSettings/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const match of matches) {
      const idx = match.index ?? 0;
      const before = settingsSrc.slice(Math.max(0, idx - 120), idx);
      expect(before).toContain('app.isPackaged');
    }
  });

  it('SettingsService.recommend() cập nhật freemem() tươi trước khi đề xuất', () => {
    const start = settingsSrc.indexOf('public async recommend(');
    const body = settingsSrc.slice(start);
    expect(body).toContain('freemem()');
  });

  it('createDiskKindLookup không đóng băng unknown mãi mãi khi lần dò đầu trả về disks: []', async () => {
    vi.useFakeTimers();
    try {
      const detect = vi
        .fn<() => Promise<HardwareProfile>>()
        .mockResolvedValueOnce(makeProfile([]))
        .mockResolvedValueOnce(
          makeProfile([{ device: 'D:', mount: 'D:\\', type: 'hdd', totalBytes: 1000, freeBytes: 500 }])
        );

      const lookup = createDiskKindLookup(detect);
      expect(lookup('D')).toBe('unknown');
      await vi.advanceTimersByTimeAsync(0);
      expect(detect).toHaveBeenCalledTimes(1);

      // Sau 60 giây cho phép dò lại vì lần trước disks rỗng
      vi.advanceTimersByTime(61_000);
      expect(lookup('D')).toBe('unknown');
      await vi.advanceTimersByTimeAsync(0);
      expect(detect).toHaveBeenCalledTimes(2);
      expect(lookup('D')).toBe('hdd');
    } finally {
      vi.useRealTimers();
    }
  });
});
