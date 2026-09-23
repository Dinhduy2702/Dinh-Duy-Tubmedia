import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemCleanupService } from '../../src/main/system/system-cleanup-service.js';
import { QuarantineStore } from '../../src/main/system/cleanup-quarantine.js';
import type { CleanupEnvironmentPaths } from '../../src/main/system/cleanup-scanner.js';

// Toàn bộ bài kiểm này chạy trên một sandbox riêng dưới os.tmpdir() — SystemCleanupService nhận
// CleanupEnvironmentPaths, TubmediaCleanupRoots và QuarantineStore GIẢ (đều trỏ vào sandbox) qua
// constructor, nên không bao giờ đọc/ghi %TEMP%/%LOCALAPPDATA%/%APPDATA%/userData THẬT của máy đang
// chạy test này. GĐ4b: quarantineStore trỏ vào một thư mục cách ly RIÊNG trong cùng sandbox.

describe('SystemCleanupService', () => {
  let sandbox = '';
  let env: CleanupEnvironmentPaths;
  let quarantine: QuarantineStore;

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
    quarantine = new QuarantineStore(join(sandbox, 'quarantine'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  function makeService(rootsOverride?: ConstructorParameters<typeof SystemCleanupService>[0]): SystemCleanupService {
    return new SystemCleanupService(
      rootsOverride ??
        (() => ({
          sourceFolders: [],
          tempFolders: [],
          trackedTempFiles: [],
          quickOutputFolders: [],
          quickTempRoots: []
        })),
      () => env,
      quarantine
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

  describe('GĐ4a — quét (mode estimate), không xóa gì', () => {
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

      // Quét (estimate) không bao giờ đụng tới file thật — vẫn còn nguyên tại chỗ.
      expect(existsSync(join(env.tempDir, 'a.tmp'))).toBe(true);
      expect(existsSync(join(env.tempDir, 'b.tmp'))).toBe(true);
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
      await utimes(
        oldFile,
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      );

      const service = makeService(() => ({
        sourceFolders: [],
        tempFolders: [tempRoot],
        trackedTempFiles: [],
        quickOutputFolders: [],
        quickTempRoots: []
      }));

      const started = await service.start({ mode: 'estimate', categories: ['tubmediaResidue'] });
      const finished = await waitForTerminal(service, started.runId);

      expect(finished?.estimatedBytes).toBe(4096);
      expect(finished?.findings.every((f) => f.classification === 'safe-to-delete')).toBe(true);
      expect(existsSync(oldFile)).toBe(true);
    });
  });

  describe('GĐ4b — xóa thật (mode clean) qua cách ly, có hoàn tác', () => {
    it('quarantines real matching files: originals disappear, quarantine holds the exact bytes, manifest records them', async () => {
      const fileA = join(env.tempDir, 'a.tmp');
      const fileB = join(env.tempDir, 'b.tmp');
      await writeFile(fileA, Buffer.alloc(1000));
      await writeFile(fileB, Buffer.alloc(2000));

      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['userTemp'] });
      const finished = await waitForTerminal(service, started.runId);

      expect(finished?.phase).toBe('completed');
      expect(finished?.removedBytes).toBe(3000);
      expect(finished?.removedItems).toBe(2);
      expect(finished?.skippedItems).toBe(0);

      // File gốc không còn tại vị trí cũ.
      expect(existsSync(fileA)).toBe(false);
      expect(existsSync(fileB)).toBe(false);

      // Khu cách ly có đúng 2 mục, đúng đường dẫn gốc, đúng dung lượng, có hạn hoàn tác trong tương lai.
      const active = await quarantine.listActive();
      expect(active).toHaveLength(2);
      const paths = active.map((entry) => entry.originalPath).sort();
      expect(paths).toEqual([fileA, fileB].sort());
      for (const entry of active) {
        expect(new Date(entry.expiresAt).getTime()).toBeGreaterThan(Date.now());
        expect(entry.restoredAt).toBeNull();
        const quarantinedContent = await stat(join(sandbox, 'quarantine', 'files', entry.id));
        expect(quarantinedContent.size).toBe(entry.bytes);
      }
    });

    it('restore() puts a quarantined file back at its exact original path with identical content', async () => {
      const original = join(env.tempDir, 'restore-me.tmp');
      await writeFile(original, Buffer.from('nội dung thật cần giữ nguyên'));

      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['userTemp'] });
      await waitForTerminal(service, started.runId);

      const [entry] = await quarantine.listActive();
      expect(entry).toBeDefined();
      expect(existsSync(original)).toBe(false);

      const outcomes = await quarantine.restore([entry!.id]);
      expect(outcomes).toEqual([{ id: entry!.id, ok: true, restoredPath: original }]);
      expect(existsSync(original)).toBe(true);
      expect((await readFile(original, 'utf8'))).toBe('nội dung thật cần giữ nguyên');
      expect(await quarantine.listActive()).toHaveLength(0);
    });

    it('restore() never overwrites a file that now exists at the original path — picks a safe alternate name', async () => {
      const original = join(env.tempDir, 'conflict.tmp');
      await writeFile(original, Buffer.from('bản gốc bị dọn'));

      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['userTemp'] });
      await waitForTerminal(service, started.runId);
      expect(existsSync(original)).toBe(false);

      // Một file MỚI, không liên quan, xuất hiện đúng tại vị trí cũ trước khi người dùng hoàn tác.
      await writeFile(original, Buffer.from('file mới của người dùng — TUYỆT ĐỐI không được ghi đè'));

      const [entry] = await quarantine.listActive();
      const outcomes = await quarantine.restore([entry!.id]);

      expect(outcomes[0]?.ok).toBe(true);
      expect(outcomes[0]?.restoredPath).not.toBe(original);
      // File mới của người dùng vẫn nguyên vẹn.
      expect(await readFile(original, 'utf8')).toBe('file mới của người dùng — TUYỆT ĐỐI không được ghi đè');
      // Bản khôi phục nằm ở một tên khác, nội dung đúng bản gốc đã cách ly.
      expect(await readFile(outcomes[0]!.restoredPath!, 'utf8')).toBe('bản gốc bị dọn');
    });

    it('never removes anything for categories with no matching files (removedItems stays 0)', async () => {
      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['thumbnailCache'] });
      const finished = await waitForTerminal(service, started.runId);

      expect(finished?.phase).toBe('completed');
      expect(finished?.removedItems).toBe(0);
      expect(finished?.removedBytes).toBe(0);
    });

    it('cancelling a clean run stops further quarantining but keeps already-quarantined files quarantined (never half-moved)', async () => {
      for (let i = 0; i < 20; i += 1) {
        await writeFile(join(env.tempDir, `f${i}.tmp`), Buffer.alloc(10));
      }

      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['userTemp'] });
      await service.cancel(started.runId);
      const finished = await waitForTerminal(service, started.runId);

      expect(finished?.phase).toBe('cancelled');

      const active = await quarantine.listActive();
      // Mỗi mục đã cách ly phải TOÀN VẸN: hoặc còn nguyên ở gốc, hoặc nằm trọn trong khu cách ly —
      // không bao giờ vừa mất ở gốc vừa không có trong khu cách ly.
      for (const entry of active) {
        expect(existsSync(join(sandbox, 'quarantine', 'files', entry.id))).toBe(true);
        expect(existsSync(entry.originalPath)).toBe(false);
      }
      expect(finished!.removedItems).toBe(active.length);
    });

    it('re-verifies safety at delete time: quarantineFile() itself refuses a real system path even if somehow reached', async () => {
      // Không đi qua vòng quét category thật (vì categoryTargets không bao giờ trỏ ra ngoài phạm vi) —
      // kiểm trực tiếp lớp phòng thủ cuối cùng mà runClean() luôn gọi trước khi cách ly bất kỳ file nào.
      const outcome = await quarantine.quarantineFile(
        process.env.WINDIR ?? 'C:\\Windows',
        'userTemp',
        'test-run'
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toMatch(/quá rộng\/nguy hiểm|gốc ổ đĩa/);
      }
      // Không đụng gì tới hệ thống thật — chắc chắn không có file nào bị tạo/xóa vì lời gọi này.
      expect(existsSync(process.env.WINDIR ?? 'C:\\Windows')).toBe(true);
    });

    it('quarantineFile() refuses a symlink, leaving both the link and its target untouched', async () => {
      const targetFile = join(sandbox, 'canary.txt');
      await writeFile(targetFile, 'không được đụng vào');
      const linkPath = join(env.tempDir, 'link-to-canary.tmp');

      try {
        const { symlink } = await import('node:fs/promises');
        await symlink(targetFile, linkPath);
      } catch {
        return; // Máy không cho tạo symlink không có quyền — bỏ qua bài kiểm này an toàn.
      }

      const outcome = await quarantine.quarantineFile(linkPath, 'userTemp', 'test-run');
      expect(outcome.ok).toBe(false);
      expect(existsSync(targetFile)).toBe(true);
      expect(await readFile(targetFile, 'utf8')).toBe('không được đụng vào');
    });
  });

  describe('QuarantineStore.purgeExpired()', () => {
    it('permanently deletes only entries past their retention window, leaves active ones intact', async () => {
      const fileOld = join(env.tempDir, 'old.tmp');
      const fileNew = join(env.tempDir, 'new.tmp');
      await writeFile(fileOld, Buffer.alloc(50));
      await writeFile(fileNew, Buffer.alloc(50));

      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['userTemp'] });
      await waitForTerminal(service, started.runId);

      const active = await quarantine.listActive();
      expect(active).toHaveLength(2);
      const entryOld = active.find((entry) => entry.originalPath === fileOld)!;
      const entryNew = active.find((entry) => entry.originalPath === fileNew)!;

      // Sửa trực tiếp bảng ghi để mô phỏng "entryOld đã quá hạn cách ly", entryNew vẫn còn hạn — cách
      // xác định nhất để kiểm purgeExpired() chỉ xóa ĐÚNG mục đã quá hạn, không phụ thuộc thời gian
      // thực thi bài kiểm nhanh hay chậm.
      const manifestPath = join(sandbox, 'quarantine', 'manifest.json');
      const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as Array<{ id: string; expiresAt: string }>;
      const patched = raw.map((entry) =>
        entry.id === entryOld.id ? { ...entry, expiresAt: new Date(Date.now() - 1000).toISOString() } : entry
      );
      await writeFile(manifestPath, JSON.stringify(patched, null, 2), 'utf8');

      const result = await quarantine.purgeExpired(Date.now());
      expect(result.purged).toBe(1);

      const remaining = await quarantine.listActive();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(entryNew.id);

      expect(existsSync(join(sandbox, 'quarantine', 'files', entryOld.id))).toBe(false);
      expect(existsSync(join(sandbox, 'quarantine', 'files', entryNew.id))).toBe(true);
    });

    it('never purges a restored entry even if its retention window has passed', async () => {
      const original = join(env.tempDir, 'restored-then-old.tmp');
      await writeFile(original, Buffer.alloc(20));

      const service = makeService();
      const started = await service.start({ mode: 'clean', categories: ['userTemp'] });
      await waitForTerminal(service, started.runId);

      const [entry] = await quarantine.listActive();
      await quarantine.restore([entry!.id]);
      expect(existsSync(original)).toBe(true);

      const result = await quarantine.purgeExpired(Date.now() + 100 * 24 * 60 * 60 * 1000);
      expect(result.purged).toBe(0);
      // File đã hoàn tác không bị đụng tới bởi purge dù "quá hạn" trên giấy tờ.
      expect(existsSync(original)).toBe(true);
    });
  });
});
