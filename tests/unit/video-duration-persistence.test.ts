import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(join(process.cwd(), 'src/renderer/src/components/QuickDownloadPanel.tsx'), 'utf8');

describe('lưu mốc thời lượng Tải nhanh', () => {
  it('đọc và ghi hai mốc bằng localStorage', () => {
    expect(panel).toContain('tubmedia.quick-download.start-duration');
    expect(panel).toContain('tubmedia.quick-download.end-duration');
    expect(panel).toContain('window.localStorage.getItem');
    expect(panel).toContain('window.localStorage.setItem');
  });

  it('không đặt lại thời lượng khi thêm link', () => {
    expect(panel).not.toMatch(/setStartTime\(\s*['"](?:00:)?10:00['"]\s*\)/);
    expect(panel).not.toMatch(/setEndTime\(\s*['"](?:00:)?13:00['"]\s*\)/);
  });

  it('chấp nhận giờ lớn hơn 23', () => {
    expect(panel).toContain('^\\d{2,4}:[0-5]\\d:[0-5]\\d$');
  });

  it('giữ nguyên phiên bản 1.3.0', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };

    expect(packageJson.version).toBe('1.3.0');
  });
});
