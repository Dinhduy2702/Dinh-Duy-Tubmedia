import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/main/logging/logger.js';
import { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { WindowsJobHost } from '../../src/main/processes/windows-job-host.js';

function createLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('ProcessManager — tiến trình ngắn kết thúc trong lúc gắn Windows Job Object (C)', () => {
  it('không bao giờ bỏ lỡ sự kiện close/stdout khi tiến trình con kết thúc trước lúc assignProcess trả về', async () => {
    let assigned = false;
    let assignedBeforeStdoutCallback = false;
    const fakeJobHost = {
      isEnabled: () => true,
      ensureReady: () => Promise.resolve(),
      assignProcess: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            assigned = true;
            resolve();
          }, 250)
        ),
      setEncodeCpuCapPercent: vi.fn(),
      dispose: vi.fn()
    } as unknown as WindowsJobHost;

    const manager = new ProcessManager(createLogger(), undefined, fakeJobHost);
    vi.spyOn(manager, 'setPriority').mockResolvedValue();

    const observedLines: string[] = [];
    const outcome = await Promise.race([
      manager
        .run({
          jobId: 'health-ffmpeg-muxers',
          tool: 'ffmpeg',
          executablePath: process.execPath,
          args: ['-e', 'process.stdout.write("muxer mp4 ok\\n");'],
          timeoutMs: 1_500,
          onStdoutLine: (line) => {
            if (line.includes('muxer mp4 ok')) {
              assignedBeforeStdoutCallback = assigned;
            }
            observedLines.push(line);
          }
        })
        .then((res) => ({ kind: 'done' as const, res })),
      new Promise<{ kind: 'hung' }>((resolve) => setTimeout(() => resolve({ kind: 'hung' }), 3_000))
    ]);

    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.res.code).toBe(0);
      expect(outcome.res.stdoutTail).toContain('muxer mp4 ok');
    }
    expect(observedLines).toContain('muxer mp4 ok');
    expect(assignedBeforeStdoutCallback).toBe(true);
    expect(manager.count()).toBe(0);
  }, 10_000);
});
