import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogRepository } from '../../src/main/database/repositories/log-repository.js';
import { Logger } from '../../src/main/logging/logger.js';

let folder = '';

afterEach(() => {
  vi.restoreAllMocks();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

describe('Logger khi SQLite không ghi được', () => {
  it('không ném lỗi (ví dụ đĩa đầy) và vẫn trả về entry để các nhánh xử lý lỗi tiếp tục', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-logger-'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = {
      insert: vi.fn(() => {
        throw new Error('database or disk is full');
      })
    } as unknown as LogRepository;
    const logger = new Logger(repo, folder);

    const entry = logger.warn('queue', 'DISK_FULL', 'Ổ đĩa đầy', { projectId: 'project-1' });
    logger.warn('queue', 'DISK_FULL', 'Ổ đĩa đầy lần nữa');

    expect(entry.eventCode).toBe('DISK_FULL');
    expect(entry.id).toEqual(expect.any(String));
    // Chỉ báo lỗi hạ tầng một lần trong mỗi phút để không làm ngập console.
    expect(consoleError).toHaveBeenCalledTimes(1);
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});
