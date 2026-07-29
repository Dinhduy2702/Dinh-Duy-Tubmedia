export const QUICK_DOWNLOAD_QUALITIES = ['best', '1080p', '720p', '480p'] as const;

export type QuickDownloadQuality = (typeof QUICK_DOWNLOAD_QUALITIES)[number];

export type QuickDownloadMode = 'full' | 'range';

export interface QuickDownloadRequest {
  url: string;
  outputDirectory: string;
  quality: QuickDownloadQuality;
  mode: QuickDownloadMode;
  startTime?: string;
  endTime?: string;
  accurateCut: boolean;
}

export type QuickDownloadPhase =
  'queued' | 'preparing' | 'downloading' | 'processing' | 'completed' | 'cancelling' | 'cancelled' | 'failed';

export interface QuickDownloadStatus {
  taskId: string;
  mode: QuickDownloadMode;
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
  warnings: string[];
}

export interface ValidatedQuickDownloadRequest extends QuickDownloadRequest {
  startSeconds: number | null;
  endSeconds: number | null;
}

const QUALITY_SET = new Set<QuickDownloadQuality>(QUICK_DOWNLOAD_QUALITIES);

export function parseQuickDownloadTime(value: string): number {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error('Thá»i gian khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng.');
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const seconds = Number(normalized);

    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('Thá»i gian khÃ´ng há»£p lá»‡.');
    }

    return seconds;
  }

  const parts = normalized.split(':');

  if (parts.length < 2 || parts.length > 3) {
    throw new Error('Thá»i gian pháº£i cÃ³ dáº¡ng MM:SS hoáº·c HH:MM:SS.');
  }

  if (!parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) {
    throw new Error('Thá»i gian chá»‰ Ä‘Æ°á»£c chá»©a sá»‘ vÃ  dáº¥u hai cháº¥m.');
  }

  const numbers = parts.map(Number);
  const secondsPart = numbers.at(-1) ?? Number.NaN;
  const minutesPart = numbers.at(-2) ?? Number.NaN;
  const hoursPart = numbers.length === 3 ? (numbers[0] ?? Number.NaN) : 0;

  if (secondsPart >= 60 || minutesPart >= 60 || hoursPart < 0 || !numbers.every(Number.isFinite)) {
    throw new Error('Má»‘c thá»i gian khÃ´ng há»£p lá»‡.');
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
    throw new Error('YÃªu cáº§u táº£i nhanh khÃ´ng há»£p lá»‡.');
  }

  const candidate = value as Partial<QuickDownloadRequest>;
  const urlText = typeof candidate.url === 'string' ? candidate.url.trim() : '';

  if (!urlText || urlText.length > 4096) {
    throw new Error('LiÃªn káº¿t video khÃ´ng há»£p lá»‡.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlText);
  } catch {
    throw new Error('LiÃªn káº¿t video khÃ´ng Ä‘Ãºng Ä‘á»‹nh dáº¡ng.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('Chá»‰ cháº¥p nháº­n liÃªn káº¿t HTTP hoáº·c HTTPS.');
  }

  const outputDirectory =
    typeof candidate.outputDirectory === 'string' ? candidate.outputDirectory.trim() : '';

  if (!outputDirectory || outputDirectory.length > 1024) {
    throw new Error('ThÆ° má»¥c lÆ°u video khÃ´ng há»£p lá»‡.');
  }

  if (candidate.mode !== 'full' && candidate.mode !== 'range') {
    throw new Error('Cháº¿ Ä‘á»™ táº£i nhanh khÃ´ng há»£p lá»‡.');
  }

  if (typeof candidate.quality !== 'string' || !QUALITY_SET.has(candidate.quality)) {
    throw new Error('Cháº¥t lÆ°á»£ng táº£i khÃ´ng há»£p lá»‡.');
  }

  const accurateCut = candidate.accurateCut === true;
  let startSeconds: number | null = null;
  let endSeconds: number | null = null;

  if (candidate.mode === 'range') {
    startSeconds = parseQuickDownloadTime(typeof candidate.startTime === 'string' ? candidate.startTime : '');
    endSeconds = parseQuickDownloadTime(typeof candidate.endTime === 'string' ? candidate.endTime : '');

    if (endSeconds <= startSeconds) {
      throw new Error('Thá»i gian káº¿t thÃºc pháº£i lá»›n hÆ¡n thá»i gian báº¯t Ä‘áº§u.');
    }

    if (endSeconds - startSeconds < 1) {
      throw new Error('Äoáº¡n video pháº£i dÃ i Ã­t nháº¥t 1 giÃ¢y.');
    }

    if (endSeconds > 24 * 60 * 60) {
      throw new Error('Má»‘c káº¿t thÃºc khÃ´ng Ä‘Æ°á»£c vÆ°á»£t quÃ¡ 24 giá».');
    }
  }

  return {
    url: parsedUrl.toString(),
    outputDirectory,
    quality: candidate.quality,
    mode: candidate.mode,
    ...(typeof candidate.startTime === 'string' ? { startTime: candidate.startTime } : {}),
    ...(typeof candidate.endTime === 'string' ? { endTime: candidate.endTime } : {}),
    accurateCut,
    startSeconds,
    endSeconds
  };
}
