import type { AppSettings, DownloadCompatibilityMode, MediaInfo } from '../types/domain.js';

export type DownloadWorkflow = 'download-only' | 'download-merge';
export const DOWNLOAD_LIST_POLICY_VERSION = 'download-list-multiplatform-v5';
export const MERGE_SOURCE_DOWNLOAD_POLICY = 'merge-best-source-multiplatform-v7';
export const GOOGLE_DRIVE_ORIGINAL_DOWNLOAD_POLICY = 'merge-google-drive-native-download-v7';
/**
 * P3 (2026-10-10): hình vẫn là hình tốt nhất; tiếng ưu tiên AAC (mp4a) — `bv+ba` thuần chọn Opus của YouTube rồi bị đóng gói
 * vào MP4, nhiều phần mềm dựng/trình phát "không có tiếng". Nguồn không có tiếng AAC thì vẫn lấy tiếng tốt nhất như cũ.
 */
export const HIGHEST_SOURCE_FORMAT_SELECTOR = 'bv+ba[acodec^=mp4a]/bv+ba/b';
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
/** Nhãn đúng như ô trong Cài đặt › Tải danh sách (SettingsPage) — dùng trong thông báo hướng dẫn người dùng. */
export const ALLOW_BELOW_MINIMUM_LABEL = 'Cho phép fallback thấp hơn mức tối thiểu khi nguồn không có';

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
  platform?: string | null | undefined;
  extractorKey?: string | null | undefined;
}

const FORMAT_SELECTABLE_PLATFORMS: ReadonlySet<string> = new Set([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'x-twitter',
  'vimeo',
  'reddit',
  'dailymotion',
  'twitch',
  'soundcloud'
]);

/**
 * V17 (1.7.6): Google Drive và liên kết tệp trực tiếp (extractor generic / tên miền ngoài danh sách nền tảng)
 * chỉ cung cấp đúng 1 tệp gốc, không cho yt-dlp chọn độ phân giải hay FPS thấp hơn.
 */
export function sourceAllowsFormatSelection(
  platform?: string | null,
  extractorKey?: string | null
): boolean {
  if (
    platform === 'google-drive' ||
    extractorKey === 'google-drive' ||
    extractorKey === 'googledrive' ||
    extractorKey === 'generic'
  ) {
    return false;
  }
  if (platform && !FORMAT_SELECTABLE_PLATFORMS.has(platform)) {
    return false;
  }
  return true;
}

