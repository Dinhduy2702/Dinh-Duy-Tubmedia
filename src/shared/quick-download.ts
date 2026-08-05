export const QUICK_DOWNLOAD_QUALITIES = ['best', '1080p', '720p', '480p'] as const;

export type QuickDownloadQuality = (typeof QUICK_DOWNLOAD_QUALITIES)[number];

export type QuickDownloadMode = 'full' | 'range';

export const QUICK_DOWNLOAD_MEDIA_MODES = ['video-audio', 'audio-only', 'video-only'] as const;
export type QuickDownloadMediaMode = (typeof QUICK_DOWNLOAD_MEDIA_MODES)[number];

export type QuickDownloadErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'COOKIES_EXPIRED'
  | 'BROWSER_COOKIE_DATABASE_LOCKED'
  | 'UNSUPPORTED_URL'
  | 'OUTPUT_PATH_INVALID';

export interface QuickDownloadRequest {
  url: string;
  outputDirectory: string;
  quality: QuickDownloadQuality;
  mediaMode?: QuickDownloadMediaMode;
  mode: QuickDownloadMode;
  startTime?: string;
  endTime?: string;
  accurateCut: boolean;
  downloadSubtitles?: boolean;
  subtitleLanguage?: string;
  downloadThumbnail?: boolean;
  writeMetadata?: boolean;
}

export type QuickDownloadPhase =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'processing'
  | 'verifying'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'interrupted'
  | 'failed';

export interface QuickDownloadStatus {
  taskId: string;
  mode: QuickDownloadMode;
  mediaMode: QuickDownloadMediaMode;
  phase: QuickDownloadPhase;
  progress: number;
  title: string;
  message: string;
  speed: string;
  eta: string;
  downloadedBytes: number;
  totalBytes: number;
  outputPath: string | null;
  outputDirectory: string;
  requestedStartSeconds: number | null;
  requestedEndSeconds: number | null;
  actualDurationSeconds: number | null;
  accurateCut: boolean;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  errorCode: QuickDownloadErrorCode | null;
  warnings: string[];
}

export type ValidatedQuickDownloadRequest = Omit<
  QuickDownloadRequest,
  'mediaMode' | 'downloadSubtitles' | 'subtitleLanguage' | 'downloadThumbnail' | 'writeMetadata'
> & {
  mediaMode: QuickDownloadMediaMode;
  downloadSubtitles: boolean;
  subtitleLanguage: string;
  downloadThumbnail: boolean;
  writeMetadata: boolean;
  startSeconds: number | null;
  endSeconds: number | null;
};

const QUALITY_SET = new Set<QuickDownloadQuality>(QUICK_DOWNLOAD_QUALITIES);
const MEDIA_MODE_SET = new Set<QuickDownloadMediaMode>(QUICK_DOWNLOAD_MEDIA_MODES);
export const MAX_QUICK_DOWNLOAD_HOURS = 9_999;
export const MAX_QUICK_DOWNLOAD_SECONDS = MAX_QUICK_DOWNLOAD_HOURS * 60 * 60 + 59 * 60 + 59;

export function parseQuickDownloadTime(value: string): number {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error('Thời lượng không được để trống.');
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const seconds = Number(normalized);

    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_QUICK_DOWNLOAD_SECONDS) {
      throw new Error(`Thời lượng phải nằm trong khoảng 0 đến ${MAX_QUICK_DOWNLOAD_HOURS}:59:59.`);
    }

    return seconds;
  }

  const parts = normalized.split(':');

  if (parts.length < 2 || parts.length > 3) {
    throw new Error('Thời lượng phải có dạng MM:SS hoặc HH:MM:SS.');
  }

  if (!parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) {
    throw new Error('Thời lượng chỉ được chứa số và dấu hai chấm.');
  }

  const numbers = parts.map(Number);
  const secondsPart = numbers.at(-1) ?? Number.NaN;
  const minutesPart = numbers.at(-2) ?? Number.NaN;
  const hoursPart = numbers.length === 3 ? (numbers[0] ?? Number.NaN) : 0;

  if (
    secondsPart >= 60 ||
    minutesPart >= 60 ||
    hoursPart < 0 ||
    hoursPart > MAX_QUICK_DOWNLOAD_HOURS ||
    !numbers.every(Number.isFinite)
  ) {
    throw new Error(`Mốc thời lượng không hợp lệ hoặc vượt quá ${MAX_QUICK_DOWNLOAD_HOURS}:59:59.`);
  }

  return hoursPart * 3600 + minutesPart * 60 + secondsPart;
}

export function formatQuickDownloadTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours > 0) {
    return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  return [minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function validateQuickDownloadRequest(value: unknown): ValidatedQuickDownloadRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Yêu cầu tải nhanh không hợp lệ.');
  }

  const candidate = value as Partial<QuickDownloadRequest>;
  const urlText = typeof candidate.url === 'string' ? candidate.url.trim() : '';

  if (!urlText || urlText.length > 4_096) {
    throw new Error('Liên kết video không hợp lệ.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlText);
  } catch {
    throw new Error('Liên kết video không đúng định dạng.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('Chỉ chấp nhận liên kết HTTP hoặc HTTPS không chứa thông tin đăng nhập.');
  }

  const outputDirectory =
    typeof candidate.outputDirectory === 'string' ? candidate.outputDirectory.trim() : '';

  if (!outputDirectory || outputDirectory.length > 1_024) {
    throw new Error('Thư mục lưu video không hợp lệ.');
  }

  if (candidate.mode !== 'full' && candidate.mode !== 'range') {
    throw new Error('Chế độ tải nhanh không hợp lệ.');
  }

  if (typeof candidate.quality !== 'string' || !QUALITY_SET.has(candidate.quality)) {
    throw new Error('Chất lượng tải không hợp lệ.');
  }

  const accurateCut = candidate.accurateCut === true;
  const mediaMode =
    typeof candidate.mediaMode === 'string' && MEDIA_MODE_SET.has(candidate.mediaMode)
      ? candidate.mediaMode
      : 'video-audio';
  const downloadSubtitles = candidate.downloadSubtitles === true;
  const subtitleLanguage =
    typeof candidate.subtitleLanguage === 'string' && candidate.subtitleLanguage.trim()
      ? candidate.subtitleLanguage.trim().slice(0, 64)
      : 'vi,en';
  const downloadThumbnail = candidate.downloadThumbnail === true;
  const writeMetadata = candidate.writeMetadata === true;
  let startSeconds: number | null = null;
  let endSeconds: number | null = null;

  if (candidate.mode === 'range') {
    startSeconds = parseQuickDownloadTime(typeof candidate.startTime === 'string' ? candidate.startTime : '');
    endSeconds = parseQuickDownloadTime(typeof candidate.endTime === 'string' ? candidate.endTime : '');

    if (endSeconds <= startSeconds) {
      throw new Error('Mốc kết thúc phải lớn hơn mốc bắt đầu.');
    }

    if (endSeconds - startSeconds < 1) {
      throw new Error('Đoạn video phải dài ít nhất 1 giây.');
    }
  }

  return {
    url: parsedUrl.toString(),
    outputDirectory,
    quality: candidate.quality,
    mediaMode,
    mode: candidate.mode,
    ...(typeof candidate.startTime === 'string' ? { startTime: candidate.startTime } : {}),
    ...(typeof candidate.endTime === 'string' ? { endTime: candidate.endTime } : {}),
    accurateCut,
    downloadSubtitles,
    subtitleLanguage,
    downloadThumbnail,
    writeMetadata,
    startSeconds,
    endSeconds
  };
}
