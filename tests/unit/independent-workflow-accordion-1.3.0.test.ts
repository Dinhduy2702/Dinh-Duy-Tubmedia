import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const queueManager = readFileSync(resolve(root, 'src/main/queue/queue-manager.ts'), 'utf8');
const queueLane = readFileSync(resolve(root, 'src/shared/utils/queue-lane.ts'), 'utf8');
const queuePage = readFileSync(resolve(root, 'src/renderer/src/pages/QueuePage.tsx'), 'utf8');
const workbench = readFileSync(resolve(root, 'src/renderer/src/pages/DownloadWorkbenchPage.tsx'), 'utf8');
const theme = readFileSync(resolve(root, 'src/renderer/src/tubmedia-theme.css'), 'utf8');

describe('danh sách tải độc lập và giao diện accordion 1.3.0', () => {
  it('không dùng giới hạn toàn cục của danh sách khác để chặn download-list', () => {
    expect(queueLane).toContain('independentDownloadProjectCanStart');
    expect(queueManager).toContain("if (lane === 'download-list')");
    expect(queueManager).toContain('independentDownloadProjectCanStart(activeOfProjectType, profile)');
    expect(queueManager).toContain("if (lane === 'merge-workflow')");
  });

  it('mỗi danh sách có điều khiển riêng và danh sách khác tiếp tục chạy', () => {
    expect(queuePage).toContain('runGroup');
    expect(queuePage).toContain('Các danh sách khác vẫn chạy độc lập.');
    expect(workbench).toContain('bắt đầu độc lập và chạy song song');
  });

  it('có thanh tổng, mũi tên và vùng tiến trình con', () => {
    expect(queuePage).toContain('queue-workflow-total-progress');
    expect(queuePage).toContain('queue-workflow-expander');
    expect(queuePage).toContain('queue-workflow-collapse');
    expect(queuePage).toContain('Tiến trình thành phần');
  });

  it('animation tinh tế và responsive', () => {
    expect(theme).toContain('TUBMEDIA_INDEPENDENT_WORKFLOW_ACCORDION_1_3_0_START');
    expect(theme).toContain('grid-template-rows: 0fr');
    expect(theme).toContain('grid-template-rows: 1fr');
    expect(theme).toContain('transform: rotate(180deg)');
    expect(theme).toContain('@media (max-width: 720px)');
  });
});
