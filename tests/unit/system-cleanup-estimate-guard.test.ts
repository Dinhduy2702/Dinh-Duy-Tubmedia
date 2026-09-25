import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Dọn dẹp máy: chỉ chế độ xóa bị chặn khi còn tác vụ đang chạy', () => {
  it('xem trước (estimate) không bị chặn bởi tiến trình kiểm tra công cụ lúc khởi động', async () => {
    const source = await readFile(join(process.cwd(), 'src/main/ipc/register-ipc.ts'), 'utf8');
    const start = source.indexOf('handle(IPC.systemCleanup.start');
    const end = source.indexOf('handle(IPC.systemCleanup.status');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, end);

    const guard = block.indexOf("request.mode === 'clean'");
    const active = block.indexOf('ctx.queue.activeCount() > 0');
    const throwing = block.indexOf('throw new InvalidInputError');
    expect(guard).toBeGreaterThan(-1);
    // điều kiện chế độ xóa phải nằm trước các phép kiểm tra tác vụ đang chạy và trước khi ném lỗi
    expect(active).toBeGreaterThan(guard);
    expect(throwing).toBeGreaterThan(active);
    // vẫn giữ nguyên chốt an toàn cho chế độ xóa
    expect(block).toContain('ctx.processes.count() > 0');
    expect(block).toContain('ctx.quickDownload.isActive()');
    expect(block).toContain('return systemCleanup.start(request);');
  });
});
