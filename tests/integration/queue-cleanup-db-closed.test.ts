import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { QueueManager } from '@main/queue/queue-manager.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '@main/settings/defaults.js';

// 1.7.6 việc D (rà promise "void" không bắt lỗi): syncProjectStatus gọi `void this.cleanupProjectTemporaryArtifacts(…)`
// (queue-manager.ts:1842/1848) nhưng hàm đó đọc CSDL (this.projects.get) NGOÀI khối try — CSDL vừa đóng lúc tắt app thì
// lời gọi bị từ chối và thành unhandled rejection (cùng loại lỗi làm lượt phát hành 1.7.4 đầu tiên trượt).

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('dọn tệp tạm của danh sách khi CSDL đã đóng', () => {
  it('không ném lỗi ra ngoài (không thành unhandled rejection), chỉ ghi nhật ký cảnh báo', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tubmedia-cleanup-db-closed-'));
    folders.push(folder);
    const database = new AppDatabase(join(folder, 'db.sqlite'));
    const projects = new ProjectRepository(database.db);
    const project = projects.create({
      name: 'TH210',
      sourceFolder: join(folder, 'nguon'),
      tempFolder: join(folder, 'tam'),
      outputFolder: join(folder, 'thanh-pham'),
      finalFileName: 'TH210',
      qualityProfileId: builtInQualityProfiles[0]!.id,
      resourceProfileId: builtInResourceProfiles[0]!.id
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const manager = new QueueManager(
      new QueueRepository(database.db),
      projects,
      new ItemRepository(database.db),
      new MediaSourceRepository(database.db),
      { get: () => defaultAppSettings, profiles: () => ({ qualities: builtInQualityProfiles, resources: builtInResourceProfiles }) } as never,
      { run: vi.fn() } as never,
      {} as never,
      {} as never,
      { pauseByJob: vi.fn(() => Promise.resolve()) } as never,
      logger as never
    );
    // Tắt app: CSDL đóng trước khi việc dọn chạy nền kịp đọc dự án.
    database.close();

    const cleanup = (manager as unknown as { cleanupProjectTemporaryArtifacts: (id: string) => Promise<void> })
      .cleanupProjectTemporaryArtifacts(project.id);

    await expect(cleanup, 'lỗi đọc CSDL phải được bắt bên trong').resolves.toBeUndefined();
    expect(logger.warn.mock.calls.some((call) => call[1] === 'TEMPORARY_ARTIFACTS_CLEANUP_WARNING')).toBe(true);
    // Lần dọn sau (khi app mở lại) không bị khoá vì cờ "đang dọn" bị bỏ sót.
    expect((manager as unknown as { cleanupInProgress: Set<string> }).cleanupInProgress.has(project.id)).toBe(false);
  });
});
