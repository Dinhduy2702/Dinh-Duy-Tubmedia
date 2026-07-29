import { describe, expect, it } from 'vitest';
import {
  chooseMergeTarget,
  sourceEquivalentVideoBitrate,
  validateMergeOutputSize
} from '../../src/shared/utils/merge-target.js';
import type { MediaInfo, QualityProfile } from '../../src/shared/types/domain.js';

const media = (width: number, height: number, fps: number): MediaInfo => ({
  duration: 10,
  width,
  height,
  fps,
  videoCodec: 'h264',
  videoProfile: null,
  videoLevel: null,
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  sampleRate: 48000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 1000
});

const profile = (mode: QualityProfile['mode']): QualityProfile => ({
  id: 'test',
  name: 'Test',
  description: '',
  mode,
  allowUpscale: false,
  maxWidth: null,
  maxHeight: null,
  fpsMode: 'source',
  customFps: null,
  videoCodec: 'copy',
  encoder: 'cpu_auto',
  crf: 18,
  cq: 20,
  preset: 'medium',
  pixelFormat: 'auto',
  hdrMode: 'auto',
  audioMode: 'copy_if_compatible',
  sampleRate: 48000,
  forceStereo: false,
  builtIn: false
});

describe('chooseMergeTarget', () => {
  it('keeps the largest real source canvas and the highest source FPS', () => {
    const target = chooseMergeTarget([media(1920, 1080, 30), media(3840, 2160, 60)], profile('smart_merge'));
    expect(target).toMatchObject({ width: 3840, height: 2160, fps: 60 });
  });

  it('keeps the dominant real source format instead of synthesizing an expensive mixed target', () => {
    const target = chooseMergeTarget([media(2560, 1440, 30), media(1080, 1920, 60)], profile('smart_merge'));
    expect(target).toMatchObject({ width: 2560, height: 1440, fps: 30 });
  });

  it('caps the compatibility profile inside 1080p without changing aspect ratio', () => {
    const target = chooseMergeTarget([media(3840, 2160, 60)], profile('compatible_1080p'));
    expect(target).toMatchObject({ width: 1920, height: 1080, fps: 60, hdr: false });
  });

  it('uses the duration-weighted bitrate derived from actual source sizes', () => {
    const first = { ...media(1920, 1080, 30), duration: 10, fileSize: 10_240_000, videoBitrate: 2_000_000 };
    const second = { ...media(1920, 1080, 30), duration: 30, fileSize: 60_720_000, videoBitrate: 3_000_000 };
    const target = chooseMergeTarget(
      [first, second],
      { ...profile('smart_merge'), bitrateMode: 'source_average' }
    );
    expect(sourceEquivalentVideoBitrate(first)).toBe(8_000_000);
    expect(sourceEquivalentVideoBitrate(second)).toBe(16_000_000);
    expect(target.videoBitrate).toBe(14_000_000);
  });

  it('blocks an unexpectedly tiny keep-size merge but allows normal mux variance', () => {
    const sources = [
      { ...media(1920, 1080, 30), fileSize: 300_000_000 },
      { ...media(1920, 1080, 30), fileSize: 220_000_000 }
    ];
    const keepSize = {
      ...profile('smart_merge'),
      bitrateMode: 'source_average' as const
    };

    const compressed = validateMergeOutputSize(
      sources,
      200_000_000,
      keepSize
    );
    expect(compressed.ok).toBe(false);
    expect(compressed.ratio).toBeCloseTo(0.3846, 3);
    expect(compressed.message).toContain('38%');

    expect(
      validateMergeOutputSize(sources, 500_000_000, keepSize).ok
    ).toBe(true);
  });

  it('does not impose the keep-size threshold on an explicit CRF profile', () => {
    const crfProfile = { ...profile('custom'), bitrateMode: 'quality' as const };
    expect(
      validateMergeOutputSize(
        [{ ...media(1920, 1080, 30), fileSize: 500_000_000 }],
        180_000_000,
        crfProfile
      ).ok
    ).toBe(true);
  });
});
