import type { MediaInfo } from '../types/domain.js';

export interface NormalizationTargetLike {
  width: number;
  height: number;
  fps: number;
  hdr: boolean;
  videoCodec: 'h264' | 'hevc';
  pixelFormat: string;
  audioCodec: 'aac' | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface NormalizationMatch {
  videoMatches: boolean;
  audioMatches: boolean;
  videoCopy: boolean;
  audioCopy: boolean;
  addSilentAudio: boolean;
}

function videoCodecMatches(sourceCodec: string, targetCodec: NormalizationTargetLike['videoCodec']): boolean {
  return targetCodec === 'h264'
    ? sourceCodec === 'h264'
    : ['hevc', 'h265'].includes(sourceCodec);
}

/**
 * Decide stream-copy independently for video and audio.
 *
 * A merge target can differ only in audio properties. In that case re-encoding
 * the already-compatible video loses detail for no benefit, so the video
 * stream must be copied byte-for-byte.
 */
export function matchNormalizationTarget(
  source: MediaInfo,
  target: NormalizationTargetLike
): NormalizationMatch {
  const videoMatches =
    source.width === target.width &&
    source.height === target.height &&
    Math.abs(source.fps - target.fps) < 0.01 &&
    videoCodecMatches(source.videoCodec, target.videoCodec) &&
    source.pixelFormat === target.pixelFormat &&
    source.hdr === target.hdr &&
    (source.rotation ?? 0) === 0 &&
    (!source.sampleAspectRatio || source.sampleAspectRatio === '1:1');
  const audioMatches =
    source.audioCodec === target.audioCodec &&
    (target.audioCodec === null || source.sampleRate === target.sampleRate) &&
    (target.audioCodec === null || source.channels === target.channels);

  return {
    videoMatches,
    audioMatches,
    videoCopy: videoMatches,
    audioCopy: audioMatches && Boolean(source.audioCodec),
    addSilentAudio: Boolean(target.audioCodec) && !source.audioCodec
  };
}
