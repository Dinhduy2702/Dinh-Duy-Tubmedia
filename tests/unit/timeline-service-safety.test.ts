import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelineService } from '../../src/main/merge/timeline-service.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { MediaInfo } from '../../src/shared/types/domain.js';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))
  );
});

function mediaInfo(duration: number): MediaInfo {
  return {
    duration,
    width: 1280,
    height: 720,
    fps: 30,
    videoCodec: 'h264',
    videoProfile: 'High',
    videoLevel: '4.0',
    pixelFormat: 'yuv420p',
    bitDepth: 8,
    timeBase: '1/90000',
    nominalFps: 30,
    variableFrameRate: false,
    sampleAspectRatio: '1:1',
    displayAspectRatio: '16:9',
    rotation: 0,
    streamStartTime: 0,
    timestampCondition: 'normal',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorSpace: 'bt709',
    colorRange: 'tv',
    hdr: false,
    hdrType: null,
    masteringDisplayMetadata: false,
    audioCodec: 'aac',
    videoBitrate: 2_000_000,
    audioBitrate: 128_000,
    sampleRate: 48_000,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    fileSize: 1_000_000
  };
}

describe('TimelineService file safety', () => {
  it('preserves an existing user timeline and writes a non-conflicting file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-timeline-'));
    folders.push(folder);
    const existing = join(folder, 'Thanh pham.timeline.txt');
    await writeFile(existing, 'user timeline', 'utf8');

    const analyzer = {
      analyze: (path: string) =>
        Promise.resolve(mediaInfo(path.endsWith('a.mp4') ? 2 : 3))
    } as unknown as MediaAnalyzer;
    const service = new TimelineService(analyzer);

    const result = await service.write(
      [
        { path: join(folder, 'a.mp4'), label: 'A', note: '' },
        { path: join(folder, 'b.mp4'), label: 'B', note: '' }
      ],
      folder,
      'Thanh pham',
      true
    );

    expect(result.txt).toBe(join(folder, 'Thanh pham.timeline (2).txt'));
    expect(await readFile(existing, 'utf8')).toBe('user timeline');
    expect(await readFile(result.txt!, 'utf8')).toContain('00:02 Ph Video_002');
    expect(result.totalDuration).toBe(5);
  });
});
