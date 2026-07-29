import type { AppSettings, DownloadCompatibilityMode, MediaInfo } from '../types/domain.js';

export type DownloadWorkflow = 'download-only' | 'download-merge';
export const DOWNLOAD_LIST_POLICY_VERSION = 'download-list-multiplatform-v5';
export const MERGE_SOURCE_DOWNLOAD_POLICY = 'merge-best-source-multiplatform-v7';
export const GOOGLE_DRIVE_ORIGINAL_DOWNLOAD_POLICY = 'merge-google-drive-native-download-v7';
export const HIGHEST_SOURCE_FORMAT_SELECTOR = 'bv+ba/b';
export const REFERENCE_1080P_FORMAT_SELECTOR = [
  'bv*[ext=mp4][vcodec^=avc1][height<=1080][height>=720]+ba[ext=m4a]',
  'bv*[ext=mp4][height<=1080][height>=720]+ba[ext=m4a]',
  'bv*[height<=1080][height>=720]+ba',
  'b[ext=mp4][height<=1080][height>=720]',
  'bv*[height<=1080]+ba',
  'b[height<=1080]',
  'bv*+ba/b'
].join('/');
/**
 * Google Drive links can be handled by either the GoogleDrive extractor or a
 * generic/direct-file extractor. Forcing `-f source` breaks direct download
 * links because those extractors do not expose a format literally named
 * `source`. Match the proven standalone workflow: omit `-f` and let yt-dlp
 * download the native/default file offered by the resolved Drive URL.
 */
export const GOOGLE_DRIVE_ORIGINAL_FORMAT_SELECTOR: string | null = null;
/** Other platforms follow yt-dlp's normal best-video + best-audio behavior. */
export const MERGE_SOURCE_FORMAT_SELECTOR = 'bv*+ba/b';
export const HIGHEST_SOURCE_FORMAT_SORT = 'res,fps,size,tbr,vbr,hdr,vcodec,abr,acodec';
export const MERGE_SOURCE_FORMAT_SORT: string | null = null;
export const MIN_SELECTED_SIZE_RATIO = 0.8;

export interface DownloadQualityValidation {
  ok: boolean;
  blockingReasons: string[];
  warnings: string[];
}

export interface SelectedDownloadSizeValidation {
  ok: boolean;
  suspicious: boolean;
  actualBytes: number;
  expectedBytes: number | null;
  ratio: number | null;
  message: string | null;
}

export interface DownloadQualityValidationOptions {
  enforceCompatibility?: boolean;
  allowCapCutPreparation?: boolean;
}

export interface EffectiveDownloadBounds {
  minHeight: number;
  maxHeight: number;
  minFps: number;
  maxFps: number;
  allowBelowMinimum: boolean;
}

export interface CapCutCompatibilityPlan {
  active: boolean;
  mode: DownloadCompatibilityMode;
  maxHeight: number | null;
  targetFps: number;
  needsVideoTranscode: boolean;
  needsAudioTranscode: boolean;
  needsContainerRemux: boolean;
  requiresHdrToneMap: boolean;
  requiresColorConversion: boolean;
  reasons: string[];
}

export function isCapCutDownloadMode(mode: DownloadCompatibilityMode): boolean {
  return mode === 'capcut_sdr_1080p' || mode === 'capcut_sdr_2k';
}

export function capCutTargetMaxHeight(mode: DownloadCompatibilityMode): 1080 | 1440 | null {
  if (mode === 'capcut_sdr_1080p') return 1080;
  if (mode === 'capcut_sdr_2k') return 1440;
  return null;
}

export function effectiveDownloadBounds(settings: AppSettings): EffectiveDownloadBounds {
  const capCutHeight = capCutTargetMaxHeight(settings.downloadCompatibilityMode);
  if (capCutHeight) {
    return {
      minHeight: 1080,
      maxHeight: capCutHeight,
      minFps: 0,
      maxFps: 60,
      allowBelowMinimum: false
    };
  }
  return {
    minHeight: settings.downloadMinHeight,
    maxHeight: settings.downloadMaxHeight,
    minFps: settings.downloadMinFps,
    maxFps: settings.downloadMaxFps,
    allowBelowMinimum: settings.downloadAllowBelowMinimum
  };
}

