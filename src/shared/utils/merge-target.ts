import type { MediaInfo, QualityProfile } from '../types/domain.js';

export interface MergeTargetDecision {
  width: number;
  height: number;
  fps: number;
  hdr: boolean;
  videoCodec: 'h264' | 'hevc';
  pixelFormat: string;
  audioCodec: 'aac' | null;
  sampleRate: number | null;
  channels: number | null;
  videoBitrate: number | null;
}

export interface MergeSizeValidation {
  ok: boolean;
  sourceBytes: number;
  outputBytes: number;
  ratio: number | null;
  message: string | null;
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded - (rounded % 2);
}

function fitInside(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: even(width * ratio), height: even(height * ratio) };
}

function clampVideoBitrate(value: number): number {
  return Math.max(250_000, Math.min(200_000_000, Math.round(value)));
}

function normalizedCodec(codec: string): 'h264' | 'hevc' | 'other' {
  if (codec === 'h264') return 'h264';
  if (codec === 'hevc' || codec === 'h265') return 'hevc';
  return 'other';
}

function fpsKey(fps: number): number {
  return Math.round(Math.max(0, fps) * 100) / 100;
}

interface WeightedFormat {
  source: MediaInfo;
  weight: number;
  count: number;
}

/**
 * Smart merge should minimize total transcoded duration, not blindly follow a
 * single outlier with the largest canvas or highest FPS. Group sources by the
 * properties that make a clip expensive to normalize, then choose the group
 * representing the greatest total duration. Ties prefer more clips and then a
 * larger real source canvas.
 */
function dominantSource(infos: MediaInfo[]): MediaInfo {
  const groups = new Map<string, WeightedFormat>();
  for (const info of infos) {
    const key = [
      info.width,
      info.height,
      fpsKey(info.fps),
      normalizedCodec(info.videoCodec),
      info.pixelFormat,
      info.hdr ? 'hdr' : 'sdr',
      info.audioCodec ?? 'none',
      info.sampleRate ?? 0,
      info.channels ?? 0
    ].join('|');
    const current = groups.get(key);
    const durationWeight = Math.max(1, info.duration);
    if (current) {
      current.weight += durationWeight;
      current.count += 1;
    } else {
      groups.set(key, { source: info, weight: durationWeight, count: 1 });
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (b.count !== a.count) return b.count - a.count;
      const areaDelta = b.source.width * b.source.height - a.source.width * a.source.height;
      if (areaDelta !== 0) return areaDelta;
      return b.source.fps - a.source.fps;
    })[0]!.source;
}

/**
 * Ưu tiên bitrate suy ra từ dung lượng thật trên đĩa. ffprobe có thể trả
 * stream bit_rate danh nghĩa thấp hơn đáng kể với VBR, khiến tệp 500 MB bị
 * mã hóa lại còn khoảng 200 MB dù người dùng chọn giữ gần nguồn.
 */
export function sourceEquivalentVideoBitrate(info: MediaInfo): number | null {
  const duration = Math.max(0, info.duration);
  if (duration <= 0) return null;
  const actualTotalBitrate = (Math.max(0, info.fileSize) * 8) / duration;
  const derivedVideoBitrate = actualTotalBitrate - Math.max(0, info.audioBitrate ?? 0);
  if (Number.isFinite(derivedVideoBitrate) && derivedVideoBitrate > 0) {
    return clampVideoBitrate(derivedVideoBitrate);
  }
  if (info.videoBitrate && Number.isFinite(info.videoBitrate) && info.videoBitrate > 0) {
    return clampVideoBitrate(info.videoBitrate);
  }
  return null;
}

function sourceAverageVideoBitrate(infos: MediaInfo[]): number | null {
  let weightedBits = 0;
  let weightedSeconds = 0;
  for (const info of infos) {
    const duration = Math.max(0, info.duration);
    const measured = sourceEquivalentVideoBitrate(info);
    if (!measured || duration <= 0) continue;
    weightedBits += measured * duration;
    weightedSeconds += duration;
  }
  if (weightedSeconds <= 0) return null;
  return clampVideoBitrate(weightedBits / weightedSeconds);
}

