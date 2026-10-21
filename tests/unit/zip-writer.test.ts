import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import safeExtractZip from '@tubmedia/safe-extract-zip';
import { buildZip } from '../../src/main/files/zip-writer.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('buildZip', () => {
  it('ra zip giải nén được bằng bộ giải nén an toàn (yauzl kiểm CRC + kích thước), giữ nguyên tên tiếng Việt và nội dung', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-zip-'));
    folders.push(folder);
    const big = Buffer.alloc(300_000, 7);
    const zip = buildZip([
      { name: 'tom-tat.txt', data: 'Nguồn #2 NA361_TA.mp4: HỎNG tiếng\n' },
      { name: 'nhat-ky/tác vụ.jsonl', data: '{"a":1}\n{"b":2}\n' },
      { name: 'trong.bin', data: Buffer.alloc(0) },
      { name: 'lon.bin', data: big }
    ]);
    const path = join(folder, 'bao-cao.zip');
    await writeFile(path, zip);
    const out = join(folder, 'out');
    await safeExtractZip(path, { dir: out });

    expect(await readFile(join(out, 'tom-tat.txt'), 'utf8')).toBe('Nguồn #2 NA361_TA.mp4: HỎNG tiếng\n');
    expect(await readFile(join(out, 'nhat-ky', 'tác vụ.jsonl'), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
    expect((await readFile(join(out, 'trong.bin'))).length).toBe(0);
    expect((await readFile(join(out, 'lon.bin'))).equals(big)).toBe(true);
    expect(zip.length, 'phải nén thật (deflate)').toBeLessThan(big.length / 10);
  });

  it('từ chối tên mục nguy hiểm hoặc trùng', () => {
    expect(() => buildZip([{ name: '../x.txt', data: '' }])).toThrow();
    expect(() => buildZip([{ name: 'C:/x.txt', data: '' }])).toThrow();
    expect(() => buildZip([{ name: 'a\\b.txt', data: '' }])).toThrow();
    expect(() => buildZip([{ name: 'a.txt', data: '' }, { name: 'a.txt', data: '' }])).toThrow();
  });
});
