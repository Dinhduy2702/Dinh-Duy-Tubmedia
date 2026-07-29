import { formatQuickDownloadTime, type ValidatedQuickDownloadRequest } from '@shared/quick-download.js';

export interface QuickDownloadCommandPaths {
  ffmpegDirectory: string;
  tempDirectory: string;
  runToken: string;
}

const FORMAT_SELECTORS = {
  best: 'bv*+ba/b',
  '1080p': 'bv*[height<=1080]+ba/b[height<=1080]/b',
  '720p': 'bv*[height<=720]+ba/b[height<=720]/b',
  '480p': 'bv*[height<=480]+ba/b[height<=480]/b'
} as const;

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
  paths: QuickDownloadCommandPaths
): string[] {
  const outputTemplate =
    `%(title).160B [%(id)s]${safeRangeSuffix(request)}` + ` [QD-${paths.runToken}].%(ext)s`;

  const args = [
    '--ignore-config',
    '--no-playlist',
    '--newline',
    '--no-color',
    '--windows-filenames',
    '--trim-filenames',
    '220',
    '--continue',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
    '--retry-sleep',
    'fragment:exp=1:20',
    '--concurrent-fragments',
    '4',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    paths.ffmpegDirectory,
    '-P',
    `home:${request.outputDirectory}`,
    '-P',
    `temp:${paths.tempDirectory}`,
    '-o',
    outputTemplate,
    '-f',
    FORMAT_SELECTORS[request.quality],
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

  if (request.mode === 'range' && request.startSeconds !== null && request.endSeconds !== null) {
    args.push('--download-sections', `*${request.startSeconds}-${request.endSeconds}`);

    if (request.accurateCut) {
      args.push('--force-keyframes-at-cuts');
    }
  }

  args.push(request.url);
  return args;
}
