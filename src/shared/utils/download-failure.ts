export type YtDlpFailureCategory =
  'disk' | 'tool' | 'rate_limit' | 'authentication' | 'non_retryable' | 'retryable';

export type YtDlpFailureSubtype =
  | 'disk_full'
  | 'tool_missing'
  | 'http_429'
  | 'authentication'
  | 'removed'
  | 'unsupported_url'
  | 'unavailable'
  | 'http_403'
  | 'fragment'
  | 'extractor'
  | 'network'
  | 'interrupted'
  | 'path_too_long'
  | 'unknown';

export interface YtDlpFailureDetail {
  category: YtDlpFailureCategory;
  subtype: YtDlpFailureSubtype;
  httpStatus: number | null;
  retryable: boolean;
}

type RetryableAppFailure = {
  code?: unknown;
  retryable?: unknown;
  details?: unknown;
};

const ALL_FAILURE_SUBTYPES: ReadonlySet<YtDlpFailureSubtype> = new Set([
  'disk_full',
  'tool_missing',
  'http_429',
  'authentication',
  'removed',
  'unsupported_url',
  'unavailable',
  'http_403',
  'fragment',
  'extractor',
  'network',
  'interrupted',
  'path_too_long',
  'unknown'
]);

const CIRCUIT_FAILURE_SUBTYPES: ReadonlySet<YtDlpFailureSubtype> = new Set([
  'http_403',
  'fragment',
  'extractor',
  'network'
]);

export function failureSubtypeFromDetails(details: unknown): YtDlpFailureSubtype | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const subtype = (details as Record<string, unknown>).failureSubtype;
  return typeof subtype === 'string' && ALL_FAILURE_SUBTYPES.has(subtype as YtDlpFailureSubtype)
    ? (subtype as YtDlpFailureSubtype)
    : null;
}

/**
 * The project circuit breaker is only for exhausted download failures that
 * actually point to the network, CDN or extractor. A retryable merge/process
 * failure must never pause unrelated downloads in the same project.
 */
export function isCircuitEligibleDownloadFailure(jobType: unknown, failure: RetryableAppFailure): boolean {
  if (jobType !== 'download' || failure.retryable !== true) return false;
  if (failure.code === 'NETWORK_ERROR') return true;
  if (failure.code !== 'DOWNLOAD_FAILED') return false;
  const subtype = failureSubtypeFromDetails(failure.details);
  return subtype !== null && CIRCUIT_FAILURE_SUBTYPES.has(subtype);
}

/**
 * DownloadEngine messages are intentionally neutral because the queue decides
 * whether another attempt exists. Once all attempts are exhausted, replace
 * them with a final message that does not incorrectly promise another retry.
 */
export function exhaustedDownloadFailureMessage(
  originalMessage: string,
  details: unknown,
  attempts: number
): string {
  const attemptCount = Math.max(1, Math.trunc(attempts));
  const attemptLabel = `sau ${attemptCount} lần thử`;
  const subtype = failureSubtypeFromDetails(details);
  if (subtype === 'http_403') {
    return `Máy chủ video vẫn từ chối yêu cầu (HTTP 403) ${attemptLabel}. Tubmedia đã dừng riêng video này và giữ tệp .part để có thể tiếp tục khi thử lại.`;
  }
  if (subtype === 'fragment') {
    return `Dữ liệu video vẫn bị gián đoạn ${attemptLabel}. Tubmedia đã dừng riêng video này và giữ tệp .part để có thể tiếp tục khi thử lại.`;
  }
  if (subtype === 'extractor') {
    return `Nền tảng chưa cung cấp dữ liệu video ổn định ${attemptLabel}. Tubmedia đã dừng riêng video này; dữ liệu tải dở vẫn được giữ an toàn.`;
  }
  if (subtype === 'interrupted') {
    return `Tiến trình tải vẫn bị dừng đột ngột ${attemptLabel} mà không có thông báo lỗi nào (ứng dụng, máy hoặc một phần mềm khác dừng nó). Tubmedia đã dừng riêng video này; dữ liệu tải dở vẫn được giữ để thử lại.`;
  }
  if (subtype === 'network') {
    return `Kết nối tới máy chủ video vẫn không ổn định ${attemptLabel}. Tubmedia đã dừng riêng video này và giữ dữ liệu tải dở để thử lại sau.`;
  }
  if (subtype === 'path_too_long') {
    return `Vẫn không lưu được video vì đường dẫn tệp quá dài ${attemptLabel}, dù Tubmedia đã rút ngắn tên tệp (Windows chỉ cho tối đa 260 ký tự). Hãy chọn thư mục lưu ngắn hơn, gần gốc ổ đĩa (ví dụ E:\\Video), rồi bấm Thử lại.`;
  }
  return originalMessage;
}

const YTDLP_FAILURE_CAUSES: Record<YtDlpFailureSubtype, string> = {
  disk_full: 'ổ đĩa không còn đủ dung lượng',
  tool_missing: 'thiếu công cụ tải (yt-dlp/ffmpeg/aria2c)',
  http_429: 'nền tảng đang giới hạn số lần tải (HTTP 429)',
  authentication: 'nền tảng yêu cầu đăng nhập hoặc cookies hợp lệ',
  removed: 'video đã bị xóa khỏi nền tảng',
  unsupported_url: 'liên kết không phải trang video (yt-dlp báo Unsupported URL)',
  unavailable: 'video không khả dụng (riêng tư, bị chặn theo vùng hoặc không còn định dạng phù hợp)',
  http_403: 'máy chủ video từ chối yêu cầu (HTTP 403)',
  fragment: 'một phần dữ liệu video bị gián đoạn',
  extractor: 'nền tảng chưa trả dữ liệu video ổn định',
  network: 'kết nối mạng hoặc máy chủ video không ổn định',
  interrupted: 'tiến trình tải bị dừng đột ngột, không có thông báo lỗi (ứng dụng hoặc máy bị tắt ngang, phần mềm khác dừng tiến trình)',
  path_too_long: 'đường dẫn tệp quá dài (Windows chỉ cho tối đa 260 ký tự)',
  unknown: 'chưa xác định — xem chi tiết kỹ thuật trong Nhật ký'
};

