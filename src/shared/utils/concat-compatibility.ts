import type { MediaInfo } from '../types/domain.js';

const CONCAT_AVERAGE_FPS_TOLERANCE = 0.01;

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
 * TUBMEDIA CORE RESILIENCE R35:
 * time-base, codec extradata fingerprints and channel layout are also blockers.
 * FFmpeg concat stream-copy requires identical stream configuration; SPS/PPS/VPS,
 * AAC configuration or timestamp bases that differ are normalized before concat.
 * This deliberately trades a little speed on risky boundaries for deterministic output.
 *
 * FFprobe average FPS can drift slightly because it is derived from frame count and
 * duration. Differences below the normalizer's 0.01 FPS threshold are harmless when
 * nominal FPS, time base and codec signatures still match.
 */
export function compareForConcat(
  reference: MediaInfo,
  candidate: MediaInfo
): ConcatCompatibility {
  const reasons: string[] = [];
  const advisories: string[] = [];
  const averageFpsDifference = Math.abs(reference.fps - candidate.fps);
  if (!Number.isFinite(averageFpsDifference) || averageFpsDifference >= CONCAT_AVERAGE_FPS_TOLERANCE) {
    reasons.push(
      `FPS: ${Math.round(reference.fps * 1000)} ≠ ${Math.round(candidate.fps * 1000)}`
    );
  }

  /* TUBMEDIA STRICT CONCAT SAFETY R33 */
  const fields: Array<[string, unknown, unknown]> = [
    ['Codec video', reference.videoCodec, candidate.videoCodec],
    ['Video extradata', reference.videoExtradataHash ?? null, candidate.videoExtradataHash ?? null],
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
    ['Pixel format', reference.pixelFormat, candidate.pixelFormat],
    ['HDR', reference.hdr, candidate.hdr],
    ['Loại HDR', reference.hdrType ?? null, candidate.hdrType ?? null],
    ['SAR', reference.sampleAspectRatio ?? null, candidate.sampleAspectRatio ?? null],
    ['DAR', reference.displayAspectRatio ?? null, candidate.displayAspectRatio ?? null],
    ['Rotation', reference.rotation ?? 0, candidate.rotation ?? 0],
    ['VFR', reference.variableFrameRate ?? false, candidate.variableFrameRate ?? false],
    ['Time base', reference.timeBase ?? null, candidate.timeBase ?? null],
    ['Codec audio', reference.audioCodec, candidate.audioCodec],
    ['Audio extradata', reference.audioExtradataHash ?? null, candidate.audioExtradataHash ?? null],
    ['Sample rate', reference.sampleRate, candidate.sampleRate],
    ['Số kênh', reference.channels, candidate.channels],
    ['Channel layout', reference.channelLayout ?? null, candidate.channelLayout ?? null]
  ];
  for (const [name, a, b] of fields) {
    if (a !== b) reasons.push(`${name}: ${String(a)} ≠ ${String(b)}`);
  }


  return { compatible: reasons.length === 0, reasons, advisories };
}
