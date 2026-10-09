import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

// Phát hiện khi làm Đợt 5 mục 19 (2026-10-09): hàng đợi chỉ khởi động (start → giữ tác vụ dở lúc mở app, Đợt 1 mục 2) SAU
// khi kết nối xong công cụ — mất vài giây, trong lúc đó giao diện đã dùng được. Tác vụ người dùng TẠO (hoặc bấm Tiếp tục /
// Thử lại) trong khoảng đó bị giữ nhầm ở APP_INTERRUPTED "Ứng dụng bị đóng giữa chừng" và bị đếm vào hộp thoại Tiếp tục.
// Chỉ được giữ những tác vụ đã có TRƯỚC lúc app mở mà người dùng chưa đụng tới.

let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

const HELD = 'APP_INTERRUPTED';

describe('khởi động: chỉ giữ tác vụ có từ trước lúc mở app', () => {
  it('tác vụ tạo trong lúc hàng đợi đang khởi động KHÔNG bị giữ; tác vụ cũ vẫn bị giữ; hộp thoại chỉ đếm tác vụ cũ', async () => {
    harness = createQueueHarness();
    const oldPending = harness.jobIn('pending');
    const oldCrashed = harness.jobIn('downloading');
    harness.manager.markAppOpened();

    // Người dùng mở app rồi tải ngay — trước khi start() chạy (đang chờ kết nối công cụ).
    const fresh = harness.jobIn('pending');
    await harness.manager.start();

    for (const job of [oldPending, oldCrashed]) {
      expect(harness.queue.get(job.id)?.status, `tác vụ cũ ${job.status}`).toBe('paused');
      expect(harness.queue.get(job.id)?.errorCode).toBe(HELD);
    }
    expect(harness.queue.get(fresh.id)?.errorCode, 'tác vụ mới không bị giữ nhầm').not.toBe(HELD);
    expect(harness.queue.get(fresh.id)?.status).not.toBe('paused');
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(2);
  });

  it('tác vụ tạo GIỮA lúc start() đang chuẩn bị (có bước chờ cookies) cũng không bị giữ', async () => {
    harness = createQueueHarness({ cookiesFilePath: 'C:\\khong-co\\cookies.txt' });
    const old = harness.jobIn('pending');
    harness.manager.markAppOpened();

    const starting = harness.manager.start();
    const fresh = harness.jobIn('pending');
    await starting;

    expect(harness.queue.get(old.id)?.errorCode).toBe(HELD);
    expect(harness.queue.get(fresh.id)?.errorCode).not.toBe(HELD);
  });

  it('tác vụ cũ người dùng bấm Thử lại / Tiếp tục trong lúc chờ: làm theo người dùng, không giữ lại', async () => {
    harness = createQueueHarness();
    const failed = harness.jobIn('failed', { errorCode: 'DOWNLOAD_FAILED', errorMessage: 'lỗi' });
    const userPaused = harness.jobIn('paused');
    const untouched = harness.jobIn('pending');
    harness.manager.markAppOpened();

    harness.manager.retry(failed.id);
    await harness.manager.resume(userPaused.id);
    await harness.manager.start();

    expect(harness.queue.get(failed.id)?.errorCode).not.toBe(HELD);
    expect(harness.queue.get(userPaused.id)?.errorCode).not.toBe(HELD);
    expect(harness.queue.get(untouched.id)?.errorCode).toBe(HELD);
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(1);
  });

  it('Tiếp tục cả danh sách / tất cả / Thử lại lỗi của danh sách trong lúc chờ cũng là ý người dùng', async () => {
    for (const action of ['resumeProject', 'resumeAll', 'retryFailed'] as const) {
      harness = createQueueHarness();
      const job = action === 'retryFailed' ? harness.jobIn('failed', { errorCode: 'DOWNLOAD_FAILED', errorMessage: 'lỗi' }) : harness.jobIn('paused');
      harness.manager.markAppOpened();
      if (action === 'resumeProject') await harness.manager.resumeProject(harness.project.id);
      else if (action === 'resumeAll') await harness.manager.resumeAll();
      else harness.manager.retryFailed(harness.project.id);
      await harness.manager.start();
      expect(harness.queue.get(job.id)?.errorCode, action).not.toBe(HELD);
      harness.cleanup();
      harness = null;
    }
  });

  it('app gọi markAppOpened lúc khởi tạo — TRƯỚC khi đăng ký IPC (trước khi giao diện tạo được tác vụ)', () => {
    const context = readFileSync('src/main/app/app-context.ts', 'utf8');
    const initialize = context.slice(context.indexOf('public initialize(): void {'));
    expect(initialize).toContain('this.queue.markAppOpened();');
    const index = readFileSync('src/main/index.ts', 'utf8');
    expect(index.indexOf('current.initialize();')).toBeGreaterThan(-1);
    expect(index.indexOf('current.initialize();')).toBeLessThan(index.indexOf('registerIpc(current);'));
  });
});
