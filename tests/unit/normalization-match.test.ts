import { describe, expect, it } from 'vitest';
import { matchNormalizationTarget } from '../../src/shared/utils/normalization-match.js';
import type { MediaInfo } from '../../src/shared/types/domain.js';

const source: MediaInfo = {
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
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
  sampleRate: 44100,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 1000
};

const target = {
  width: 1920,
  height: 1080,
  fps: 30,
  hdr: false,
  videoCodec: 'h264' as const,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac' as const,
  sampleRate: 48000,
  channels: 2
};

describe('normalization stream matching', () => {
  it('copies video byte-for-byte when only the audio sample rate differs', () => {
    expect(matchNormalizationTarget(source, target)).toMatchObject({
      videoMatches: true,
      audioMatches: false,
      videoCopy: true,
      audioCopy: false
    });
  });

  it('copies compatible audio when only video needs scaling', () => {
    expect(matchNormalizationTarget(
      { ...source, width: 2560, height: 1440, sampleRate: 48000 },
      target
    )).toMatchObject({
      videoMatches: false,
      audioMatches: true,
      videoCopy: false,
      audioCopy: true
    });
  });

  it('keeps video copy and adds silent audio when the source has no audio', () => {
    expect(matchNormalizationTarget(
      { ...source, audioCodec: null, audioBitrate: null, sampleRate: null, channels: null, channelLayout: null },
      target
    )).toMatchObject({
      videoCopy: true,
      audioCopy: false,
      addSilentAudio: true
    });
  });
});
