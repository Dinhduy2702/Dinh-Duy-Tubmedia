import type { MediaInfo, QualityDecision, QualityProfile } from '../types/domain.js';

function sourceTarget(source: MediaInfo) {
  return {
    width: source.width,
    height: source.height,
    fps: source.fps,
    videoCodec: source.videoCodec,
    pixelFormat: source.pixelFormat,
    audioCodec: source.audioCodec,
    sampleRate: source.sampleRate,
    channels: source.channels,
    hdr: source.hdr
  };
}

export function decideQuality(source: MediaInfo, profile: QualityProfile): QualityDecision {
  const target = sourceTarget(source);
  const reasons: string[] = [];
  if (profile.mode === 'highest_source') return { action: 'COPY', reasons: ['Giữ nguyên chất lượng nguồn.'], target };
  const maxWidth = profile.maxWidth ?? source.width;
  const maxHeight = profile.maxHeight ?? source.height;
  const width = profile.allowUpscale ? maxWidth : Math.min(source.width, maxWidth);
  const height = profile.allowUpscale ? maxHeight : Math.min(source.height, maxHeight);
  const fps = profile.fpsMode === 'source' ? source.fps : profile.fpsMode === 'custom' ? profile.customFps ?? source.fps : Number(profile.fpsMode);
  const videoCodec = profile.videoCodec === 'copy' ? source.videoCodec : profile.videoCodec;
  const audioCodec = profile.audioMode === 'copy_if_compatible' ? source.audioCodec : profile.audioMode === 'mute' ? null : 'aac';
  const sampleRate = audioCodec ? profile.sampleRate : null;
  const channels = audioCodec ? (profile.forceStereo ? 2 : source.channels ?? 2) : null;
  const hdr = profile.hdrMode === 'keep' ? source.hdr : profile.hdrMode === 'forbid' || profile.hdrMode === 'tonemap_sdr' ? false : source.hdr;
  const resultTarget = { width, height, fps, videoCodec, pixelFormat: profile.pixelFormat, audioCodec, sampleRate, channels, hdr };
  const containerCompatible = ['h264', 'hevc', 'av1', 'vp9'].includes(source.videoCodec) && ['aac', 'mp3', 'opus', null].includes(source.audioCodec);
  const videoSame = source.width === width && source.height === height && Math.abs(source.fps - fps) < 0.01 && source.videoCodec === videoCodec && source.pixelFormat === profile.pixelFormat && source.hdr === hdr;
  const audioSame = source.audioCodec === audioCodec && (audioCodec === null || source.sampleRate === sampleRate) && (audioCodec === null || source.channels === channels);
  if (source.hdr && !hdr) return { action: 'HDR_TONEMAP', reasons: ['Nguồn HDR cần chuyển sang SDR theo profile.'], target: resultTarget };
  if (!source.audioCodec && profile.audioMode === 'silent') return { action: 'ADD_SILENT_AUDIO', reasons: ['Nguồn thiếu audio, profile yêu cầu silent track.'], target: resultTarget };
  if (videoSame && audioSame) return { action: containerCompatible ? 'COPY' : 'REMUX', reasons: [containerCompatible ? 'Không cần xử lý.' : 'Chỉ cần remux container.'], target: resultTarget };
  if (!videoSame && audioSame) {
    if (source.width !== width || source.height !== height) reasons.push('Độ phân giải không phù hợp.');
    if (Math.abs(source.fps - fps) >= 0.01) reasons.push('FPS không phù hợp.');
    if (source.videoCodec !== videoCodec) reasons.push('Codec video không phù hợp.');
    return { action: 'VIDEO_TRANSCODE_ONLY', reasons, target: resultTarget };
  }
  if (videoSame && !audioSame) return { action: 'AUDIO_TRANSCODE_ONLY', reasons: ['Audio không phù hợp.'], target: resultTarget };
  return { action: 'FULL_TRANSCODE', reasons: ['Video và audio đều cần chuẩn hóa.'], target: resultTarget };
}
