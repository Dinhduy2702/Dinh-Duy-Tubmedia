import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTemporaryArtifacts,
  isTubmediaTemporaryFile
} from '../../src/main/files/temporary-cleanup.js';
import { ensureTubmediaOwnedDirectory } from '../../src/main/files/file-ownership.js';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('temporary artifact cleanup', () => {
  it('recognizes Tubmedia and yt-dlp residue', () => {
    expect(isTubmediaTemporaryFile('clip-2-abc-123.mp4')).toBe(true);
    expect(isTubmediaTemporaryFile('video.webm.part')).toBe(true);
    expect(isTubmediaTemporaryFile('video.ytdl')).toBe(true);
    expect(isTubmediaTemporaryFile('video.mp4.aria2')).toBe(true);
    expect(isTubmediaTemporaryFile('family-video.mp4')).toBe(false);
  });

  it('deletes only explicitly tracked files in a shared temp folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-clean-'));
    folders.push(folder);
    const nested = join(folder, 'nested');
    await mkdir(nested);
    const clip = join(folder, 'clip-1-project-item.mp4');
    await Promise.all([
      writeFile(clip, 'clip'),
      writeFile(join(folder, 'download.webm.part'), 'part'),
      writeFile(join(nested, 'fragment.ytdl'), 'state'),
      writeFile(join(folder, 'Giu-lai-cua-user.txt'), 'user')
    ]);

    const report = await cleanupTemporaryArtifacts(folder, [clip]);

    expect(report.removedFiles).toBe(1);
    expect((await readdir(folder)).sort()).toEqual(['Giu-lai-cua-user.txt', 'download.webm.part', 'nested']);
    expect(await readdir(nested)).toEqual(['fragment.ytdl']);
  });

  it('refuses to clean a filesystem root or a tracked file outside the temp folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-clean-'));
    folders.push(folder);
    const outside = await mkdtemp(join(tmpdir(), 'tubmedia-outside-'));
    folders.push(outside);
    const outsideFile = join(outside, 'clip-1-outside.mp4');
    await writeFile(outsideFile, 'keep');

    const report = await cleanupTemporaryArtifacts(folder, [outsideFile]);
    expect(report.skippedUnsafePaths).toBe(1);
    expect(await readdir(outside)).toEqual(['clip-1-outside.mp4']);

    const rootReport = await cleanupTemporaryArtifacts('/');
    expect(rootReport.skippedUnsafePaths).toBe(1);
  });
  it('removes normalized cache but retains quarantine evidence', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-clean-'));
    folders.push(folder);
    const normalized = join(folder, '_normalized');
    const quarantine = join(folder, '_quarantine');
    await mkdir(normalized);
    await ensureTubmediaOwnedDirectory(normalized, 'legacy-normalized');
    await mkdir(quarantine);
    await writeFile(join(normalized, 'Video_001.mp4'), 'normalized');
    await writeFile(join(quarantine, 'broken.pending.mp4'), 'broken');
    await writeFile(join(folder, 'Giu-lai.mp4'), 'user');

    const report = await cleanupTemporaryArtifacts(folder);

    expect(report.removedDirectories).toBeGreaterThanOrEqual(1);
    expect((await readdir(folder)).sort()).toEqual(['Giu-lai.mp4', '_quarantine']);
    expect(await readdir(quarantine)).toEqual(['broken.pending.mp4']);
  });


  it('does not delete a reserved-name directory without a valid ownership marker', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-clean-'));
    folders.push(folder);
    const normalized = join(folder, '_normalized');
    await mkdir(normalized);
    await writeFile(join(normalized, 'family-video.mp4'), 'user');

    const report = await cleanupTemporaryArtifacts(folder);

    expect(report.removedDirectories).toBe(0);
    expect(await readdir(normalized)).toEqual(['family-video.mp4']);
  });

  it('preserves all unowned residue on a failed merge when tracked clips must survive', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-clean-'));
    folders.push(folder);
    const clip = join(folder, 'clip-1-project-item.mp4');
    await writeFile(clip, 'clip');
    await writeFile(join(folder, 'concat-123e4567-e89b-12d3-a456-426614174000.txt'), 'list');
    await writeFile(join(folder, 'result.pending.mp4'), 'pending');

    const report = await cleanupTemporaryArtifacts(folder, [clip], true);

    expect(report.removedFiles).toBe(0);
    expect((await readdir(folder)).sort()).toEqual([
      'clip-1-project-item.mp4',
      'concat-123e4567-e89b-12d3-a456-426614174000.txt',
      'result.pending.mp4'
    ]);
  });

});
