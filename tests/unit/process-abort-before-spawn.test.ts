import { describe, expect, it, vi } from 'vitest';
import { ProcessCancelledError } from '../../src/shared/errors/app-errors.js';
import type { Logger } from '../../src/main/logging/logger.js';
import { ProcessManager } from '../../src/main/processes/process-manager.js';

function createLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('ProcessManager cancellation edge cases', () => {
  it('kills the child immediately when the abort signal fired before spawn', async () => {
    const manager = new ProcessManager(createLogger());
    const controller = new AbortController();
    controller.abort();

    const startedAt = Date.now();
    await expect(
      manager.run({
        jobId: 'job-already-aborted',
        tool: 'node',
        executablePath: process.execPath,
        // Nếu abort bị bỏ sót, tiến trình này sẽ chạy tới 30 giây.
        args: ['-e', 'setTimeout(() => {}, 30000)'],
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(ProcessCancelledError);

    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(manager.count()).toBe(0);
  }, 20_000);

  it('shutdown resolves even when there is nothing to kill', async () => {
    const manager = new ProcessManager(createLogger());
    await expect(manager.shutdown()).resolves.toBeUndefined();
  });
});