function filterRange(settings: AppSettings, includeMinimum: boolean): string {
  const bounds = effectiveDownloadBounds(settings);
  const filters: string[] = [];
  if (bounds.maxHeight > 0) {
    filters.push(`[height<=?${bounds.maxHeight}]`);
  }
  if (includeMinimum && bounds.minHeight > 0) {
    filters.push(`[height>=?${bounds.minHeight}]`);
  }
  if (bounds.maxFps > 0) {
    filters.push(`[fps<=?${bounds.maxFps}]`);
  }
  if (settings.downloadVideoBitrateKbps > 0) {
    filters.push(`[vbr<=?${settings.downloadVideoBitrateKbps}]`);
  }
  if (includeMinimum && bounds.minFps > 0) {
    filters.push(`[fps>=?${bounds.minFps}]`);
  }
  if (includeMinimum && settings.downloadMinVideoBitrateKbps > 0) {
    filters.push(`[vbr>=?${settings.downloadMinVideoBitrateKbps}]`);
  }
  return filters.join('');
}

function codecFilter(settings: AppSettings): string {
  if (settings.downloadCodecPreference === 'auto') return '';
  const pattern =
    settings.downloadCodecPreference === 'h264'
      ? '^avc1|^h264'
      : settings.downloadCodecPreference === 'hevc'
        ? '^hev1|^hvc1|^hevc|^h265'
        : settings.downloadCodecPreference === 'vp9'
          ? '^vp0?9'
          : '^av01|^av1';
  return `[vcodec~='${pattern}']`;
}

function videoWithAudio(videoFilter: string, settings: AppSettings): string[] {
  const audioFilters: string[] = [];
  if (settings.downloadMinAudioBitrateKbps > 0) {
    audioFilters.push(`[abr>=?${settings.downloadMinAudioBitrateKbps}]`);
  }
  if (settings.downloadAudioBitrateKbps > 0) {
    audioFilters.push(`[abr<=?${settings.downloadAudioBitrateKbps}]`);
  }
  const preferredAudio = `ba${audioFilters.join('')}`;
  return [`bv*${videoFilter}+${preferredAudio}`, `bv*${videoFilter}+ba`, `b${videoFilter}`];
}

function buildCapCutFormatSelector(settings: AppSettings): string {
  const maxHeight = capCutTargetMaxHeight(settings.downloadCompatibilityMode);
  if (!maxHeight) return '';
  const exact = `[height=${maxHeight}][fps<=?60]`;
  const range = `[height>=1080][height<=${maxHeight}][fps<=?60]`;
  const h264 = "[vcodec~='^avc1|^h264']";
  const aac = "[acodec~='^mp4a|^aac']";
  const branches = [
    `bv*${exact}${h264}+ba${aac}`,
    `bv*${exact}${h264}+ba`,
    `bv*${exact}+ba${aac}`,
    `bv*${exact}+ba`,
    `bv*${range}${h264}+ba${aac}`,
    `bv*${range}${h264}+ba`,
    `bv*${range}+ba${aac}`,
    `bv*${range}+ba`,
    `bv*${exact}${h264}`,
    `bv*${exact}`,
    `bv*${range}${h264}`,
    `bv*${range}`,
    `b${exact}${h264}`,
    `b${exact}`,
    `b${range}${h264}`,
    `b${range}`
  ];
  return branches.join('/');
}

/**
 * Builds an explicit ordered selector. The first branch enforces every user
 * limit. Later branches are only added when the user allows fallback.
 */
export function buildDownloadFormatSelector(settings: AppSettings): string {
  if (isCapCutDownloadMode(settings.downloadCompatibilityMode)) {
    return buildCapCutFormatSelector(settings);
  }
  const strictRange = filterRange(settings, true);
  const relaxedRange = filterRange(settings, false);
  const codec = codecFilter(settings);

  const branches = videoWithAudio(`${codec}${strictRange}`, settings);
  if (!settings.downloadAllowBelowMinimum) return branches.join('/');

  if (codec) {
    branches.push(...videoWithAudio(strictRange, settings));
  }
  branches.push(...videoWithAudio(relaxedRange, settings));
  branches.push('bv*+ba', 'b');
  return [...new Set(branches)].join('/');
}

