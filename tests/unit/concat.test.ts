import { describe, expect, it } from 'vitest';
import { compareForConcat } from '@shared/utils/concat-compatibility.js';
import type { MediaInfo } from '@shared/types/domain.js';

const info: MediaInfo = {
  duration: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/30000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mp4',
  fileSize: 1
};

describe('concat compatibility', () => {
  it('accepts identical streams', () => {
    expect(compareForConcat(info, { ...info }).compatible).toBe(true);
  });

  it('reports blocking stream differences', () => {
    expect(compareForConcat(info, { ...info, fps: 60 }).reasons[0]).toContain('FPS');
  });

  /* TUBMEDIA STRICT CONCAT TEST CONTRACT R34 */
  it('rejects H.264 Main versus High profile/level changes before stream-copy', () => {
    const result = compareForConcat(info, {
      ...info,
      videoProfile: 'Main',
      videoLevel: '4.0'
    });
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('Profile video'))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('Level video'))).toBe(true);
  });
});