export function chooseMergeTarget(
  infos: MediaInfo[],
  profile: QualityProfile
): MergeTargetDecision {
  if (!infos.length) throw new Error('Không có media info để chọn chuẩn ghép.');

  const largestRealSource = [...infos].sort(
    (a, b) => b.width * b.height - a.width * a.height
  )[0]!;
  const dominant = dominantSource(infos);
  const smart = profile.mode === 'smart_merge';
  const compatible =
    profile.mode === 'compatible_1080p' || profile.mode === 'smooth_background';
  const canvasSource = smart ? dominant : largestRealSource;
  const profileMaxWidth = compatible
    ? 1920
    : profile.maxWidth ?? Number.POSITIVE_INFINITY;
  const profileMaxHeight = compatible
    ? 1080
    : profile.maxHeight ?? Number.POSITIVE_INFINITY;
  const canvas = fitInside(
    canvasSource.width,
    canvasSource.height,
    profileMaxWidth,
    profileMaxHeight
  );

  const allHdr = infos.every((info) => info.hdr);
  const keepHdr = !compatible && allHdr && (profile.hdrMode === 'keep' || profile.hdrMode === 'auto');
  const channels = profile.forceStereo
    ? 2
    : smart
      ? dominant.channels ?? 2
      : Math.min(2, Math.max(...infos.map((info) => info.channels ?? 2)));

  const maxFps = Math.max(...infos.map((info) => info.fps));
  const sourceFps = smart ? dominant.fps : maxFps;
  const fps = compatible
    ? Math.min(60, Math.max(24, sourceFps))
    : profile.fpsMode === '30'
      ? 30
      : profile.fpsMode === '60'
        ? 60
        : profile.fpsMode === 'custom'
          ? profile.customFps ?? sourceFps
          : sourceFps;

  const dominantCodec = normalizedCodec(dominant.videoCodec);
  const videoCodec: 'h264' | 'hevc' = keepHdr
    ? 'hevc'
    : smart && dominantCodec !== 'other'
      ? dominantCodec
      : 'h264';

  const useDominantAudio =
    smart &&
    profile.audioMode === 'copy_if_compatible' &&
    (dominant.audioCodec === 'aac' || dominant.audioCodec === null);
  const audioCodec: 'aac' | null = useDominantAudio
    ? dominant.audioCodec === 'aac'
      ? 'aac'
      : null
    : profile.audioMode === 'mute'
      ? null
      : 'aac';
  const sampleRate = audioCodec
    ? useDominantAudio
      ? dominant.sampleRate ?? 48000
      : 48000
    : null;

  const preferredPixelFormat =
    smart && !keepHdr && /^yuv420p(?:$|10le$)/i.test(dominant.pixelFormat)
      ? dominant.pixelFormat
      : keepHdr
        ? 'yuv420p10le'
        : 'yuv420p';

  return {
    width: canvas.width,
    height: canvas.height,
    fps,
    hdr: keepHdr,
    videoCodec,
    pixelFormat: preferredPixelFormat,
    audioCodec,
    sampleRate,
    channels: audioCodec ? channels : null,
    videoBitrate:
      profile.bitrateMode === 'source_average'
        ? sourceAverageVideoBitrate(infos)
        : null
  };
}

export function validateMergeOutputSize(
  infos: MediaInfo[],
  outputBytes: number,
  profile: QualityProfile
): MergeSizeValidation {
  const sourceBytes = infos.reduce(
    (sum, info) => sum + Math.max(0, info.fileSize),
    0
  );
  const shouldPreserveSourceSize =
    profile.bitrateMode === 'source_average' || profile.mode === 'highest_source';
  if (
    !shouldPreserveSourceSize ||
    sourceBytes <= 0 ||
    !Number.isFinite(outputBytes) ||
    outputBytes <= 0
  ) {
    return {
      ok: Number.isFinite(outputBytes) && outputBytes > 0,
      sourceBytes,
      outputBytes,
      ratio: sourceBytes > 0 ? outputBytes / sourceBytes : null,
      message: null
    };
  }

  const ratio = outputBytes / sourceBytes;
  const ok = ratio >= 0.75;
  return {
    ok,
    sourceBytes,
    outputBytes,
    ratio,
    message: ok
      ? null
      : `Thành phẩm chỉ còn ${(ratio * 100).toFixed(0)}% tổng dung lượng video đã chuẩn bị (${outputBytes} / ${sourceBytes} byte), thấp hơn ngưỡng an toàn 75%.`
  };
}