export function isReference1080DownloadPreset(settings: AppSettings): boolean {
  return (
    settings.downloadCompatibilityMode === 'source' &&
    settings.downloadMinHeight === 720 &&
    settings.downloadMaxHeight === 1080 &&
    settings.downloadMinFps === 0 &&
    settings.downloadMaxFps === 0 &&
    settings.downloadCodecPreference === 'h264' &&
    settings.downloadContainerPreference === 'mp4' &&
    settings.downloadMinVideoBitrateKbps === 0 &&
    settings.downloadVideoBitrateKbps === 0 &&
    settings.downloadMinAudioBitrateKbps === 0 &&
    settings.downloadAudioBitrateKbps === 0 &&
    settings.downloadAllowBelowMinimum
  );
}

export function isUnboundedHighestSourceDownload(settings: AppSettings): boolean {
  return (
    settings.downloadCompatibilityMode === 'source' &&
    settings.downloadMinHeight === 0 &&
    settings.downloadMaxHeight === 0 &&
    settings.downloadMinFps === 0 &&
    settings.downloadMaxFps === 0 &&
    settings.downloadCodecPreference === 'auto' &&
    settings.downloadMinVideoBitrateKbps === 0 &&
    settings.downloadVideoBitrateKbps === 0 &&
    settings.downloadMinAudioBitrateKbps === 0 &&
    settings.downloadAudioBitrateKbps === 0
  );
}

export function formatSelectorForWorkflow(
  settings: AppSettings,
  workflow: DownloadWorkflow,
  platform: string | null = null
): string | null {
  if (platform === 'google-drive') {
    return GOOGLE_DRIVE_ORIGINAL_FORMAT_SELECTOR;
  }
  if (workflow === 'download-merge') {
    return MERGE_SOURCE_FORMAT_SELECTOR;
  }
  if (isUnboundedHighestSourceDownload(settings)) {
    return HIGHEST_SOURCE_FORMAT_SELECTOR;
  }
  if (isReference1080DownloadPreset(settings)) {
    return REFERENCE_1080P_FORMAT_SELECTOR;
  }
  return buildDownloadFormatSelector(settings);
}

export function formatSortForWorkflow(
  settings: AppSettings,
  workflow: DownloadWorkflow,
  platform: string | null = null
): string | null {
  if (platform === 'google-drive') return null;
  if (workflow === 'download-merge') {
    return MERGE_SOURCE_FORMAT_SORT;
  }
  if (isReference1080DownloadPreset(settings)) {
    return 'res:1080,codec:avc:m4a,br';
  }
  if (isUnboundedHighestSourceDownload(settings)) return HIGHEST_SOURCE_FORMAT_SORT;
  return null;
}

export function forceHighestSourceSort(
  settings: AppSettings,
  workflow: DownloadWorkflow,
  platform: string | null = null
): boolean {
  return formatSortForWorkflow(settings, workflow, platform) !== null;
}

/**
 * Source files used by Download & Merge must remain independent from the
 * global direct-download/CapCut settings. Those files are normalized once,
 * later, by the selected merge quality profile.
 */
export function settingsForDownloadWorkflow(settings: AppSettings, workflow: DownloadWorkflow): AppSettings {
  if (workflow !== 'download-merge') return settings;
  return {
    ...settings,
    downloadCompatibilityMode: 'source',
    downloadMinHeight: 0,
    downloadMaxHeight: 0,
    downloadMinFps: 0,
    downloadMaxFps: 0,
    downloadCodecPreference: 'auto',
    downloadContainerPreference: 'auto',
    downloadMinVideoBitrateKbps: 0,
    downloadVideoBitrateKbps: 0,
    downloadMinAudioBitrateKbps: 0,
    downloadAudioBitrateKbps: 0,
    downloadAllowBelowMinimum: true
  };
}

