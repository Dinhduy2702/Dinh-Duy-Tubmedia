import { describe, expect, it } from 'vitest';
import { ProcessSpawnError, ProcessTimeoutError } from '../../src/shared/errors/app-errors.js';

describe('process terminal reasons', () => {
  it('distinguishes spawn and timeout from cancellation', () => {
    expect(new ProcessSpawnError('ffmpeg', 'ENOENT').code).toBe('PROCESS_SPAWN_FAILED');
    const timeout = new ProcessTimeoutError('yt-dlp', 30_000);
    expect(timeout.code).toBe('PROCESS_TIMEOUT');
    expect(timeout.retryable).toBe(true);
  });
});
