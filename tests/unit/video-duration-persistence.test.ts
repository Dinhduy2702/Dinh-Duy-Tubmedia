import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidVersion } from '../../scripts/version-tools.mjs';

import { parseQuickDownloadTime } from '../../src/shared/quick-download.js';

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
    expect(panel).toContain('parseQuickDownloadTime');
    expect(parseQuickDownloadTime('25:10:30')).toBe(25 * 3600 + 10 * 60 + 30);
  });

  it('giữ phiên bản công khai ở dạng hợp lệ', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };

    expect(isValidVersion(packageJson.version)).toBe(true);
  });
});