export function downloadPolicyForWorkflow(
  settings: AppSettings,
  workflow: DownloadWorkflow,
  platform: string | null = null
): string {
  if (workflow === 'download-merge') {
    return platform === 'google-drive' ? GOOGLE_DRIVE_ORIGINAL_DOWNLOAD_POLICY : MERGE_SOURCE_DOWNLOAD_POLICY;
  }
  return `${DOWNLOAD_LIST_POLICY_VERSION}:${downloadQualitySignature(settings)}`;
}

export function validateSelectedDownloadSize(
  actualBytes: number,
  expectedBytes: number | null
): SelectedDownloadSizeValidation {
  const actualIsValid = Number.isFinite(actualBytes) && actualBytes > 0;
  if (!actualIsValid || expectedBytes === null || !Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    return {
      ok: actualIsValid,
      suspicious: false,
      actualBytes,
      expectedBytes,
      ratio: null,
      message: actualIsValid ? null : 'Dung lượng tệp thực tế không hợp lệ.'
    };
  }

  const ratio = actualBytes / expectedBytes;
  const suspicious = ratio < MIN_SELECTED_SIZE_RATIO;
  return {
    ok: true,
    suspicious,
    actualBytes,
    expectedBytes,
    ratio,
    message: suspicious
      ? `Dung lượng thực tế bằng ${(ratio * 100).toFixed(0)}% metadata ước tính của định dạng đã chọn (${actualBytes} / ${expectedBytes} byte).`
      : null
  };
}

export function mergeOutputFormat(
  settings: AppSettings,
  workflow: DownloadWorkflow = 'download-only'
): string {
  if (workflow === 'download-merge') return 'mp4';
  if (isCapCutDownloadMode(settings.downloadCompatibilityMode)) return 'mp4';
  if (settings.downloadContainerPreference === 'mp4') return 'mp4';
  if (settings.downloadContainerPreference === 'mkv') return 'mkv';
  return 'mp4/mkv';
}

export function downloadQualitySignature(settings: AppSettings): string {
  return JSON.stringify({
    compatibilityMode: settings.downloadCompatibilityMode,
    minHeight: settings.downloadMinHeight,
    maxHeight: settings.downloadMaxHeight,
    minFps: settings.downloadMinFps,
    maxFps: settings.downloadMaxFps,
    codec: settings.downloadCodecPreference,
    container: settings.downloadContainerPreference,
    minVideoBitrate: settings.downloadMinVideoBitrateKbps,
    maxVideoBitrate: settings.downloadVideoBitrateKbps,
    minAudioBitrate: settings.downloadMinAudioBitrateKbps,
    maxAudioBitrate: settings.downloadAudioBitrateKbps,
    allowBelowMinimum: settings.downloadAllowBelowMinimum
  });
}

function isH264(codec: string): boolean {
  const value = codec.toLowerCase();
  return value.includes('h264') || value.includes('avc');
}

function isMp4Format(formatName: string | null): boolean {
  return Boolean(
    formatName
      ?.toLowerCase()
      .split(',')
      .some((name) => name.trim() === 'mp4')
  );
}

function knownNonBt709(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return !['bt709', 'unknown', 'unspecified', 'reserved'].includes(normalized);
}