function nonSelectableSourceLabel(
  platform?: string | null,
  extractorKey?: string | null
): { prep: 'trên' | 'từ'; name: string } {
  if (
    platform === 'google-drive' ||
    extractorKey === 'google-drive' ||
    extractorKey === 'googledrive' ||
    (platform && platform.includes('google.com'))
  ) {
    return { prep: 'trên', name: 'Google Drive' };
  }
  return { prep: 'từ', name: 'liên kết trực tiếp' };
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

/**
 * #10: Khung tối đa cho CapCut theo hướng khung hình: ngang/21:9 giữ W×H (1920×1080 hoặc 2560×1440);
 * dọc (height > width) đảo khung thành H×W (1080×1920 hoặc 1440×2560) để không kẹp/cắt sai video dọc.
 */
export function capCutFrameBounds(
  maxShortEdge: number,
  width: number,
  height: number
): { maxWidth: number; maxHeight: number } {
  const maxLongEdge = maxShortEdge === 1440 ? 2560 : Math.round((maxShortEdge * 16) / 9);
  if (height > width) {
    return { maxWidth: maxShortEdge, maxHeight: maxLongEdge };
  }
  return { maxWidth: maxLongEdge, maxHeight: maxShortEdge };
}

function meetsMinimumResolution(width: number, height: number, minHeight: number): boolean {
  if (width <= 0 || height <= 0) return height >= minHeight;
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (shortEdge >= minHeight) return true;
  // 21:9 / khung điện ảnh (vd 1920×800): chiều rộng đạt Full HD 1920px (hay 2K 2560px) và cạnh ngắn >= nửa ngưỡng.
  return longEdge >= Math.round((minHeight * 16) / 9) && shortEdge >= Math.round(minHeight * 0.5);
}

export function effectiveDownloadBounds(settings: AppSettings): EffectiveDownloadBounds {
  const capCutHeight = capCutTargetMaxHeight(settings.downloadCompatibilityMode);
  if (capCutHeight) {
    return {
      minHeight: 1080,
      maxHeight: capCutHeight,
      minFps: 0,
      maxFps: 60,
      // 1.8.0 việc B: CapCut tôn trọng ô "Cho phép fallback thấp hơn mức tối thiểu" như chế độ thủ công.
      allowBelowMinimum: settings.downloadAllowBelowMinimum
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
  const maxLong = maxHeight === 1440 ? 2560 : 1920;
  const exact = `[height=${maxHeight}][fps<=?60]`;
  const range = `[height>=1080][height<=${maxHeight}][fps<=?60]`;
  const exactVertical = `[width=${maxHeight}][height<=${maxLong}][fps<=?60]`;
  const rangeVertical = `[width>=1080][width<=${maxHeight}][height<=${maxLong}][fps<=?60]`;
  const exactWide =
    maxHeight === 1440
      ? `[width>=1920][width<=2560][height<1080][fps<=?60]`
      : `[width=1920][fps<=?60][height<=1080]`;
  const h264 = "[vcodec~='^avc1|^h264']";
  const aac = "[acodec~='^mp4a|^aac']";
  const withAudioFor = (filter: string): string[] => [
    `bv*${filter}${h264}+ba${aac}`,
    `bv*${filter}${h264}+ba`,
    `bv*${filter}+ba${aac}`,
    `bv*${filter}+ba`
  ];
  const mergedFor = (filter: string): string[] => [`b${filter}${h264}`, `b${filter}`];
  const videoOnlyFor = (filter: string): string[] => [`bv*${filter}${h264}`, `bv*${filter}`];

  const strictFilters = [
    exact,
    range,
    exactVertical,
    ...(maxHeight > 1080 ? [rangeVertical] : []),
    exactWide
  ];
  const branches = [
    ...withAudioFor(exact),
    ...withAudioFor(range),
    ...withAudioFor(exactVertical),
    ...(maxHeight > 1080 ? withAudioFor(rangeVertical) : []),
    ...withAudioFor(exactWide),
    // P3: bản gộp sẵn hình + tiếng (b) đứng TRƯỚC các nhánh bv* không kèm tiếng — bv* có thể là định dạng chỉ có hình.
    ...mergedFor(exact),
    ...mergedFor(range),
    ...mergedFor(exactVertical),
    ...(maxHeight > 1080 ? mergedFor(rangeVertical) : []),
    ...mergedFor(exactWide)
  ];
  const videoOnly = strictFilters.flatMap((filter) => videoOnlyFor(filter));
  if (!settings.downloadAllowBelowMinimum) return [...branches, ...videoOnly].join('/');
  // 1.8.0 việc B: ô "Cho phép thấp hơn" bật → nguồn/máy không có bản ≥1080p thì lấy bản tốt nhất dưới 1080p (ưu tiên
  // H.264 + AAC, vẫn ≤ 60 FPS và ≤ mức tối đa); bước chuyển CapCut giữ nguyên chiều cao, không phóng to giả. Cuối cùng bv*+ba/b.
  const below = `[height<=${maxHeight}][fps<=?60]`;
  const belowVertical = `[width<=${maxHeight}][height<=${maxLong}][fps<=?60]`;
  return [
    ...branches,
    ...withAudioFor(below),
    ...withAudioFor(belowVertical),
    ...mergedFor(below),
    ...mergedFor(belowVertical),
    // 1.8.0: trước khi thả hẳn ra bv*+ba, ưu tiên nhánh nằm trong khung (kể cả khi thiếu metadata height/fps hoặc chỉ vượt 1 chiều).
    `bv*[height<=?${maxHeight}][fps<=?60]+ba`,
    `bv*[width<=?${maxHeight}][height<=?${maxLong}][fps<=?60]+ba`,
    `bv*[height<=?${maxHeight}]+ba`,
    `bv*[width<=?${maxHeight}][height<=?${maxLong}]+ba`,
    `bv*[fps<=?60]+ba`,
    'bv*+ba',
    ...videoOnly,
    'b'
  ].join('/');
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
  platform: string | null = null,
  extractorKey: string | null = null
): string | null {
  if (platform === 'google-drive' || !sourceAllowsFormatSelection(platform, extractorKey)) {
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
  platform: string | null = null,
  extractorKey: string | null = null
): string | null {
  if (platform === 'google-drive' || !sourceAllowsFormatSelection(platform, extractorKey)) return null;
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
  const frameBounds = capCutFrameBounds(maxHeight, info.width, info.height);
  const resolutionTooHigh = info.width > frameBounds.maxWidth + 2 || info.height > frameBounds.maxHeight + 2;
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
  const nativeOnlySource = !sourceAllowsFormatSelection(options.platform, options.extractorKey);

  const capFrame = bounds.maxHeight > 0 ? capCutFrameBounds(bounds.maxHeight, info.width, info.height) : null;
  const exceedsMaxResolution =
    bounds.maxHeight > 0 &&
    (capCutMode
      ? Boolean(capFrame && (info.width > capFrame.maxWidth + 2 || info.height > capFrame.maxHeight + 2))
      : info.height > info.width
        ? info.width > bounds.maxHeight + 2 || info.height > Math.round((bounds.maxHeight * 16) / 9) + 2
        : info.height > bounds.maxHeight + 2);

  if (exceedsMaxResolution && !(capCutMode && allowCapCutPreparation)) {
    const allowedHeight = capCutMode && capFrame ? capFrame.maxHeight : bounds.maxHeight;
    if (!capCutMode && nativeOnlySource) {
      const src = nonSelectableSourceLabel(options.platform, options.extractorKey);
      warnings.push(
        `Video gốc ${src.prep} ${src.name} là ${info.height}p, cao hơn mức tối đa ${bounds.maxHeight}p của danh sách; Tubmedia giữ nguyên tệp gốc vì ${src.name} không cho chọn chất lượng.`
      );
    } else if (capCutMode && capFrame && info.width > capFrame.maxWidth + 2 && info.height <= capFrame.maxHeight + 2) {
      blockingReasons.push(`Chiều rộng ${info.width}px vượt mức tối đa ${capFrame.maxWidth}px.`);
    } else {
      blockingReasons.push(`Chiều cao ${info.height}px vượt mức tối đa ${allowedHeight}px.`);
    }
  }
  if (bounds.maxFps > 0 && info.fps > bounds.maxFps + 0.5 && !(capCutMode && allowCapCutPreparation)) {
    if (!capCutMode && nativeOnlySource) {
      const src = nonSelectableSourceLabel(options.platform, options.extractorKey);
      warnings.push(
        `Video gốc ${src.prep} ${src.name} có ${Number(info.fps.toFixed(2))} FPS, cao hơn mức tối đa ${bounds.maxFps} FPS của danh sách; Tubmedia giữ nguyên tệp gốc vì ${src.name} không cho chọn chất lượng.`
      );
    } else {
      blockingReasons.push(`FPS ${info.fps.toFixed(2)} vượt mức tối đa ${bounds.maxFps}.`);
    }
  }
  const reportedQualityHeight =
    info.width > 0 && info.height > info.width ? Math.min(info.width, info.height) : info.height;
  if (bounds.minHeight > 0 && !meetsMinimumResolution(info.width, info.height, bounds.minHeight)) {
    belowMinimum.push(`độ phân giải ${reportedQualityHeight}p thấp hơn ${bounds.minHeight}p`);
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
    else if (
      bounds.minHeight > 0 &&
      info.height > 0 &&
      !meetsMinimumResolution(info.width, info.height, bounds.minHeight)
    ) {
      // 1.8.0 việc B: nói rõ ô cần bật và bản sẽ nhận được, thay vì chỉ báo "không đạt".
      blockingReasons.push(
        `${message} Bật ô "${ALLOW_BELOW_MINIMUM_LABEL}" trong Cài đặt › Tải danh sách để lấy bản ${reportedQualityHeight}p.`
      );
    } else blockingReasons.push(message);
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
