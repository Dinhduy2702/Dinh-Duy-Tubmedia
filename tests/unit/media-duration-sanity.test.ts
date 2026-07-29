import { describe, expect, it } from 'vitest';
import { selectMediaDuration } from '../../src/main/media/media-analyzer.js';

describe('selectMediaDuration', () => {
  it('rejects a wildly inflated MP4 container duration', () => {
    expect(selectMediaDuration(
      { duration: '1507876.93' },
      { duration: '4004.15' },
      undefined
    )).toBeCloseTo(4004.15, 5);
  });

  it('keeps a normal container duration when it is close to the video stream', () => {
    expect(selectMediaDuration(
      { duration: '4004.18' },
      { duration: '4004.15' },
      { duration: '4004.17' }
    )).toBeCloseTo(4004.18, 5);
  });

  it('falls back to duration_ts multiplied by time_base', () => {
    expect(selectMediaDuration(
      undefined,
      { duration_ts: '120000', time_base: '1/30000' },
      undefined
    )).toBeCloseTo(4, 5);
  });
});
