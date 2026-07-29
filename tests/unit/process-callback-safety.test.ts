import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/main/logging/logger.js';
import { ProcessManager } from '../../src/main/processes/process-manager.js';

describe('external process callback safety', () => {
  it('does not crash the main process when a progress callback throws', async () => {
    const warn = vi.fn();
    const logger = {
      info: vi.fn(),
      warn,
      error: vi.fn(),
      debug: vi.fn()
    } as unknown as Logger;
    const manager = new ProcessManager(logger);

    const result = await manager.run({
      jobId: 'job-progress-safety',
      tool: 'node',
      executablePath: process.execPath,
      args: ['-e', "console.log('out_time_ms=broken'); console.log('progress=end')"],
      onStdoutLine: () => {
        throw new Error('simulated progress parser failure');
      }
    });

    expect(result.code).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      'process',
      'PROCESS_STDOUT_CALLBACK_DISABLED',
      expect.any(String),
      expect.any(Object)
    );
  });
});