export function planCapCutCompatibility(settings: AppSettings, info: MediaInfo): CapCutCompatibilityPlan {
  const mode = settings.downloadCompatibilityMode;
  const maxHeight = capCutTargetMaxHeight(mode);
  if (!maxHeight) {
    return {
      active: false,
      mode,
      maxHeight: null,
      targetFps: info.fps,
      needsVideoTranscode: false,
      needsAudioTranscode: false,
      needsContainerRemux: false,
      requiresHdrToneMap: false,
      requiresColorConversion: false,
      reasons: []
    };
  }

  const reasons: string[] = [];
  const requiresHdrToneMap = info.hdr;
  const requiresColorConversion =
    !requiresHdrToneMap &&
    (knownNonBt709(info.colorPrimaries) ||
      knownNonBt709(info.colorTransfer) ||
      knownNonBt709(info.colorSpace));
  const wrongCodec = !isH264(info.videoCodec);
  const wrongPixelFormat = info.pixelFormat.toLowerCase() !== 'yuv420p';
  const fpsTooHigh = info.fps > 60.5;
  const resolutionTooHigh = info.height > maxHeight + 2;
  const needsAudioTranscode = Boolean(
    info.audioCodec &&
    (info.audioCodec.toLowerCase() !== 'aac' || info.sampleRate !== 48_000 || (info.channels ?? 2) > 2)
  );
  const needsContainerRemux = !isMp4Format(info.formatName);

  if (wrongCodec) reasons.push(`codec ${info.videoCodec} cần chuyển sang H.264`);
  if (requiresHdrToneMap) reasons.push('HDR cần chuyển rõ ràng sang SDR');
  if (requiresColorConversion) reasons.push('không gian màu cần chuyển sang BT.709');
  if (wrongPixelFormat) reasons.push(`pixel format ${info.pixelFormat} cần chuyển sang yuv420p`);
  if (fpsTooHigh) reasons.push(`${info.fps.toFixed(2)} FPS cần giới hạn còn 60 FPS`);
  if (resolutionTooHigh) reasons.push(`độ phân giải cần giới hạn còn tối đa ${maxHeight}p`);
  if (needsAudioTranscode) reasons.push('audio cần chuyển sang AAC 48 kHz');
  if (needsContainerRemux) reasons.push('container cần đóng gói thành MP4');

  return {
    active: true,
    mode,
    maxHeight,
    targetFps: Math.min(info.fps, 60),
    needsVideoTranscode:
      wrongCodec ||
      requiresHdrToneMap ||
      requiresColorConversion ||
      wrongPixelFormat ||
      fpsTooHigh ||
      resolutionTooHigh,
    needsAudioTranscode,
    needsContainerRemux,
    requiresHdrToneMap,
    requiresColorConversion,
    reasons
  };
}

function codecMatches(preference: AppSettings['downloadCodecPreference'], codec: string): boolean {
  const value = codec.toLowerCase();
  if (preference === 'auto') return true;
  if (preference === 'h264') return value.includes('h264') || value.includes('avc');
  if (preference === 'hevc') {
    return value.includes('hevc') || value.includes('h265') || value.includes('hvc1');
  }
  if (preference === 'vp9') return value.includes('vp9') || value.includes('vp09');
  return value.includes('av1') || value.includes('av01');
}

