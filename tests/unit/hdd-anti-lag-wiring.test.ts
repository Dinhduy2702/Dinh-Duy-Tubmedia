import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backgroundEncodePriority } from '../../src/main/downloader/download-engine.js';
import { createDiskKindLookup } from '../../src/main/settings/disk-kind-lookup.js';
import type { HardwareProfile } from '../../src/shared/types/domain.js';

// 2026-11-02 (chống lag, người dùng duyệt): nối bộ chống lag vào app — loại ổ lấy từ máy đang chạy, bản dựng CapCut xếp lượt
// chạy dưới mức ưu tiên thường. 1.7.4: bỏ xếp lượt mã hoá theo ổ (xem download-repaste-existing.test.ts Phần 3).

const profile = (disks: Array<[string, 'hdd' | 'ssd' | 'unknown']>): HardwareProfile =>
  ({ disks: disks.map(([letter, type]) => ({ device: `${letter}:`, mount: `${letter}:\\`, type, totalBytes: 1, freeBytes: 1 })) }) as HardwareProfile;

describe('tra loại ổ thật', () => {
  it('chưa dò xong → "không rõ" (giữ cách chạy cũ); dò xong → đúng loại theo ký tự ổ; chỉ dò một lần', async () => {
    let calls = 0;
    let finish: (value: HardwareProfile) => void = () => undefined;
    const lookup = createDiskKindLookup(() => {
      calls += 1;
      return new Promise<HardwareProfile>((resolve) => (finish = resolve));
    });
    expect(lookup('E')).toBe('unknown');
    finish(profile([['C', 'ssd'], ['E', 'hdd']]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lookup('e')).toBe('hdd');
    expect(lookup('C')).toBe('ssd');
    expect(lookup('Z')).toBe('unknown');
    expect(calls).toBe(1);
  });

  it('dò lỗi → mọi ổ "không rõ", không ném lỗi', async () => {
    const lookup = createDiskKindLookup(() => Promise.reject(new Error('PowerShell lỗi')));
    expect(lookup('C')).toBe('unknown');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lookup('C')).toBe('unknown');
  });
});

describe('bản dựng CapCut là việc nền', () => {
  it('FFmpeg tạo bản CapCut chạy dưới mức thường; hồ sơ đặt "idle" thì giữ', () => {
    expect(backgroundEncodePriority('normal')).toBe('below_normal');
    expect(backgroundEncodePriority('high')).toBe('below_normal');
    expect(backgroundEncodePriority('idle')).toBe('idle');
    const source = readFileSync('src/main/downloader/download-engine.ts', 'utf8');
    expect(source).toContain('priority: backgroundEncodePriority(resource.processPriority)');
    expect(source).not.toContain('acquireEditEncodeSlot');
  });
});
