import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineService } from '../../src/main/merge/timeline-service.js';

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('merge timeline outputs', () => {
  it('keeps timeline rows for the UI without creating auxiliary files by default', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-timeline-'));
    temporaryFolders.push(folder);
    const analyze = vi.fn()
      .mockResolvedValueOnce({ duration: 12.5 })
      .mockResolvedValueOnce({ duration: 7.5 });
    const service = new TimelineService({ analyze } as never);

    const result = await service.write(
      [
        { path: 'one.mp4', label: 'Video một', note: 'mở đầu' },
        { path: 'two.mp4', label: 'Video hai', note: '' }
      ],
      folder,
      'San_pham_01',
      false
    );

    expect(result.txt).toBeNull();
    expect(result.totalDuration).toBe(20);
    expect(result.itemCount).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ index: 1, code: '00:00 Ph Video_001', label: 'Video một' });
    expect(result.rows[1]).toMatchObject({ index: 2, code: '00:12 Ph Video_002', start: 12.5 });
    expect(await readdir(folder)).toEqual([]);
  });

  it('creates only timeline.txt when the user explicitly enables export', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-timeline-'));
    temporaryFolders.push(folder);
    const analyze = vi.fn()
      .mockResolvedValueOnce({ duration: 12.5 })
      .mockResolvedValueOnce({ duration: 7.5 });
    const service = new TimelineService({ analyze } as never);

    const result = await service.write(
      [
        { path: 'one.mp4', label: 'Video một', note: 'mở đầu' },
        { path: 'two.mp4', label: 'Video hai', note: '' }
      ],
      folder,
      'San_pham_01',
      true
    );

    expect(result.txt).toBe(join(folder, 'San_pham_01.timeline.txt'));
    expect(await readFile(result.txt!, 'utf8')).toBe(
      '00:00 Ph Video_001\r\n00:12 Ph Video_002'
    );
    expect(await readdir(folder)).toEqual(['San_pham_01.timeline.txt']);
  });
});
