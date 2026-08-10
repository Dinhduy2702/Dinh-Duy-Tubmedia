import type { MediaInfo } from '../types/domain.js';

export interface ConcatCompatibility {
  compatible: boolean;
  reasons: string[];
  advisories: string[];
}

/**
 * Compare stream properties that must be stable for FFmpeg concat stream-copy.
 *
 * TUBMEDIA CONCAT SAFETY CONTRACT R34:
 * H.264/H.265 profile, level, bit depth, nominal FPS and color metadata are
 * blockers. Even when geometry and codec names match, changing decoder-critical
 * configuration at a concat boundary can produce local black/flicker/corruption
 * on some decoders. Tubmedia therefore normalizes those sources instead of
 * trusting stream-copy.
 *
 * timeBase and channelLayout labels remain advisory rather than hard blockers:
 * - MP4/FFmpeg can safely rewrite timestamps during concat/muxing.
 * - encoders may omit or spell the same channel layout differently while the
 *   actual codec/sample-rate/channel-count remains identical.
 *
 * Every merged output is still decoded 0-100% before final commit, so advisory
 * differences cannot silently escape as a successful output.
 */
export function compareForConcat(
  reference: MediaInfo,
  candidate: MediaInfo
): ConcatCompatibility {
  const reasons: string[] = [];
  const advisories: string[] = [];
  /* TUBMEDIA STRICT CONCAT SAFETY R33 */
  const fields: Array<[string, unknown, unknown]> = [
    ['Codec video', reference.videoCodec, candidate.videoCodec],
    ['Profile video', reference.videoProfile ?? null, candidate.videoProfile ?? null],
    ['Level video', reference.videoLevel ?? null, candidate.videoLevel ?? null],
    ['Bit depth', reference.bitDepth ?? null, candidate.bitDepth ?? null],
    ['Nominal FPS', reference.nominalFps ?? null, candidate.nominalFps ?? null],
    ['Color primaries', reference.colorPrimaries ?? null, candidate.colorPrimaries ?? null],
    ['Color transfer', reference.colorTransfer ?? null, candidate.colorTransfer ?? null],
    ['Color space', reference.colorSpace ?? null, candidate.colorSpace ?? null],
    ['Color range', reference.colorRange ?? null, candidate.colorRange ?? null],
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
