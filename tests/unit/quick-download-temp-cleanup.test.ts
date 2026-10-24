import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Thư mục tạm riêng cho bài kiểm — KHÔNG dùng %TEMP%\TubmediaQD thật (dùng chung với Tubmedia đang cài trên máy).
const fakeTemp = mkdtempSync(join(tmpdir(), 'tubmedia-quick-temp-sweep-'));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => fakeTemp) },
  shell: { showItemInFolder: vi.fn() }
}));

import { QUICK_TEMP_ORPHAN_AFTER_MS, QuickDownloadService } from '../../src/main/download/quick-download-service.js';

afterAll(() => rmSync(fakeTemp, { recursive: true, force: true }));

// 2026-10-24 (người dùng yêu cầu): Tải nhanh tự dọn thư mục tạm khi lỗi, và thư mục còn sót khi app tắt đột ngột.

function service(): QuickDownloadService {
  return new QuickDownloadService(
    {} as never,
    {} as never,
    {} as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    join(fakeTemp, 'state')
  );
}

const folderWithFile = (name: string, ageMs: number): string => {
  const folder = join(fakeTemp, 'TubmediaQD', name);
  mkdirSync(join(folder, 'con'), { recursive: true });
  const file = join(folder, 'con', 'video.mp4.part');
  writeFileSync(file, 'x');
  const when = new Date(Date.now() - ageMs);
  utimesSync(file, when, when);
  return folder;
};

describe('Tải nhanh — dọn thư mục tạm còn sót', () => {
  it('khi mở app: xoá thư mục không được ghi thêm quá 1 giờ; giữ thư mục vừa ghi (có thể của Tubmedia khác đang tải)', async () => {
    const orphan = folderWithFile('aaaaaaaaaaaa', QUICK_TEMP_ORPHAN_AFTER_MS + 60_000);
    const fresh = folderWithFile('bbbbbbbbbbbb', 30_000);
    expect(await service().sweepOrphanTemp()).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('recover() khi mở app có chạy bước dọn', async () => {
    const orphan = folderWithFile('cccccccccccc', QUICK_TEMP_ORPHAN_AFTER_MS + 60_000);
    await service().recover();
    expect(existsSync(orphan)).toBe(false);
  });

  it('lỗi tải (không phải đóng app) giờ xoá thư mục tạm của lượt đó', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/main/download/quick-download-service.ts', 'utf8');
    const genericFailure = source.indexOf("this.failTask(active, error instanceof Error ? error.message : String(error), null);");
    expect(genericFailure).toBeGreaterThan(0);
    expect(source.slice(genericFailure, genericFailure + 300)).toContain('await this.cleanupActive(active, true);');
    const cookieFailure = source.indexOf('this.failTask(active, cookieFailureMessage(cookieCode), cookieCode);');
    expect(source.slice(cookieFailure, cookieFailure + 300)).toContain('await this.cleanupActive(active, true);');
  });
});