/**
 * Câu nhật ký YTDLP_DOWNLOAD_FAILED nêu NGUYÊN NHÂN đã phân loại (Đợt 5 mục 14: câu chung cũ khiến Chẩn đoán → "Lỗi gần
 * nhất" không nói được lỗi gì). Trang Chẩn đoán cũng dùng hàm này để dựng lại câu cho dòng nhật ký cũ từ metadata.
 */
export function ytDlpFailureLogMessage(subtype: YtDlpFailureSubtype | null): string {
  return `yt-dlp không hoàn tất được video: ${YTDLP_FAILURE_CAUSES[subtype ?? 'unknown']}.`;
}

/** Câu báo cho link không được hỗ trợ (Đợt 5 mục 19) — dùng ở DownloadEngine. */
export function unsupportedSourceUrlMessage(): string {
  return (
    'Liên kết này không được hỗ trợ: trang này không có video mà công cụ tải nhận ra (yt-dlp báo "Unsupported URL") — ' +
    'thường là trang báo, trang chủ, trang tìm kiếm hoặc liên kết rút gọn. Hãy mở đúng video, sao chép liên kết gốc của ' +
    'chính video đó rồi thêm lại vào danh sách.'
  );
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

/** Dòng "ERROR: …" (có thể kèm tiền tố "[extractor] ") hoặc Traceback của Python — dấu hiệu yt-dlp TỰ báo lỗi. */
const YTDLP_ERROR_MARKER = /(?:^|\n)\s*(?:\[[^\]\n]*\]\s*)?ERROR:|Traceback \(most recent call last\)/i;

/** Windows cổ điển: đường dẫn tối đa 259 ký tự (MAX_PATH 260 gồm ký tự kết thúc). */
const WINDOWS_PATH_LIMIT = 259;
/** Python báo không mở/tạo được tệp, kèm đường dẫn dạng repr ('…' hoặc "…", dấu "\" nhân đôi). */
const PYTHON_FILE_ERROR = /\[Errno (?:2|22)\][^'"\n]*?:\s*(?:'((?:[^'\\\n]|\\.)+)'|"((?:[^"\\\n]|\\.)+)")/g;
const WINDOWS_NAME_TOO_LONG = /\[WinError 206\]|filename or extension is too long|\[Errno 36\]|file name too long/i;

/**
 * 2026-10-23: độ dài (ký tự) của đường dẫn mà yt-dlp không ghi được vì vượt MAX_PATH — null nếu lỗi không phải do đường dẫn
 * dài. "[Errno 2] No such file or directory" cũng xảy ra khi thư mục thật sự không còn → chỉ tính khi đường dẫn ≥ 260 ký tự.
 * Windows báo thẳng tên quá dài (WinError 206 / Errno 36) → luôn tính, độ dài lấy từ đường dẫn nếu có.
 */
export function pathTooLongLength(text: string): number | null {
  let longest = 0;
  for (const match of text.matchAll(PYTHON_FILE_ERROR)) {
    const path = (match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1');
    longest = Math.max(longest, path.length);
  }
  if (longest > WINDOWS_PATH_LIMIT) return longest;
  if (WINDOWS_NAME_TOO_LONG.test(text)) return longest > 0 ? longest : WINDOWS_PATH_LIMIT + 1;
  return null;
}

export function classifyYtDlpFailure(text: string): YtDlpFailureDetail {
  const lower = text.toLowerCase();

  // Kiểm trước mọi loại khác: đường dẫn chứa nguyên tiêu đề video, mà tiêu đề có thể chứa "403", "fragment", "removed"…
  if (pathTooLongLength(text) !== null) {
    return { category: 'retryable', subtype: 'path_too_long', httpStatus: null, retryable: true };
  }

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

  // Đợt 5 mục 19: yt-dlp nói rõ link KHÔNG phải trang video nó tải được (trang báo, trang chủ, tìm kiếm...) — loại riêng,
  // không gộp vào "video không khả dụng".
  if (
    includesAny(lower, [
      'unsupported url',
      'no suitable extractor',
      'url could not be handled',
      'is not a valid url',
      'unknown url type'
    ])
  ) {
    return { category: 'non_retryable', subtype: 'unsupported_url', httpStatus: null, retryable: false };
  }

  if (
    includesAny(lower, [
      'private video',
      'video unavailable',
      'this video is unavailable',
      'video has been removed',
      'video has been deleted',
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

  // yt-dlp luôn in câu "ERROR: …" khi tự thất bại (Python sập thì có Traceback). Không có câu nào → tiến trình bị dừng ngang
  // từ bên ngoài (taskkill, tắt máy, phần mềm khác): thử lại được. 2026-10-16: trước đây rơi xuống "không khả dụng", không
  // thử lại — bài e2e Khởi động đỏ chập chờn trên CI (taskkill /T /F giết yt-dlp trước tiến trình chính vài ms).
  if (!YTDLP_ERROR_MARKER.test(text)) {
    return { category: 'retryable', subtype: 'interrupted', httpStatus: null, retryable: true };
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
