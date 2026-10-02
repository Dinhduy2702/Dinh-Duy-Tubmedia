import { afterEach, describe, expect, it, vi } from 'vitest';

// Lúc khởi động KHÔNG được có bất kỳ lệnh dọn thư mục tạm nào (thư mục tạm của người dùng có thể là
// Downloads — xem Đợt 2). Thay hàm dọn bằng gián điệp để khẳng định nó không bị gọi.
const cleanupSpy = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ removedFiles: 0, removedDirectories: 0, skippedUnsafePaths: 0 }))
);
vi.mock('@main/files/temporary-cleanup.js', async (importOriginal) => {
  const original = await importOriginal<typeof TemporaryCleanup>();
  return { ...original, cleanupTemporaryArtifacts: cleanupSpy };
});

import type * as TemporaryCleanup from '@main/files/temporary-cleanup.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';
import type { JobStatus } from '@shared/types/domain.js';
import { IPC } from '@shared/contracts/channels.js';

type TickAccess = { tick: () => Promise<void> };

let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
  cleanupSpy.mockClear();
});

const UNFINISHED: JobStatus[] = [
  'pending',
  'analyzing',
  'downloading',
  'downloaded',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying',
  'interrupted'
];

describe('khởi động: không tự chạy tác vụ nào', () => {
  it('giữ mọi tác vụ dở ở trạng thái tạm dừng APP_INTERRUPTED, N đúng, không tác vụ nào chạy', async () => {
    harness = createQueueHarness();
    const unfinished = UNFINISHED.map((status) => harness!.jobIn(status));
    const diskFull = harness.jobIn('paused', { errorCode: 'DISK_FULL', errorMessage: 'Đầy ổ' });
    const userPaused = harness.jobIn('paused');
    const completed = harness.jobIn('completed');

    await harness.manager.start();
    await (harness.manager as unknown as TickAccess).tick();

    for (const job of [...unfinished, diskFull]) {
      const current = harness.queue.get(job.id)!;
      expect(current.status, `tác vụ ban đầu ${job.status}`).toBe('paused');
      expect(current.errorCode).toBe('APP_INTERRUPTED');
      expect(current.errorMessage).toMatch(/đóng giữa chừng/);
    }
    expect(harness.queue.get(userPaused.id)?.status).toBe('paused');
    expect(harness.queue.get(userPaused.id)?.errorCode).toBeNull();
    expect(harness.queue.get(completed.id)?.status).toBe('completed');
    expect(harness.downloader.run).not.toHaveBeenCalled();
    expect(harness.projects.get(harness.project.id)?.status).toBe('paused');

    const prompt = await harness.manager.consumeStartupPrompt();
    expect(prompt.count).toBe(UNFINISHED.length + 1);
    // Hộp thoại chỉ hiện một lần mỗi lần mở app, kể cả khi cửa sổ tải lại.
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(0);
  });

  it('báo ngay cho giao diện trạng thái đã giữ (không để giao diện hiện "đang chạy" theo dữ liệu cũ)', async () => {
    harness = createQueueHarness();
    const job = harness.jobIn('downloading');
    const send = vi.fn();
    harness.manager.setWindow({ isDestroyed: () => false, webContents: { send } } as never);

    await harness.manager.start();
    await harness.manager.stop(false);

    const queueChanged = send.mock.calls.filter((call) => call[0] === IPC.events.queueChanged);
    expect(queueChanged.length, 'phải phát queueChanged sau khi giữ tác vụ lúc khởi động').toBeGreaterThan(0);
    const lastList = queueChanged.at(-1)?.[1] as Array<{ id: string; status: string }>;
    expect(lastList.find((item) => item.id === job.id)?.status).toBe('paused');
  });

  it('khởi động không gọi lệnh dọn thư mục tạm nào', async () => {
    harness = createQueueHarness();
    // Tình huống thật: thư mục có tồn tại (bộ bảo vệ ổ đĩa cho chạy) và tác vụ nếu bị chạy sẽ thất bại
    // hẳn → runJob().finally → syncProjectStatus → cleanupProjectTemporaryArtifacts(thư mục tạm).
    for (const name of ['source', 'temp', 'out']) mkdirSync(join(harness.folder, name), { recursive: true });
    harness.downloader.run.mockRejectedValue(
      Object.assign(new Error('Lỗi không thử lại được'), { code: 'INVALID_INPUT', retryable: false })
    );
    for (const status of UNFINISHED) harness.jobIn(status);
    harness.jobIn('completed');

    await harness.manager.start();
    await (harness.manager as unknown as TickAccess).tick();
    // Chờ đủ lâu để mọi tác vụ (nếu bị chạy) kết thúc và runJob().finally → syncProjectStatus kịp chạy.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it('bấm Tiếp tục: chỉ tác vụ APP_INTERRUPTED được chạy lại', async () => {
    harness = createQueueHarness();
    const held = harness.jobIn('downloading');
    const userPaused = harness.jobIn('paused');
    // Tác vụ bị chặn thật luôn mang cookieFailureConfirmed (xem nhánh tạm dừng trong execute()).
    const cookieBlocked = harness.jobIn('paused', {
      errorCode: 'COOKIES_EXPIRED',
      errorMessage: 'hết hạn',
      input: { cookieFailureConfirmed: true }
    });

    await harness.manager.start();
    const resumed = harness.manager.resumeStartupHeld();

    expect(resumed).toBe(1);
    expect(harness.queue.get(held.id)?.status).toBe('pending');
    expect(harness.queue.get(held.id)?.errorCode).toBeNull();
    expect(harness.queue.get(userPaused.id)?.status).toBe('paused');
    expect(harness.queue.get(cookieBlocked.id)?.status).toBe('paused');
    expect(harness.queue.get(cookieBlocked.id)?.errorCode).toBe('COOKIES_EXPIRED');
  });

  it('khi bật "Tự tiếp tục tác vụ dở", tác vụ dở về hàng chờ và không hỏi', async () => {
    harness = createQueueHarness({ autoResumeInterruptedOnStartup: true });
    const job = harness.jobIn('downloading');

    await harness.manager.start();
    await harness.manager.stop(false);

    expect(harness.queue.get(job.id)?.status).toBe('pending');
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(0);
  });
});

