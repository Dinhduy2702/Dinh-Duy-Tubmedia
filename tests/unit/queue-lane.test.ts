import { describe, expect, it } from 'vitest';
import {
  PLATFORM_DOWNLOAD_CAPS,
  effectiveConcurrentDownloadLists,
  independentDownloadProjectCanStart,
  laneSlotAvailable,
  platformDownloadCap,
  queueExecutionLane
} from '../../src/shared/utils/queue-lane.js';
import { recommendedConcurrentLists } from '../../src/shared/utils/hardware-recommendation.js';

const GB = 1024 ** 3;

describe('independent queue execution lanes', () => {
  it('keeps normal list downloads separate from merge source downloads', () => {
    expect(queueExecutionLane({ type: 'download', input: {} })).toBe('download-list');
    expect(queueExecutionLane({ type: 'download', input: { workflow: 'download-merge' } })).toBe(
      'merge-workflow'
    );
    expect(queueExecutionLane({ type: 'normalize', input: {} })).toBe('merge-workflow');
  });

  it('lets every running download list use its own full project worker budget', () => {
    expect(independentDownloadProjectCanStart(0, { downloadWorkers: 2 })).toBe(true);
    expect(independentDownloadProjectCanStart(1, { downloadWorkers: 2 })).toBe(true);
    expect(independentDownloadProjectCanStart(2, { downloadWorkers: 2 })).toBe(false);
  });
});

// Lag bước 1 (2026-10-12): trần SỐ DANH SÁCH tải / SỐ QUY TRÌNH ghép chạy "full" cùng lúc — mỗi cái vẫn đủ luồng theo hồ sơ.
describe('trần số danh sách / quy trình chạy cùng lúc', () => {
  it('danh sách đang giữ lượt luôn chạy tiếp; danh sách mới chỉ vào khi còn lượt trống', () => {
    expect(laneSlotAvailable('A', new Set(['A', 'B']), 2)).toBe(true);
    expect(laneSlotAvailable('C', new Set(['A', 'B']), 2)).toBe(false);
    expect(laneSlotAvailable('C', new Set(['A']), 2)).toBe(true);
    expect(laneSlotAvailable('A', new Set(), 1)).toBe(true);
  });

  it('ô "Số danh sách tải chạy cùng lúc": 0 = tự động theo máy, 1–6 = đúng số đã chọn', () => {
    expect(effectiveConcurrentDownloadLists(0, 1)).toBe(1);
    expect(effectiveConcurrentDownloadLists(0, 2)).toBe(2);
    expect(effectiveConcurrentDownloadLists(4, 1)).toBe(4);
    expect(effectiveConcurrentDownloadLists(9, 1)).toBe(6);
    expect(effectiveConcurrentDownloadLists(-3, 2)).toBe(2);
  });

  it('tự động theo máy khớp khuyến nghị phần cứng: ≤8 lõi hoặc RAM trống ≤16 GB → 1, mạnh hơn → 2', () => {
    expect(recommendedConcurrentLists(8, 64 * GB)).toBe(1);
    expect(recommendedConcurrentLists(16, 12 * GB)).toBe(1);
    expect(recommendedConcurrentLists(16, 24 * GB)).toBe(2);
    expect(recommendedConcurrentLists(72, 100 * GB)).toBe(2);
  });
});

describe('trần riêng theo nền tảng (lưới an toàn chống 429)', () => {
  it('YouTube tối đa 6 video toàn ứng dụng; nền tảng khác không có trần riêng', () => {
    expect(PLATFORM_DOWNLOAD_CAPS).toEqual({ youtube: 6 });
    expect(platformDownloadCap('youtube')).toBe(6);
    expect(platformDownloadCap('tiktok')).toBeNull();
    expect(platformDownloadCap(null)).toBeNull();
  });
});
