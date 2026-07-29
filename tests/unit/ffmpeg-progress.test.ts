import { describe, expect, it } from 'vitest';
import { FfmpegProgressTracker } from '../../src/shared/utils/ffmpeg-progress.js';

describe('FFmpeg merge progress tracker', () => {
  it('reports real percent, speed, elapsed time and ETA', () => {
    let now = 10_000;
    const tracker = new FfmpegProgressTracker(100, () => now);
    expect(tracker.update('speed=2.00x')).toBeNull();
    expect(tracker.update('fps=120.0')).toBeNull();
    now = 15_000;
    const snapshot = tracker.update('out_time_ms=40000000');

    expect(snapshot).toMatchObject({
      percent: 40,
      processedSeconds: 40,
      totalSeconds: 100,
      speed: '2.00x · 120 fps',
      speedRatio: 2,
      fps: 120,
      etaSeconds: 30,
      elapsedSeconds: 5,
      finished: false
    });
  });

  it('finishes at 100 percent with a zero ETA', () => {
    const tracker = new FfmpegProgressTracker(30, () => 1_000);
    expect(tracker.update('progress=end')).toMatchObject({
      percent: 100,
      processedSeconds: 30,
      etaSeconds: 0,
      finished: true
    });
  });
});

it('keeps snapshots finite when FFmpeg metadata contains an invalid total duration', () => {
  const tracker = new FfmpegProgressTracker(Number.NaN, () => 1_000);
  const snapshot = tracker.update('out_time_ms=1000000');
  expect(snapshot?.percent).toBe(0);
  expect(snapshot?.processedSeconds).toBe(1);
  expect(snapshot?.totalSeconds).toBe(0);
  expect(Number.isFinite(snapshot?.percent ?? Number.NaN)).toBe(true);
});
