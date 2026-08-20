export type YtDlpFailureCategory =
  'disk' | 'tool' | 'rate_limit' | 'authentication' | 'non_retryable' | 'retryable';

export type YtDlpFailureSubtype =
  | 'disk_full'
  | 'tool_missing'
  | 'http_429'
  | 'authentication'
  | 'removed'
  | 'unavailable'
  | 'http_403'
  | 'fragment'
  | 'extractor'
  | 'network'
  | 'unknown';

export interface YtDlpFailureDetail {
  category: YtDlpFailureCategory;
  subtype: YtDlpFailureSubtype;
  httpStatus: number | null;
  retryable: boolean;
}

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function isExplicitlyRemovedYoutubeSource(text: string): boolean {
  const lower = text.toLowerCase();
  return includesAny(lower, [
    'this video has been removed',
    'video has been removed',
    'removed by the uploader',
    'removed for violating youtube',
    "removed for violating youtube's",
    'removed due to',
    'video has been deleted',
    'this video was removed',
    'account associated with this video has been terminated',
    'this video is no longer available because the youtube account',
    'this video is no longer available because the account'
  ]);
}

export function classifyYtDlpFailure(text: string): YtDlpFailureDetail {
  const lower = text.toLowerCase();

  if (isExplicitlyRemovedYoutubeSource(lower)) {
    return {
      category: 'non_retryable',
      subtype: 'removed',
      httpStatus: null,
      retryable: false
    };
  }

  if (includesAny(lower, ['no space left on device', 'disk full', 'not enough space', 'enospc'])) {
    return { category: 'disk', subtype: 'disk_full', httpStatus: null, retryable: false };
  }

  if (
    includesAny(lower, [
      'yt-dlp was not found',
      'yt-dlp.exe was not found',
      'ffmpeg was not found',
      'aria2c was not found',
      'is not recognized as an internal or external command'
    ])
  ) {
    return { category: 'tool', subtype: 'tool_missing', httpStatus: null, retryable: false };
  }

  if (
    includesAny(lower, ['http error 429', 'status code 429', 'too many requests', '429 too many requests'])
  ) {
    return { category: 'rate_limit', subtype: 'http_429', httpStatus: 429, retryable: false };
  }

  if (
    includesAny(lower, [
      'sign in to confirm',
      'confirm you are not a bot',
      "confirm you're not a bot",
      'confirm you’re not a bot',
      'not a bot',
      'use --cookies-from-browser',
      'use --cookies for the authentication',
      'cookies for the authentication',
      'login required',
      'authentication required',
      'members-only',
      'age-restricted'
    ])
  ) {
    return {
      category: 'authentication',
      subtype: 'authentication',
      httpStatus: null,
      retryable: false
    };
  }

  if (
    includesAny(lower, [
      'private video',
      'video unavailable',
      'this video is unavailable',
      'video has been removed',
      'video has been deleted',
      'unsupported url',
      'unsupported url:',
      'geo-restricted',
      'not available in your country',
      'requested format is not available',
      'no video formats found'
    ])
  ) {
    return {
      category: 'non_retryable',
      subtype: 'unavailable',
      httpStatus: null,
      retryable: false
    };
  }

  if (includesAny(lower, ['http error 403', 'status code 403', '403 forbidden', 'forbidden'])) {
    return { category: 'retryable', subtype: 'http_403', httpStatus: 403, retryable: true };
  }

  if (
    includesAny(lower, [
      'fragment',
      'did not get any data blocks',
      'unable to download video data',
      'unable to download audio data'
    ])
  ) {
    return { category: 'retryable', subtype: 'fragment', httpStatus: null, retryable: true };
  }

  if (
    includesAny(lower, [
      'extractor error',
      'extractor failed',
      'unable to extract',
      'failed to extract',
      'signature extraction',
      'nsig extraction'
    ])
  ) {
    return { category: 'retryable', subtype: 'extractor', httpStatus: null, retryable: true };
  }

  if (
    includesAny(lower, [
      'timed out',
      'timeout',
      'connection reset',
      'connection aborted',
      'connection refused',
      'remote end closed connection',
      'temporary failure',
      'temporarily unavailable',
      'network is unreachable',
      'name resolution',
      'cdn',
      'read error',
      'connection error',
      'http error 500',
      'http error 502',
      'http error 503',
      'http error 504'
    ])
  ) {
    return { category: 'retryable', subtype: 'network', httpStatus: null, retryable: true };
  }

  return { category: 'non_retryable', subtype: 'unknown', httpStatus: null, retryable: false };
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.search && !url.hash) return raw;
    return `${url.origin}${url.pathname}?[REDACTED]`;
  } catch {
    return raw.replace(/[?#].*$/, '?[REDACTED]');
  }
}

function stripAnsi(text: string): string {
  const escape = String.fromCharCode(27);
  return text
    .split(escape)
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
    .join('');
}

export function sanitizeYtDlpDiagnostic(text: string, maxLength = 1_600): string {
  const stripped = stripAnsi(text)
    .replace(/https?:\/\/[^\s"'<>|]+/giu, (value) => redactUrl(value))
    .replace(
      /\b(authorization|cookie|cookies|token|po[_ -]?token|pot|signature|sig|secret|api[_ -]?key)\b\s*[:=]\s*[^\s|,;]+/giu,
      '$1=[REDACTED]'
    )
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/-]+=*/giu, '$1 [REDACTED]');

  const lines = [
    ...new Set(
      stripped
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ];
  const important = lines.filter((line) =>
    /error|failed|unable|forbidden|429|403|fragment|timeout|cookie|sign in|bot|unavailable|extract/i.test(
      line
    )
  );
  const chosen = (important.length ? important : lines).slice(-8).join(' | ');
  if (!chosen) return 'yt-dlp không cung cấp thêm chi tiết.';
  return chosen.length <= maxLength ? chosen : `${chosen.slice(0, maxLength - 3)}...`;
}