describe('khởi động: bộ đếm số lần bị gián đoạn đột ngột', () => {
  it('tắt ngang không làm mất lượt thử', async () => {
    harness = createQueueHarness();
    const job = harness.jobIn('downloading');

    await harness.manager.start();

    expect(harness.queue.get(job.id)?.attempts).toBe(0);
    expect(harness.queue.get(job.id)?.input.startupInterruptions).toBe(1);
  });

  it('bị gián đoạn quá 3 lần thì giữ tạm dừng, kể cả khi cài đặt tự tiếp tục đang bật', async () => {
    harness = createQueueHarness({ autoResumeInterruptedOnStartup: true });
    const job = harness.jobIn('downloading');

    for (let crash = 1; crash <= 4; crash += 1) {
      harness.relaunch();
      await harness.manager.start();
      await harness.manager.stop(false);
      const current = harness.queue.get(job.id)!;
      if (crash <= 3) {
        expect(current.status, `lần gián đoạn ${crash}`).toBe('pending');
        // Mô phỏng: tác vụ lại chạy và ứng dụng lại bị tắt ngang (Task Manager) giữa chừng.
        harness.queue.update(job.id, { status: 'downloading' });
      } else {
        expect(current.status).toBe('paused');
        expect(current.errorCode).toBe('INTERRUPTED_TOO_OFTEN');
        expect(current.errorMessage).toMatch(/4 lần/);
      }
    }
    expect(harness.downloader.run).not.toHaveBeenCalled();
    // Tác vụ bị giữ vì gián đoạn quá nhiều không nằm trong số N của hộp thoại "Tiếp tục".
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(0);
    expect(harness.manager.resumeStartupHeld()).toBe(0);
  });
});
