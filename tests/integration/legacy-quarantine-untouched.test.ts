import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureTubmediaOwnedDirectory } from '@main/files/file-ownership.js';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

type SyncAccess = { syncProjectStatus: (projectId: string) => void };

let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

// Mục 5 (2026-10-02), ý 4 + B2: thư mục _quarantine cũ (trong thư mục thành phẩm hoặc thư mục tạm) không bị
// di chuyển, không bị xóa — kể cả phần bên trong có dấu sở hữu mà hàm dọn tạm vẫn coi là "của Tubmedia".
describe('danh sách hoàn tất/lỗi: không đụng thư mục _quarantine cũ', () => {
  it.each(['completed', 'failed'] as const)('danh sách %s: mọi thứ trong <thành phẩm>\\_quarantine vẫn còn', async (status) => {
    harness = createQueueHarness();
    const legacy = join(harness.project.outputFolder, '_quarantine');
    const owned = join(legacy, '_normalized');
    mkdirSync(owned, { recursive: true });
    await ensureTubmediaOwnedDirectory(owned, 'legacy-normalized');
    const kept = join(owned, 'ban-cu.mp4');
    writeFileSync(kept, 'x');
    const loose = join(legacy, '1786352649948-6ff59155-Duy.pending.mp4');
    writeFileSync(loose, 'x');
    harness.jobIn(status, status === 'failed' ? { errorCode: 'DOWNLOAD_FAILED', errorMessage: 'lỗi' } : {});

    (harness.manager as unknown as SyncAccess).syncProjectStatus(harness.project.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(existsSync(kept)).toBe(true);
    expect(existsSync(loose)).toBe(true);
  });
});
