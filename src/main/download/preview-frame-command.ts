import type { AppSettings } from '@shared/types/domain.js';

/** Đủ để chắc chắn có ít nhất 1 khung hình hoàn chỉnh; không cần dài hơn — càng ngắn càng ít dữ liệu. */
export const PREVIEW_WINDOW_SECONDS = 1;

export interface PreviewFrameCommandPaths {
  ffmpegDirectory: string;
  workDirectory: string;
}

export type PreviewFrameCookieSettings = Pick<
  AppSettings,
  'cookiesFilePath' | 'cookiesBrowser' | 'cookiesBrowserProfile'
>;

function cookieArguments(settings?: PreviewFrameCookieSettings): string[] {
  if (!settings) return [];
  if (settings.cookiesFilePath) return ['--cookies', settings.cookiesFilePath];
  if (settings.cookiesBrowser !== 'none') {
    const spec = settings.cookiesBrowserProfile
      ? `${settings.cookiesBrowser}:${settings.cookiesBrowserProfile}`
      : settings.cookiesBrowser;
    return ['--cookies-from-browser', spec];
  }
  return [];
}

/**
 * Tải đúng MỘT đoạn rất ngắn (mặc định 1 giây) quanh mốc thời gian đã chọn — chỉ lấy video, chất lượng
 * thấp nhất có, không âm thanh — đủ để ffmpeg trích 1 khung hình mà không cần tải nguyên video.
 */
export function buildPreviewFrameDownloadArguments(
  url: string,
  timestampSeconds: number,
  paths: PreviewFrameCommandPaths,
  cookies?: PreviewFrameCookieSettings
): string[] {
  const start = Math.max(0, timestampSeconds);
  const end = start + PREVIEW_WINDOW_SECONDS;
  return [
    '--ignore-config',
    '--no-playlist',
    '--no-color',
    '--windows-filenames',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--ffmpeg-location',
    paths.ffmpegDirectory,
    '-P',
    `home:${paths.workDirectory}`,
    '-P',
    `temp:${paths.workDirectory}`,
    '-o',
    'preview.%(ext)s',
    // Chỉ lấy VIDEO, chất lượng thấp nhất có — đủ để trích 1 khung hình, không cần âm thanh.
    '-f',
    'wv*[height<=360]/w[height<=360]/wv*/w',
    '--download-sections',
    `*${start}-${end}`,
    '--force-keyframes-at-cuts',
    ...cookieArguments(cookies),
    '--',
    url
  ];
}

export function buildFrameExtractArguments(clipPath: string, framePath: string): string[] {
  return ['-y', '-i', clipPath, '-frames:v', '1', '-q:v', '3', framePath];
}
