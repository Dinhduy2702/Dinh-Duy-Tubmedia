import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Đợt 3 — trang Nhật ký (rà soát bản cài 1.5.0, 2026-10-02).
const page = readFileSync('src/renderer/src/pages/LogsPage.tsx', 'utf8');

describe('Đợt 3 mục 6 — mở trang Nhật ký là tải lịch sử', () => {
  it('LogsPage gọi tải lịch sử trong useEffect khi mở trang (không đợi bấm "Làm mới")', () => {
    expect(page).toMatch(/useEffect\(\(\) => \{\s*void reload\(/);
  });
});

describe('Đợt 3 mục 7 — lọc nhật ký theo mức/thành phần ở CSDL', () => {
  it('LogsPage truyền mức và danh sách thành phần xuống logs.list; đổi mức là tải lại từ CSDL', () => {
    expect(page).toContain("...(nextLevel !== 'all' ? { level: nextLevel as LogEntry['level'] } : {})");
    expect(page).toContain('...(nextModules.length > 0 ? { modules: nextModules } : {})');
    expect(page).toContain('changeLevel(event.target.value)');
  });

  it('ô "Thành phần" khớp tên tiếng Việt như gợi ý trong ô', () => {
    const labels = readFileSync('src/renderer/src/utils/vi-labels.ts', 'utf8');
    expect(labels).toContain('export function modulesMatching(');
  });
});
