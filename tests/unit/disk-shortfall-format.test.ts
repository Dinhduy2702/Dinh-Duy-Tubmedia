import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDiskShortfall } from '@shared/utils/disk-shortfall-format.js';

// Khám phá bản cài 1.5.0 (2026-10-05) #8: nhật ký thật ghi "chỉ còn 20.0 GB, thấp hơn mức an toàn 20.0 GB" —
// cả hai số làm tròn bằng toFixed(1), 19,96 GB thành 20.0.
const GB = 1024 ** 3;

describe('#8 — câu báo thiếu dung lượng không bao giờ ra hai số bằng nhau', () => {
  it('đúng ca thật: còn 19,96 GB, cần 20 GB → "19.9 GB" < "20.0 GB"', () => {
    expect(formatDiskShortfall(19.96 * GB, 20 * GB)).toEqual({ free: '19.9 GB', required: '20.0 GB' });
  });

  it('còn trống làm tròn XUỐNG, mức an toàn làm tròn LÊN', () => {
    expect(formatDiskShortfall(5.99 * GB, 8.01 * GB)).toEqual({ free: '5.9 GB', required: '8.1 GB' });
  });

  it('mọi cặp còn trống < mức an toàn đều hiện hai số khác nhau', () => {
    for (const required of [4, 8, 20, 20.05, 100]) {
      for (const gap of [1, 1024, 1024 ** 2, 0.04 * GB]) {
        const { free, required: shown } = formatDiskShortfall(required * GB - gap, required * GB);
        expect(free, `${required} GB - ${gap} byte`).not.toBe(shown);
      }
    }
  });

  it('giá trị không hợp lệ → "0 GB" như trước', () => {
    expect(formatDiskShortfall(Number.NaN, 0).free).toBe('0 GB');
  });

  it('hàng đợi và Tải nhanh đều dùng chung hàm này cho câu "thấp hơn mức an toàn"', () => {
    for (const file of ['src/main/queue/queue-manager.ts', 'src/main/download/quick-download-service.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toContain('formatDiskShortfall(');
      expect(source, file).not.toMatch(/thấp hơn mức an toàn ` \+\s*`\$\{this\.formatDiskBytes/);
    }
  });
});
