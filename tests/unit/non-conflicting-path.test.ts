import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitFileWithoutOverwrite, nonConflictingPath } from '../../src/main/files/non-conflicting-path.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

describe('nonConflictingPath', () => {
  it('never selects an existing user file for replacement', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-path-'));
    folders.push(folder);
    const desired = join(folder, 'video.mp4');
    await writeFile(desired, 'user-file');
    expect(await nonConflictingPath(desired)).toBe(join(folder, 'video (2).mp4'));
    await writeFile(join(folder, 'video (2).mp4'), 'another-file');
    expect(await nonConflictingPath(desired)).toBe(join(folder, 'video (3).mp4'));
  });

  it('commits a pending file without overwriting an existing destination', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-commit-'));
    folders.push(folder);
    const desired = join(folder, 'video.mp4');
    const pending = join(folder, 'video.pending.mp4');
    await writeFile(desired, 'user-file');
    await writeFile(pending, 'verified-output');

    const committed = await commitFileWithoutOverwrite(pending, desired);

    expect(committed).toBe(join(folder, 'video (2).mp4'));
    expect(await readFile(desired, 'utf8')).toBe('user-file');
    expect(await readFile(committed, 'utf8')).toBe('verified-output');
  });

});
