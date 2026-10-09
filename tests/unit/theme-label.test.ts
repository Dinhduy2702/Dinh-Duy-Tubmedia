import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLightTheme } from '../../src/shared/utils/theme.js';

// Đợt 5 mục 10 (rà soát bản cài 2026-10-02): nút Sáng/Tối ở thanh trên đọc lớp 'light' của <html> NGAY LÚC VẼ. App bật/tắt
// lớp đó trong effect (chạy SAU khi thanh trên đã vẽ) nên đổi giao diện ở Cài đặt, hoặc Windows đổi sáng/tối khi đang chọn
// "Theo giao diện Windows", thì nhãn/công tắc ở thanh trên vẫn ghi giao diện CŨ. Nhãn phải tính từ cài đặt + Windows.

describe('isLightTheme — giao diện đang dùng tính từ cài đặt và Windows', () => {
  it('chọn hẳn Sáng/Tối thì không phụ thuộc Windows', () => {
    expect(isLightTheme('light', false)).toBe(true);
    expect(isLightTheme('light', true)).toBe(true);
    expect(isLightTheme('dark', true)).toBe(false);
    expect(isLightTheme('dark', false)).toBe(false);
  });

  it('"Theo giao diện Windows" thì theo Windows', () => {
    expect(isLightTheme('system', true)).toBe(true);
    expect(isLightTheme('system', false)).toBe(false);
  });

  it('chưa nạp cài đặt → tối (mặc định của app)', () => {
    expect(isLightTheme(undefined, true)).toBe(false);
  });
});

describe('nối vào giao diện', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('thanh trên KHÔNG đọc lớp DOM lúc vẽ; thanh trên và App dùng chung một nguồn (useIsLightTheme)', () => {
    const topbar = read('src/renderer/src/layout/Topbar.tsx');
    expect(topbar).not.toContain("classList.contains('light')");
    expect(topbar).toContain('useIsLightTheme(');
    expect(read('src/renderer/src/app/App.tsx')).toContain('useIsLightTheme(');
  });

  it('hook theo dõi Windows đổi sáng/tối (matchMedia change) để vẽ lại', () => {
    const hook = read('src/renderer/src/hooks/use-is-light-theme.ts');
    expect(hook).toContain("matchMedia('(prefers-color-scheme: light)')");
    expect(hook).toContain("addEventListener('change'");
    expect(hook).toContain('isLightTheme(');
  });
});
