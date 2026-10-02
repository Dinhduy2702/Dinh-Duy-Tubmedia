import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureTubmediaOwnedDirectory } from '@main/files/file-ownership.js';
import { join } from 'node:path';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

type SyncAccess = { syncProjectStatus: (projectId: string) => void };

let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe('danh sách hoàn tất/lỗi/tạm dừng: dọn tạm không đụng thư mục của người dùng', () => {
  it.each(['completed', 'failed'] as const)(
    'danh sách %s với thư mục tạm là "Downloads": thư mục rỗng của người dùng vẫn còn',
    async (status) => {
      harness = createQueueHarness();
      const downloads = join(harness.folder, 'Downloads');
      const userEmpty = join(downloads, 'Thư mục rỗng của tôi');
      mkdirSync(userEmpty, { recursive: true });
      harness.projects.update(harness.project.id, { tempFolder: downloads });
      harness.jobIn(status, status === 'failed' ? { errorCode: 'DOWNLOAD_FAILED', errorMessage: 'lỗi' } : {});

      (harness.manager as unknown as SyncAccess).syncProjectStatus(harness.project.id);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(existsSync(userEmpty)).toBe(true);
      expect(existsSync(downloads)).toBe(true);
    }
  );

  it('"Tạm dừng" khi không có gì đang chạy (pause-noop) cũng không xóa thư mục của người dùng', async () => {
    harness = createQueueHarness();
    const downloads = join(harness.folder, 'Downloads');
    const userEmpty = join(downloads, 'rỗng');
    mkdirSync(userEmpty, { recursive: true });
    harness.projects.update(harness.project.id, { tempFolder: downloads });
    harness.jobIn('completed');

    await harness.manager.pauseProject(harness.project.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(existsSync(userEmpty)).toBe(true);
  });

  it('thư mục tạm người dùng chọn là E:\\_yt_tmp (có dấu sở hữu): danh sách hoàn tất không xóa tệp của người dùng bên trong', async () => {
    harness = createQueueHarness();
    const temp = join(harness.folder, '_yt_tmp');
    mkdirSync(temp, { recursive: true });
    await ensureTubmediaOwnedDirectory(temp, 'download-temp');
    const mine = join(temp, 'ghi-chu-cua-toi.txt');
    writeFileSync(mine, 'x');
    harness.projects.update(harness.project.id, { tempFolder: temp });
    harness.jobIn('completed');

    (harness.manager as unknown as SyncAccess).syncProjectStatus(harness.project.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(existsSync(mine)).toBe(true);
  });

  it('cả 4 nơi gọi dọn tạm đều truyền danh sách thư mục/tệp được bảo vệ', () => {
    const calls = [
      'src/main/queue/queue-manager.ts',
      'src/main/workbench/workbench-service.ts',
      'src/main/app/app-context.ts'
    ].flatMap((path) =>
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.includes('cleanupTemporaryArtifacts(') && !line.trimStart().startsWith('import'))
        .map((line) => `${path}: ${line.trim()}`)
    );
    // queue-manager: 3 lời gọi; workbench: 2 nút × 3; app-context: 1.
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const call of calls) expect(call).toContain('protection');
  });

  it('mọi nơi dọn tạm (hàng đợi, nút xóa danh sách, khởi động) đều đi qua cleanupTemporaryArtifacts', () => {
    for (const path of [
      'src/main/queue/queue-manager.ts',
      'src/main/workbench/workbench-service.ts',
      'src/main/app/app-context.ts'
    ]) {
      const text = readFileSync(path, 'utf8');
      expect(text, path).not.toMatch(/\brmdir\(/);
    }
  });
});
