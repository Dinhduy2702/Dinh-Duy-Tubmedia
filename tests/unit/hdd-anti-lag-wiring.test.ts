import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backgroundEncodePriority, DownloadEngine } from '../../src/main/downloader/download-engine.js';
import { createDiskKindLookup } from '../../src/main/settings/disk-kind-lookup.js';
import type { HardwareProfile } from '../../src/shared/types/domain.js';

// 2026-11-02 (chống lag, người dùng duyệt): nối bộ chống lag vào app — loại ổ lấy từ máy đang chạy, bản dựng CapCut xếp lượt
// theo ổ và chạy dưới mức ưu tiên thường.

const profile = (disks: Array<[string, 'hdd' | 'ssd' | 'unknown']>): HardwareProfile =>
  ({ disks: disks.map(([letter, type]) => ({ device: `${letter}:`, mount: `${letter}:\\`, type, totalBytes: 1, freeBytes: 1 })) }) as HardwareProfile;

type SlotAccess = {
  acquireEditEncodeSlot: (master: string, signal: AbortSignal, onProgress: () => void, stageLabel: string) => Promise<() => void>;
};

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
    expect(source).toContain('await this.acquireEditEncodeSlot(input, signal, onProgress, stageLabel)');
  });

  it('ổ HDD → bản thứ hai chờ bản đầu xong; SSD nhiều nhân → chạy song song', async () => {
    const engine = new DownloadEngine({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const access = engine as unknown as SlotAccess;
    const signal = new AbortController().signal;
    engine.setDiskKindLookup((letter) => (letter === 'E' ? 'hdd' : 'ssd'));

    const first = await access.acquireEditEncodeSlot('E:\\a\\v1.mp4', signal, () => undefined, 'x');
    let secondStarted = false;
    const second = access.acquireEditEncodeSlot('E:\\a\\v2.mp4', signal, () => undefined, 'x').then((release) => {
      secondStarted = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondStarted, 'HDD: mỗi lúc một bản').toBe(false);
    first();
    (await second)();

    const onSsd = await Promise.race([
      Promise.all([
        access.acquireEditEncodeSlot('C:\\a\\v1.mp4', signal, () => undefined, 'x'),
        access.acquireEditEncodeSlot('C:\\a\\v2.mp4', signal, () => undefined, 'x')
      ]),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100))
    ]);
    const parallelExpected = (await import('node:os')).cpus().length >= 32;
    if (parallelExpected) expect(onSsd, 'SSD máy nhiều nhân: không phải chờ').not.toBeNull();
    for (const release of onSsd ?? []) release();
  });

  it('chưa nối bộ tra loại ổ (bài kiểm khác, công cụ khác) → không xếp lượt, như trước', async () => {
    const engine = new DownloadEngine({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const access = engine as unknown as SlotAccess;
    const signal = new AbortController().signal;
    const a = await access.acquireEditEncodeSlot('E:\\v1.mp4', signal, () => undefined, 'x');
    const b = await access.acquireEditEncodeSlot('E:\\v2.mp4', signal, () => undefined, 'x');
    a();
    b();
  });
});
