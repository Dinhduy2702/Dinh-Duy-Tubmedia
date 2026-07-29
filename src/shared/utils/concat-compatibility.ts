import type { MediaInfo } from '../types/domain.js';

export interface ConcatCompatibility {
  compatible: boolean;
  reasons: string[];
  advisories: string[];
}

/**
 * Compare stream properties that must be stable for FFmpeg concat stream-copy.
 *
 * videoProfile/videoLevel are intentionally not blockers. They describe decoder
 * capabilities, not a geometry/timing/layout change by themselves.
 *
 * timeBase and channelLayout labels are advisory instead of hard blockers:
 * - MP4/FFmpeg commonly rewrites timestamps at the concat boundary.
 * - encoders often omit or spell the same stereo layout differently while the
 *   actual codec/sample-rate/channel-count remains identical.
 *
 * Treating those metadata fields as fatal caused Tubmedia to transcode every
 * clip even when the encoded streams were otherwise compatible.
 */
export function compareForConcat(
  reference: MediaInfo,
  candidate: MediaInfo
): ConcatCompatibility {
  const reasons: string[] = [];
  const advisories: string[] = [];
  const fields: Array<[string, unknown, unknown]> = [
    ['Codec video', reference.videoCodec, candidate.videoCodec],
    ['Chiều rộng', reference.width, candidate.width],
    ['Chiều cao', reference.height, candidate.height],
    ['FPS', Math.round(reference.fps * 1000), Math.round(candidate.fps * 1000)],
    ['Pixel format', reference.pixelFormat, candidate.pixelFormat],
    ['HDR', reference.hdr, candidate.hdr],
    ['Loại HDR', reference.hdrType ?? null, candidate.hdrType ?? null],
    ['SAR', reference.sampleAspectRatio ?? null, candidate.sampleAspectRatio ?? null],
    ['DAR', reference.displayAspectRatio ?? null, candidate.displayAspectRatio ?? null],
    ['Rotation', reference.rotation ?? 0, candidate.rotation ?? 0],
    ['VFR', reference.variableFrameRate ?? false, candidate.variableFrameRate ?? false],
    ['Codec audio', reference.audioCodec, candidate.audioCodec],
    ['Sample rate', reference.sampleRate, candidate.sampleRate],
    ['Số kênh', reference.channels, candidate.channels]
  ];
  for (const [name, a, b] of fields) {
    if (a !== b) reasons.push(`${name}: ${String(a)} ≠ ${String(b)}`);
  }

  if (reference.timeBase !== candidate.timeBase) {
    advisories.push(`Time base: ${String(reference.timeBase)} ≠ ${String(candidate.timeBase)}`);
  }
  if (reference.channelLayout !== candidate.channelLayout) {
    advisories.push(
      `Channel layout: ${String(reference.channelLayout)} ≠ ${String(candidate.channelLayout)}`
    );
  }

  return { compatible: reasons.length === 0, reasons, advisories };
}
