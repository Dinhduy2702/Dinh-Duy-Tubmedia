import type { MediaInfo } from '../types/domain.js';

export interface NormalizationTargetLike {
  width: number;
  height: number;
  fps: number;
  hdr: boolean;
  colorTransfer?: string | null;
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

function displayAspectRatioMatches(dar: string | null | undefined, width: number, height: number): boolean {
  if (!dar || dar === '0:1' || dar.toUpperCase() === 'N/A' || height <= 0) return true;
  const parts = dar.split(':').map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[0]! <= 0 || parts[1]! <= 0) {
    return true;
  }
  return Math.abs(parts[0]! / parts[1]! - width / height) < 0.02;
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
  const hdrTransferMatches =
    !target.hdr ||
    !target.colorTransfer ||
    (source.colorTransfer ?? '').toLowerCase() === target.colorTransfer.toLowerCase();
  const videoMatches =
    source.width === target.width &&
    source.height === target.height &&
    Math.abs(source.fps - target.fps) < 0.01 &&
    !source.variableFrameRate &&
    videoCodecMatches(source.videoCodec, target.videoCodec) &&
    source.pixelFormat === target.pixelFormat &&
    source.hdr === target.hdr &&
    hdrTransferMatches &&
    (source.rotation ?? 0) === 0 &&
    (!source.sampleAspectRatio || source.sampleAspectRatio === '1:1') &&
    displayAspectRatioMatches(source.displayAspectRatio, target.width, target.height);
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
