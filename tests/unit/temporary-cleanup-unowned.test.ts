import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTemporaryArtifacts } from '../../src/main/files/temporary-cleanup.js';
import { ensureTubmediaOwnedDirectory } from '../../src/main/files/file-ownership.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

// Đợt 2 mục 4 (2026-10-02): 6 danh sách thật dùng C:\Users\<tên>\Downloads làm thư mục tạm. Hàm dọn trước đây
// rmdir MỌI thư mục rỗng khi duyệt cây — kể cả thư mục người dùng tự tạo và chính thư mục gốc.
describe('dọn thư mục tạm: không bao giờ xóa thư mục không do Tubmedia tạo', () => {
  it('giữ nguyên thư mục rỗng của người dùng (mọi cấp) trong thư mục tạm dùng chung', async () => {
    const downloads = await mkdtemp(join(tmpdir(), 'tubmedia-fake-downloads-'));
    folders.push(downloads);
    const userEmpty = join(downloads, 'Ảnh cũ');
    const userNestedEmpty = join(downloads, 'Dự án', 'chưa dùng');
    await mkdir(userEmpty);
    await mkdir(userNestedEmpty, { recursive: true });
    await writeFile(join(downloads, 'hoa-don.pdf'), 'x');

    await cleanupTemporaryArtifacts(downloads);

    expect(existsSync(userEmpty)).toBe(true);
    expect(existsSync(userNestedEmpty)).toBe(true);
    expect(existsSync(join(downloads, 'hoa-don.pdf'))).toBe(true);
  });

  it('không xóa chính thư mục tạm khi nó rỗng (ví dụ Downloads rỗng)', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'tubmedia-fake-profile-'));
    folders.push(parent);
    const downloads = join(parent, 'Downloads');
    await mkdir(downloads);

    const report = await cleanupTemporaryArtifacts(downloads);

    expect(existsSync(downloads)).toBe(true);
    expect(report.removedDirectories).toBe(0);
  });

  it('vẫn xóa thư mục dành riêng CÓ tệp đánh dấu của Tubmedia; giữ thư mục cùng tên nhưng không có dấu', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'tubmedia-fake-temp-'));
    folders.push(temp);
    const owned = join(temp, '_yt_tmp');
    await mkdir(owned);
    await ensureTubmediaOwnedDirectory(owned, 'download-temp');
    await mkdir(join(owned, 'rong'));
    await writeFile(join(owned, 'video.part'), 'x');
    const lookalike = join(temp, 'khac', '_normalized');
    await mkdir(lookalike, { recursive: true });

    await cleanupTemporaryArtifacts(temp);

    expect(existsSync(owned)).toBe(false);
    expect(existsSync(lookalike)).toBe(true);
    expect((await readdir(temp)).sort()).toEqual(['khac']);
  });
});
