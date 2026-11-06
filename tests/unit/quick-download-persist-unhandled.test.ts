import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FsPromises from 'node:fs/promises';

// 2026-11-06 (kiểm đầy đủ trước phát hành 1.7.5 trượt "Unhandled Rejection ENOENT …state.json.<pid>.pending"): publish() gọi
// `void this.persist()` — khi ghi trạng thái Tải nhanh lỗi (thư mục trạng thái vừa bị xoá…), persist() đã ghi nhật ký nhưng vẫn
// ném lại lỗi, và `void` biến nó thành lỗi không ai bắt. Bài này cho mọi lần ghi tệp trạng thái lỗi ENOENT một cách TẤT ĐỊNH.

const failState = { on: false };
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
      const target = args[0];
      const path = typeof target === 'string' ? target : target instanceof URL ? target.pathname : Buffer.isBuffer(target) ? target.toString() : '';
      if (failState.on && path.endsWith('.pending')) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
      }
      return actual.writeFile(...args);
    })
  };
});
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';

const roots: string[] = [];
afterEach(async () => {
  failState.on = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe('QuickDownloadService: ghi trạng thái lỗi không thành lỗi không ai bắt', () => {
  it('mọi lần ghi state.json lỗi ENOENT trong lúc tải → không có unhandled rejection, và lỗi vẫn được ghi nhật ký', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-persist-'));
      roots.push(root);
      const outputDirectory = join(root, 'output');
      await mkdir(outputDirectory, { recursive: true });
      const reported = join(outputDirectory, 'video.mp4');
      const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises');
      await actualFs.writeFile(reported, 'video');
      const processes = {
        run: vi.fn((options: { onStdoutLine?: (line: string) => void }) => {
          // Từ lúc yt-dlp chạy: mọi lần ghi trạng thái (publish → persist) đều lỗi ENOENT.
          failState.on = true;
          options.onStdoutLine?.(`TUBMEDIA_FILE|${reported}`);
          return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '' });
        }),
        hasJob: vi.fn(() => false),
        pauseByJob: vi.fn(() => Promise.resolve()),
        resumeByJob: vi.fn(() => Promise.resolve()),
        killByJob: vi.fn(() => Promise.resolve())
      };
      const tools = {
        ensureRequiredReady: vi.fn(() => Promise.resolve([])),
        get: vi.fn((name: string) => ({ name, available: true, executablePath: join(root, `${name}.exe`) }))
      };
      const verifier = { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 300 })) };
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const service = new QuickDownloadService(processes as never, tools as never, verifier as never, logger as never, join(root, 'state'));
      const started = await service.start({
        url: 'https://example.com/video',
        outputDirectory,
        quality: 'best' as const,
        mode: 'full' as const,
        startTime: '',
        endTime: '',
        accurateCut: false
      });
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const phase = service.status(started.taskId)?.phase;
        if (phase && ['completed', 'failed', 'cancelled', 'interrupted'].includes(phase)) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      await service.shutdown(true);
      // Cho các promise "void" còn treo kịp báo lỗi (nếu có).
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));

      expect(processes.run).toHaveBeenCalled();
      expect(unhandled, 'không có lỗi ghi trạng thái nào thành unhandled rejection').toEqual([]);
      expect(
        logger.warn.mock.calls.some((call) => call[1] === 'QUICK_DOWNLOAD_STATE_WRITE_FAILED'),
        'lỗi ghi trạng thái vẫn được ghi nhật ký'
      ).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
