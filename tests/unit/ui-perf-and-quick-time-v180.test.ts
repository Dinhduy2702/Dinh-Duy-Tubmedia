import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQuickDownloadTime } from '../../src/shared/quick-download.js';

const root = process.cwd();
const logsPage = readFileSync(join(root, 'src/renderer/src/pages/LogsPage.tsx'), 'utf8');
const downloadWorkbench = readFileSync(join(root, 'src/renderer/src/pages/DownloadWorkbenchPage.tsx'), 'utf8');
const downloadMerge = readFileSync(join(root, 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');
const quickDownloadPanel = readFileSync(join(root, 'src/renderer/src/components/QuickDownloadPanel.tsx'), 'utf8');

describe('#46 & #47: tối ưu useMemo/O(N), parseQuickDownloadTime, ô Video cùng lúc & nhãn failed', () => {
  it('#46: LogsPage bọc useMemo cho effectiveLogs, moduleKeys, filtered và bỏ findIndex O(N^2)', () => {
    expect(logsPage).toMatch(/useMemo\(\s*\(\)\s*=>\s*\{[\s\S]*new Map<string,\s*LogEntry>/);
    expect(logsPage).not.toContain('entries.findIndex(');
    expect(logsPage).toMatch(/const moduleKeys = useMemo\(/);
    expect(logsPage).toMatch(/const filtered = useMemo\(/);
  });

  it('#46: DownloadWorkbenchPage và DownloadMergePage memo hóa logsByProject / filtered nhật ký làn', () => {
    expect(downloadWorkbench).toContain('EMPTY_LOGS');
    expect(downloadWorkbench).toMatch(/logsByProject\s*=\s*useMemo\(/);
    expect(downloadWorkbench).toMatch(/LaneLogPanel[\s\S]*const filtered = useMemo\(/);
    expect(downloadMerge).toContain('EMPTY_LOGS');
    expect(downloadMerge).toMatch(/logsByProject\s*=\s*useMemo\(/);
    expect(downloadMerge).toMatch(/MergeLogPanel[\s\S]*const filtered = useMemo\(/);
  });

  it('#47: QuickDownloadPanel dùng chung parseQuickDownloadTime hỗ trợ MM:SS, H:MM:SS và >24h', () => {
    expect(quickDownloadPanel).toContain("from '@shared/quick-download'");
    expect(quickDownloadPanel).toContain('parseQuickDownloadTime');
    expect(quickDownloadPanel).not.toContain('function parseDurationToSeconds');
    expect(parseQuickDownloadTime('01:30')).toBe(90);
    expect(parseQuickDownloadTime('1:05:30')).toBe(3930);
    expect(parseQuickDownloadTime('25:10:30')).toBe(25 * 3600 + 10 * 60 + 30);
  });

  it('#47: DownloadWorkbenchPage cho phép xóa tạm ô Video cùng lúc và hiển thị Cần xử lý lỗi khi failed', () => {
    expect(downloadWorkbench).toContain('workersDraft');
    expect(downloadWorkbench).toContain("state === 'failed'");
    expect(downloadWorkbench).toContain("'Cần xử lý lỗi'");
  });
});
