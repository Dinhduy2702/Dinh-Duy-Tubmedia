import {
  formatQuickDownloadTime,
  type QuickDownloadMediaMode,
  type ValidatedQuickDownloadRequest
} from '@shared/quick-download.js';
import type { AppSettings } from '@shared/types/domain.js';

export interface QuickDownloadCommandPaths {
  ffmpegDirectory: string;
  tempDirectory: string;
  runToken: string;
  outputToken?: string;
}

export interface QuickDownloadCommandOptions {
  compactFilename?: boolean;
  forceGenericExtractor?: boolean;
}

export type QuickDownloadAuthentication = Pick<
  AppSettings,
  'cookiesFilePath' | 'cookiesBrowser' | 'cookiesBrowserProfile'
>;

const VIDEO_AUDIO_SELECTORS = {
  best: 'bv*+ba/b',
  '1080p': 'bv*[height<=1080]+ba/b[height<=1080]/b',
  '720p': 'bv*[height<=720]+ba/b[height<=720]/b',
  '480p': 'bv*[height<=480]+ba/b[height<=480]/b'
} as const;

const VIDEO_ONLY_SELECTORS = {
  best: 'bv*[ext=mp4]/bv*',
  '1080p': 'bv*[ext=mp4][height<=1080]/bv*[height<=1080]/bv*',
  '720p': 'bv*[ext=mp4][height<=720]/bv*[height<=720]/bv*',
  '480p': 'bv*[ext=mp4][height<=480]/bv*[height<=480]/bv*'
} as const;

function selectorFor(request: ValidatedQuickDownloadRequest): string {
  if (request.mediaMode === 'audio-only') return 'ba/b';
  if (request.mediaMode === 'video-only') return VIDEO_ONLY_SELECTORS[request.quality];
  return VIDEO_AUDIO_SELECTORS[request.quality];
}

function extensionFor(mode: QuickDownloadMediaMode): string {
  return mode === 'audio-only' ? 'm4a' : '%(ext)s';
}

function safeRangeSuffix(request: ValidatedQuickDownloadRequest): string {
  if (request.mode !== 'range' || request.startSeconds === null || request.endSeconds === null) {
    return '';
  }

  const start = formatQuickDownloadTime(request.startSeconds).replaceAll(':', '-');
  const end = formatQuickDownloadTime(request.endSeconds).replaceAll(':', '-');
  return ` [${start}-${end}]`;
}

export function buildQuickDownloadArguments(
  request: ValidatedQuickDownloadRequest,
  paths: QuickDownloadCommandPaths,
  authentication?: QuickDownloadAuthentication,
  options: QuickDownloadCommandOptions = {}
): string[] {
  const filenameToken = paths.outputToken ?? paths.runToken;
  const outputTemplate = options.compactFilename
    ? `Video [%(id)s]${safeRangeSuffix(request)} [QD-${filenameToken}].${extensionFor(request.mediaMode)}`
    : `%(title).80B [%(id)s]${safeRangeSuffix(request)} [QD-${filenameToken}].${extensionFor(request.mediaMode)}`;

  const args = [
    '--ignore-config',
    '--no-playlist',
    '--newline',
    '--no-color',
    '--windows-filenames',
    '--trim-filenames',
    '128',
    '--continue',
    '--no-overwrites',
    '--no-post-overwrites',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
    '--retry-sleep',
    'fragment:exp=1:20',
    '--concurrent-fragments',
    '4',
    '--ffmpeg-location',
    paths.ffmpegDirectory,
    '-P',
    `home:${request.outputDirectory}`,
    '-P',
    `temp:${paths.tempDirectory}`,
    '-o',
    outputTemplate,
    '-f',
    selectorFor(request),
    '--progress-template',
    [
      'download:TUBMEDIA_PROGRESS',
      '%(progress._percent_str)s',
      '%(progress._speed_str)s',
      '%(progress._eta_str)s',
      '%(progress.downloaded_bytes)s',
      '%(progress.total_bytes_estimate)s'
    ].join('|'),
    '--print',
    'before_dl:TUBMEDIA_TITLE|%(title)s',
    '--print',
    'after_move:TUBMEDIA_FILE|%(filepath)s'
  ];

  if (request.mediaMode === 'video-audio') {
    args.push('--merge-output-format', 'mp4');
  } else if (request.mediaMode === 'audio-only') {
    args.push('--extract-audio', '--audio-format', 'm4a', '--audio-quality', '0');
  }

  if (request.downloadSubtitles) {
    args.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      request.subtitleLanguage,
      '--convert-subs',
      'srt'
    );
  }

  if (request.downloadThumbnail) {
    args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  }

  if (request.writeMetadata) {
    args.push('--write-info-json', '--write-description');
  }

  if (request.mode === 'range' && request.startSeconds !== null && request.endSeconds !== null) {
    args.push('--download-sections', `*${request.startSeconds}-${request.endSeconds}`);
    if (request.accurateCut) args.push('--force-keyframes-at-cuts');
  }

  if (authentication?.cookiesFilePath) {
    args.push('--cookies', authentication.cookiesFilePath);
  } else if (authentication && authentication.cookiesBrowser !== 'none') {
    const browserSpec = authentication.cookiesBrowserProfile
      ? `${authentication.cookiesBrowser}:${authentication.cookiesBrowserProfile}`
      : authentication.cookiesBrowser;
    args.push('--cookies-from-browser', browserSpec);
  }

  if (options.forceGenericExtractor) {
    args.push('--ies', 'generic,default');
  }

  args.push(request.url);
  return args;
}