export function validateDownloadedQuality(
  settings: AppSettings,
  info: MediaInfo,
  options: DownloadQualityValidationOptions = {}
): DownloadQualityValidation {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const belowMinimum: string[] = [];
  const bounds = effectiveDownloadBounds(settings);
  const enforceCompatibility = options.enforceCompatibility ?? true;
  const allowCapCutPreparation = options.allowCapCutPreparation ?? false;
  const capCutMode = isCapCutDownloadMode(settings.downloadCompatibilityMode);

  if (bounds.maxHeight > 0 && info.height > bounds.maxHeight + 2 && !(capCutMode && allowCapCutPreparation)) {
    blockingReasons.push(`Chiều cao ${info.height}px vượt mức tối đa ${bounds.maxHeight}px.`);
  }
  if (bounds.maxFps > 0 && info.fps > bounds.maxFps + 0.5 && !(capCutMode && allowCapCutPreparation)) {
    blockingReasons.push(`FPS ${info.fps.toFixed(2)} vượt mức tối đa ${bounds.maxFps}.`);
  }
  if (bounds.minHeight > 0 && info.height < bounds.minHeight) {
    belowMinimum.push(`độ phân giải ${info.height}p thấp hơn ${bounds.minHeight}p`);
  }
  if (bounds.minFps > 0 && info.fps + 0.5 < bounds.minFps) {
    belowMinimum.push(`FPS ${info.fps.toFixed(2)} thấp hơn ${bounds.minFps}`);
  }
  if (!capCutMode && !codecMatches(settings.downloadCodecPreference, info.videoCodec)) {
    const message = `Codec thực tế ${info.videoCodec} khác ưu tiên ${settings.downloadCodecPreference}.`;
    if (settings.downloadAllowBelowMinimum) warnings.push(message);
    else blockingReasons.push(message);
  }

  if (belowMinimum.length > 0) {
    const message = `Nguồn không đạt mức tối thiểu: ${belowMinimum.join(', ')}.`;
    if (bounds.allowBelowMinimum) warnings.push(message);
    else blockingReasons.push(message);
  }

  if (capCutMode && enforceCompatibility) {
    if (!isH264(info.videoCodec)) {
      blockingReasons.push(`CapCut trực tiếp yêu cầu H.264; tệp hiện là ${info.videoCodec}.`);
    }
    if (info.hdr || (info.bitDepth ?? 8) > 8) {
      blockingReasons.push('Tệp vẫn còn HDR hoặc độ sâu màu trên 8-bit.');
    }
    if (info.pixelFormat.toLowerCase() !== 'yuv420p') {
      blockingReasons.push(`CapCut trực tiếp yêu cầu yuv420p; tệp hiện là ${info.pixelFormat}.`);
    }
    if (
      knownNonBt709(info.colorPrimaries) ||
      knownNonBt709(info.colorTransfer) ||
      knownNonBt709(info.colorSpace)
    ) {
      blockingReasons.push('Tệp chưa được chuẩn hóa hoàn toàn về không gian màu BT.709.');
    }
    if (!isMp4Format(info.formatName)) {
      blockingReasons.push('Tệp chưa được đóng gói đúng container MP4.');
    }
    if (
      info.audioCodec &&
      (info.audioCodec.toLowerCase() !== 'aac' || info.sampleRate !== 48_000 || (info.channels ?? 2) > 2)
    ) {
      blockingReasons.push('Âm thanh chưa đạt AAC 48 kHz, tối đa 2 kênh.');
    }
  }

  if (!capCutMode && info.videoBitrate !== null) {
    const videoKbps = info.videoBitrate / 1000;
    if (settings.downloadVideoBitrateKbps > 0 && videoKbps > settings.downloadVideoBitrateKbps + 64) {
      blockingReasons.push(
        `Video bitrate ${videoKbps.toFixed(0)} kbps vượt mức tối đa ${settings.downloadVideoBitrateKbps} kbps.`
      );
    }
    if (settings.downloadMinVideoBitrateKbps > 0 && videoKbps + 64 < settings.downloadMinVideoBitrateKbps) {
      const message = `Video bitrate ${videoKbps.toFixed(0)} kbps thấp hơn mức tối thiểu ${settings.downloadMinVideoBitrateKbps} kbps.`;
      if (bounds.allowBelowMinimum) warnings.push(message);
      else blockingReasons.push(message);
    }
  } else if (
    (!capCutMode && settings.downloadMinVideoBitrateKbps > 0) ||
    (!capCutMode && settings.downloadVideoBitrateKbps > 0)
  ) {
    warnings.push('Nguồn không công bố video bitrate; không thể xác minh chính xác giới hạn bitrate video.');
  }

  if (!capCutMode && info.audioCodec && info.audioBitrate !== null) {
    const audioKbps = info.audioBitrate / 1000;
    if (settings.downloadAudioBitrateKbps > 0 && audioKbps > settings.downloadAudioBitrateKbps + 8) {
      blockingReasons.push(
        `Audio bitrate ${audioKbps.toFixed(0)} kbps vượt mức tối đa ${settings.downloadAudioBitrateKbps} kbps.`
      );
    }
    if (settings.downloadMinAudioBitrateKbps > 0 && audioKbps + 8 < settings.downloadMinAudioBitrateKbps) {
      const message = `Audio bitrate ${audioKbps.toFixed(0)} kbps thấp hơn mức tối thiểu ${settings.downloadMinAudioBitrateKbps} kbps.`;
      if (bounds.allowBelowMinimum) warnings.push(message);
      else blockingReasons.push(message);
    }
  }

  if (!info.audioCodec) warnings.push('Video không có audio stream.');
  if (info.fileSize <= 0) blockingReasons.push('Dung lượng file không hợp lệ.');
  if (info.duration <= 0) blockingReasons.push('Thời lượng file không hợp lệ.');
  if (info.width <= 0 || info.height <= 0) {
    blockingReasons.push('Độ phân giải file không hợp lệ.');
  }

  return {
    ok: blockingReasons.length === 0,
    blockingReasons,
    warnings
  };
}
