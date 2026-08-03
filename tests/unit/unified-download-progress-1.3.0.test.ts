import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const queue = readFileSync(resolve(root, 'src/renderer/src/pages/QueuePage.tsx'), 'utf8');
const quick = readFileSync(resolve(root, 'src/renderer/src/components/QuickDownloadPanel.tsx'), 'utf8');
const unified = readFileSync(
  resolve(root, 'src/renderer/src/components/UnifiedDownloadProgress.tsx'),
  'utf8'
);
const theme = readFileSync(resolve(root, 'src/renderer/src/tubmedia-theme.css'), 'utf8');

describe('tiến trình tải thống nhất 1.3.0', () => {
  it('dùng cùng một thành phần tiến trình cho tải nhanh và workflow tổng', () => {
    expect(unified).toContain('export function UnifiedDownloadProgress');
    expect(quick).toContain('<UnifiedDownloadProgress');
    expect(queue).toContain('<UnifiedDownloadProgress');
  });

  it('đưa Tải nhanh vào cùng màn hình và dùng ProcessManager controls', () => {
    expect(queue).toContain('window.desktop.quickDownload.current()');
    expect(queue).toContain("onControl('pause')");
    expect(queue).toContain("onControl('resume')");
    expect(queue).toContain("onControl('cancel')");
  });

  it('mỗi workflow có thanh tổng và mũi tên mở danh sách tiến trình con', () => {
    expect(queue).toContain('queue-workflow-total-progress');
    expect(queue).toContain('queue-workflow-expander');
    expect(queue).toContain('queue-workflow-collapse');
    expect(queue).toContain('<QueueChildRows');
  });

  it('giữ virtualization trong danh sách con lớn', () => {
    expect(queue).toContain('useVirtualTableWindow(jobs, 108, 520, 8, true)');
    expect(queue).toContain('queue-group-child-window');
  });

  it('làm mượt thanh phần trăm, mũi tên và vùng xổ xuống', () => {
    expect(theme).toMatch(
      /transition:\s*width\s+(?:0?\.34s|340ms)\s+cubic-bezier\(\s*0?\.22\s*,\s*0?\.61\s*,\s*0?\.36\s*,\s*1\s*\)/
    );
    expect(theme).toContain('will-change: width');
    expect(theme).toContain('grid-template-rows: 0fr');
    expect(theme).toContain('grid-template-rows: 1fr');
    expect(theme).toContain(".queue-workflow-expander[aria-expanded='true'] svg");
  });
});
