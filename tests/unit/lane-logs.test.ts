import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Khám phá #12 (bản cài 1.5.0): "Nhật ký riêng" của danh sách đọc lịch sử ngay khi thẻ hiện ra (không đợi mở khung) và đọc
// lại sau khi xóa nhật ký — cả Tải danh sách lẫn Ghép theo Timeline.
const read = (path: string): string => readFileSync(path, 'utf8');

describe('Nhật ký riêng của danh sách', () => {
  it('hook useLaneLogs đọc CSDL theo projectId + reloadKey, không phụ thuộc khung mở', () => {
    const hook = read('src/renderer/src/hooks/use-lane-logs.ts');
    expect(hook).toContain('.list({ projectId, limit: 500 })');
    expect(hook).toContain('}, [projectId, reloadKey]);');
    expect(hook).not.toContain('showLogs');
  });

  it.each(['src/renderer/src/pages/DownloadWorkbenchPage.tsx', 'src/renderer/src/pages/DownloadMergePage.tsx'])(
    '%s: dùng useLaneLogs; xóa nhật ký thì tăng logsVersion để đọc lại',
    (path) => {
      const page = read(path);
      expect(page).toContain('useLaneLogs(projectId,');
      expect(page).toContain('setLogsVersion((current) => ({ ...current, [slot]: (current[slot] ?? 0) + 1 }));');
      expect(page).not.toMatch(/if \(!projectId \|\| \(?!showLogs/);
    }
  );
});
