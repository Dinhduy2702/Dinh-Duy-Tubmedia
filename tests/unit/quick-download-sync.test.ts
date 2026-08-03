import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

const panel = read('src/renderer/src/components/QuickDownloadPanel.tsx');
const ipc = read('src/main/ipc/register-ipc.ts');
const service = read('src/main/download/quick-download-service.ts');
const channels = read('src/shared/contracts/channels.ts');
const preload = read('src/preload/index.ts');

 describe('Tải nhanh đồng bộ và Timeline tùy chọn', () => {
  it('chỉ hiển thị trình đặt Timeline khi người dùng bật dấu tích', () => {
    expect(panel).toContain('tubmedia.quick-download.use-timeline');
    expect(panel).toContain('checked={useTimeline}');
    expect(panel).toContain('{useTimeline && (');
    expect(panel).toContain('data-testid="quick-download-timeline-editor"');
    expect(panel).toContain("mode: useTimeline ? 'range' : 'full'");
  });

  it('khôi phục trạng thái tác vụ khi chuyển trang hoặc mở lại panel', () => {
    expect(channels).toContain("current: 'quick-download:current'");
    expect(preload).toContain('current: () => invoke(IPC.quickDownload.current)');
    expect(panel).toContain('window.desktop.quickDownload.current()');
    expect(service).toContain('public currentStatus()');
  });

  it('không chặn Tải nhanh chỉ vì hàng đợi khác đang chạy', () => {
    const startBlock = ipc.slice(
      ipc.indexOf('handle(IPC.quickDownload.start'),
      ipc.indexOf('handle(IPC.quickDownload.status')
    );
    expect(startBlock).toContain('systemCleanup.isActive()');
    expect(startBlock).not.toContain('ctx.queue.activeCount()');
    expect(startBlock).not.toContain('ctx.processes.count()');
  });

  it('Tạm dừng và Tiếp tục tất cả điều khiển cả Quick Download', () => {
    expect(ipc).toContain('ctx.quickDownload.pauseActive()');
    expect(ipc).toContain('ctx.quickDownload.resumeActive()');
    expect(service).toContain('public async pauseActive()');
    expect(service).toContain('public async resumeActive()');
  });
});
