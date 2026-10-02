import { existsSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTemporaryArtifacts } from '../../src/main/files/temporary-cleanup.js';
import { ensureTubmediaOwnedDirectory } from '../../src/main/files/file-ownership.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-protect-'));
  folders.push(folder);
  return folder;
}

describe('dọn tạm: không bao giờ xóa thư mục người dùng đã chọn', () => {
  it('thư mục tạm người dùng chọn tên _yt_tmp, có dấu sở hữu: không xóa nó, không xóa tệp của người dùng bên trong', async () => {
    const drive = await scratch();
    const temp = join(drive, '_yt_tmp');
    await mkdir(temp);
    await ensureTubmediaOwnedDirectory(temp, 'download-temp');
    const mine = join(temp, 'ghi-chu-cua-toi.txt');
    await writeFile(mine, 'x');

    await cleanupTemporaryArtifacts(temp, [], false, { protectedFolders: [temp] });

    expect(existsSync(temp)).toBe(true);
    expect(existsSync(mine)).toBe(true);
  });

  it('thư mục thành phẩm người dùng chọn nằm trong thư mục tạm và tên _normalized có dấu: không bị xóa', async () => {
    const temp = await scratch();
    const output = join(temp, '_normalized');
    await mkdir(output);
    await ensureTubmediaOwnedDirectory(output, 'legacy-normalized');
    await writeFile(join(output, 'thanh-pham.mp4'), 'x');

    await cleanupTemporaryArtifacts(temp, [], false, { protectedFolders: [temp, output] });

    expect(existsSync(join(output, 'thanh-pham.mp4'))).toBe(true);
  });
});

describe('dọn tạm: tệp do CSDL theo dõi chỉ bị xóa khi chắc chắn là tệp tạm của app', () => {
  it('không đi theo junction ra ngoài thư mục tạm', async () => {
    const root = await scratch();
    const temp = join(root, 'temp');
    const outside = join(root, 'ben-ngoai');
    await mkdir(temp);
    await mkdir(outside);
    const victim = join(outside, 'clip-1-abc.mp4');
    await writeFile(victim, 'tệp ngoài thư mục tạm');
    symlinkSync(outside, join(temp, 'loi-tat'), 'junction');

    await cleanupTemporaryArtifacts(temp, [join(temp, 'loi-tat', 'clip-1-abc.mp4')], false, { protectedFolders: [temp] });

    expect(existsSync(victim)).toBe(true);
  });

  it('tệp được theo dõi nhưng không mang tên tệp tạm của app: giữ nguyên', async () => {
    const temp = await scratch();
    const mine = join(temp, 'Video của tôi.mp4');
    await writeFile(mine, 'x');

    await cleanupTemporaryArtifacts(temp, [mine], false, { protectedFolders: [temp] });

    expect(existsSync(mine)).toBe(true);
  });

  it('tệp được theo dõi trùng một tệp thành phẩm: giữ nguyên', async () => {
    const temp = await scratch();
    const output = join(temp, 'clip-2-thanh-pham.mp4');
    await writeFile(output, 'x');

    await cleanupTemporaryArtifacts(temp, [output], false, { protectedFolders: [temp], protectedFiles: [output] });

    expect(existsSync(output)).toBe(true);
  });

  it('tệp tạm thật của app (clip-<n>-...mp4) trong thư mục tạm vẫn được dọn', async () => {
    const temp = await scratch();
    const clip = join(temp, 'clip-3-abc-def.mp4');
    await writeFile(clip, 'x');

    const report = await cleanupTemporaryArtifacts(temp, [clip], false, { protectedFolders: [temp] });

    expect(existsSync(clip)).toBe(false);
    expect(report.removedFiles).toBe(1);
  });
});
