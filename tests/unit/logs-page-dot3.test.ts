import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Đợt 3 — trang Nhật ký (rà soát bản cài 1.5.0, 2026-10-02).
const page = readFileSync('src/renderer/src/pages/LogsPage.tsx', 'utf8');

describe('Đợt 3 mục 6 — mở trang Nhật ký là tải lịch sử', () => {
  it('LogsPage gọi tải lịch sử trong useEffect khi mở trang (không đợi bấm "Làm mới")', () => {
    expect(page).toMatch(/useEffect\(\(\) => \{\s*void reload\(/);
  });
});
