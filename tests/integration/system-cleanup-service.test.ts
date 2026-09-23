import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemCleanupService } from '../../src/main/system/system-cleanup-service.js';
import type { CleanupEnvironmentPaths } from '../../src/main/system/cleanup-scanner.js';

// Toàn bộ bài kiểm này chạy trên một sandbox riêng dưới os.tmpdir() — SystemCleanupService nhận
// CleanupEnvironmentPaths và TubmediaCleanupRoots GIẢ qua constructor, nên không bao giờ đọc
// %TEMP%/%LOCALAPPDATA%/%APPDATA% thật của máy đang chạy test này.

describe('SystemCleanupService (GĐ4a — quét thật bằng Node trên môi trường giả, chưa xóa gì)', () => {
  let sandbox = '';
  let env: CleanupEnvironmentPaths;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'tubmedia-cleanup-service-'));
    env = {
      tempDir: join(sandbox, 'Temp'),
      localAppData: join(sandbox, 'Local'),
      roamingAppData: join(sandbox, 'Roaming')
    };
    await mkdir(env.tempDir, { recursive: true });
    await mkdir(env.localAppData, { recursive: true });
    await mkdir(env.roamingAppData, { recursive: true });
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  function makeService(): SystemCleanupService {
    return new SystemCleanupService(
      () => ({
        sourceFolders: [],
        tempFolders: [],
        trackedTempFiles: [],
        quickOutputFolders: [],
        quickTempRoots: []
      }),
      () => env
    );
  }

  async function waitForTerminal(
    service: SystemCleanupService,
    runId: string,
    timeoutMs = 5000
  ): Promise<Awaited<ReturnType<SystemCleanupService['status']>>> {
    const start = Date.now();
    for (;;) {
      const status = await service.status(runId);
      if (status && ['completed', 'cancelled', 'failed'].includes(status.phase)) {
        return status;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('Quá thời gian chờ trạng thái kết thúc.');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it('scans real files under the fake environment and reports the exact byte total', async () => {
    await writeFile(join(env.tempDir, 'a.tmp'), Buffer.alloc(1000));
    await writeFile(join(env.tempDir, 'b.tmp'), Buffer.alloc(2000));

    const service = makeService();
    const started = await service.start({ mode: 'estimate', categories: ['userTemp'] });
    const finished = await waitForTerminal(service, started.runId);

    expect(finished?.phase).toBe('completed');
    expect(finished?.estimatedBytes).toBe(3000);
    expect(finished?.safeToDeleteBytes).toBe(3000);
    expect(finished?.removedBytes).toBe(0);
  });

  it('never removes anything — mode "clean" is rejected outright in GĐ4a', async () => {
    const service = makeService();
    await expect(service.start({ mode: 'clean', categories: ['userTemp'] })).rejects.toThrow(/Giai đoạn 4b/);
  });

  it('rejects a second run while one is still active', async () => {
    await writeFile(join(env.tempDir, 'big.tmp'), Buffer.alloc(5000));
    const service = makeService();

    const first = await service.start({ mode: 'estimate', categories: ['userTemp'] });
    expect(service.isActive()).toBe(true);

    await expect(service.start({ mode: 'estimate', categories: ['userTemp'] })).rejects.toThrow(/đang chạy/);

    await waitForTerminal(service, first.runId);
    expect(service.isActive()).toBe(false);
  });

  it('cancel() stops the run and leaves it in the cancelled phase', async () => {
    await writeFile(join(env.tempDir, 'c.tmp'), Buffer.alloc(100));

    const service = makeService();
    const started = await service.start({
      mode: 'estimate',
      categories: ['userTemp', 'browserCache', 'capcutCache', 'zaloCache']
    });

    await service.cancel(started.runId);
    const finished = await waitForTerminal(service, started.runId);

    expect(finished?.phase).toBe('cancelled');
  });

  it('only counts Tubmedia residue files that carry the ownership marker and match the naming rules', async () => {
    const tempRoot = join(sandbox, 'project-temp');
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, '.tubmedia-owned.json'), JSON.stringify({ owner: 'Tubmedia', version: 1 }));

    const oldFile = join(tempRoot, 'clip-1-abc.mp4');
    await writeFile(oldFile, Buffer.alloc(4096));
    const { utimes } = await import('node:fs/promises');
    await utimes(oldFile, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));

    const service = new SystemCleanupService(
      () => ({
        sourceFolders: [],
        tempFolders: [tempRoot],
        trackedTempFiles: [],
        quickOutputFolders: [],
        quickTempRoots: []
      }),
      () => env
    );

    const started = await service.start({ mode: 'estimate', categories: ['tubmediaResidue'] });
    const finished = await waitForTerminal(service, started.runId);

    expect(finished?.estimatedBytes).toBe(4096);
    expect(finished?.findings.every((f) => f.classification === 'safe-to-delete')).toBe(true);
  });
});
