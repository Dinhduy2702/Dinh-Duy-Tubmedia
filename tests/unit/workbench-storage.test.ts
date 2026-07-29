import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sizeFiles, sizePaths } from '../../src/main/storage/workbench-storage.js';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('workbench storage summary helpers', () => {
  it('counts unique downloaded files without double counting the same path', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-storage-'));
    folders.push(folder);
    const first = join(folder, 'one.mp4');
    const second = join(folder, 'two.mp4');
    await writeFile(first, Buffer.alloc(100));
    await writeFile(second, Buffer.alloc(250));

    await expect(sizeFiles([first, first, second])).resolves.toEqual({
      bytes: 350,
      fileCount: 2
    });
  });

  it('counts live temporary files recursively and ignores missing paths', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-storage-'));
    folders.push(folder);
    const nested = join(folder, '_normalized');
    await mkdir(nested);
    await writeFile(join(folder, 'video.part'), Buffer.alloc(80));
    await writeFile(join(nested, 'clip.pending.mp4'), Buffer.alloc(120));

    await expect(sizePaths([folder, join(folder, 'missing')])).resolves.toEqual({
      bytes: 200,
      fileCount: 2
    });
  });
});
