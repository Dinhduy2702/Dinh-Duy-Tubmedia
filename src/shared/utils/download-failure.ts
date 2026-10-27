export type YtDlpFailureCategory =
  'disk' | 'tool' | 'rate_limit' | 'authentication' | 'non_retryable' | 'retryable';

export type YtDlpFailureSubtype =
  | 'disk_full'
  | 'tool_missing'
  | 'http_429'
  | 'authentication'
  | 'bot_check'
  | 'cookies_invalid'
  | 'removed'
  | 'unsupported_url'
  | 'unavailable'
  | 'http_403'
  | 'fragment'
  | 'extractor'
  | 'network'
  | 'interrupted'
  | 'path_too_long'
  // 2026-10-27 (rà soát trước 1.7.3): lỗi yt-dlp còn rơi vào "chưa xác định" hoặc báo lệch.
  | 'format_unavailable'
  | 'live'
  | 'not_found'
  | 'file_access'
  | 'ssl'
  | 'postprocess'
  // Lỗi Tubmedia tự phát hiện sau khi tải (không đến từ yt-dlp).
  | 'file_invalid'
  | 'video_short'
  | 'audio_lost'
  | 'quality_unmet'
  | 'remux_failed'
  | 'edit_copy_failed'
  | 'encoder_missing'
  | 'name_conflict'
  | 'source_missing'
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
  'bot_check',
  'cookies_invalid',
  'removed',
  'unsupported_url',
  'unavailable',
  'http_403',
  'fragment',
  'extractor',
  'network',
  'interrupted',
  'path_too_long',
  'format_unavailable',
  'live',
  'not_found',
  'file_access',
  'ssl',
  'postprocess',
  'file_invalid',
  'video_short',
  'audio_lost',
  'quality_unmet',
  'remux_failed',
  'edit_copy_failed',
  'encoder_missing',
  'name_conflict',
  'source_missing',
  'unknown'
]);

const CIRCUIT_FAILURE_SUBTYPES: ReadonlySet<YtDlpFailureSubtype> = new Set([
  'http_403',
  'fragment',
  'extractor',
  'network',
  'ssl'
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
  if (subtype === 'file_access') {
    return `Vẫn không ghi được tệp ${attemptLabel}: tệp đang bị chương trình khác khoá (trình phát, diệt virus, đồng bộ đám mây…) hoặc thư mục thiếu quyền ghi. Đóng chương trình đang mở tệp hoặc chọn thư mục khác rồi bấm Thử lại.`;
  }
  if (subtype === 'ssl') {
    return `Vẫn lỗi kết nối bảo mật (SSL/chứng chỉ) ${attemptLabel} — thường do proxy, mạng công ty hoặc phần mềm diệt virus chặn. Kiểm tra proxy/diệt virus rồi bấm Thử lại.`;
  }
  if (subtype === 'postprocess') {
    return `Bước ghép hình + tiếng (FFmpeg) sau khi tải vẫn lỗi ${attemptLabel}. Vào Trung tâm công cụ chọn Sửa chữa tất cả rồi bấm Thử lại.`;
  }
  if (subtype === 'video_short' || subtype === 'audio_lost' || subtype === 'file_invalid') {
    return `Tệp tải về vẫn bị hỏng ${attemptLabel} (${YTDLP_FAILURE_CAUSES[subtype]}). Tệp lỗi nằm trong khu cách ly; thử lại sau, hoặc chọn chất lượng khác.`;
  }
  return originalMessage;
}

const YTDLP_FAILURE_CAUSES: Record<YtDlpFailureSubtype, string> = {
  disk_full: 'ổ đĩa không còn đủ dung lượng',
  tool_missing: 'thiếu công cụ tải (yt-dlp/ffmpeg/aria2c)',
  http_429: 'nền tảng đang giới hạn số lần tải (HTTP 429)',
  authentication: 'nền tảng yêu cầu đăng nhập hoặc cookies hợp lệ',
  bot_check: 'YouTube tạm chặn vì nghi tải tự động ("Sign in to confirm you’re not a bot") — giới hạn theo lượng yêu cầu, không phải cookie hỏng',
  cookies_invalid: 'cookies không còn hợp lệ (yt-dlp báo cookie đã bị xoay/thu hồi)',
  removed: 'video đã bị xóa khỏi nền tảng',
  unsupported_url: 'liên kết không phải trang video (yt-dlp báo Unsupported URL)',
  unavailable: 'video không khả dụng (riêng tư, bị chặn theo vùng hoặc không còn định dạng phù hợp)',
  http_403: 'máy chủ video từ chối yêu cầu (HTTP 403)',
  fragment: 'một phần dữ liệu video bị gián đoạn',
  extractor: 'nền tảng chưa trả dữ liệu video ổn định',
  network: 'kết nối mạng hoặc máy chủ video không ổn định',
  interrupted: 'tiến trình tải bị dừng đột ngột, không có thông báo lỗi (ứng dụng hoặc máy bị tắt ngang, phần mềm khác dừng tiến trình)',
  path_too_long: 'đường dẫn tệp quá dài (Windows chỉ cho tối đa 260 ký tự)',
  format_unavailable: 'không có định dạng nào khớp cài đặt chất lượng (video vẫn còn trên nền tảng)',
  live: 'video đang phát trực tiếp hoặc sắp công chiếu — chưa có bản tải được',
  not_found: 'liên kết không còn tồn tại (HTTP 404/410)',
  file_access: 'không ghi được tệp: tệp đang bị chương trình khác khoá hoặc thiếu quyền ghi',
  ssl: 'lỗi kết nối bảo mật (SSL/chứng chỉ) — thường do mạng, proxy hoặc phần mềm diệt virus chặn',
  postprocess: 'bước ghép hình + tiếng (FFmpeg) sau khi tải bị lỗi',
  file_invalid: 'tệp tải về bị hỏng nên đã chuyển vào khu cách ly',
  video_short: 'tệp tải về bị hụt hình (hình ngắn hơn tiếng)',
  audio_lost: 'tệp tải về bị mất tiếng',
  quality_unmet: 'không có bản nào đạt giới hạn chất lượng đã đặt',
  remux_failed: 'đóng gói lại sang MP4 bị lỗi',
  edit_copy_failed: 'tạo bản dựng CapCut bị lỗi',
  encoder_missing: 'FFmpeg thiếu bộ mã hoá cần cho bản dựng CapCut',
  name_conflict: 'trùng tên tệp với video nguồn của danh sách khác',
  source_missing: 'thiếu dữ liệu nguồn video của danh sách',
  unknown: 'chưa xác định — xem chi tiết kỹ thuật trong Nhật ký'
};

/**
 * 2026-10-27: câu cho lượt thất bại SẼ được thử lại — nói đúng nguyên nhân (trước đây mọi loại ngoài 403/gián đoạn/mảnh đều
 * thành "mạng không ổn định", kể cả tệp bị khoá hay lỗi ghép FFmpeg).
 */
export function retryableDownloadFailureMessage(subtype: YtDlpFailureSubtype): string {
  switch (subtype) {
    case 'http_403':
      return 'Máy chủ video tạm thời từ chối yêu cầu (HTTP 403).';
    case 'interrupted':
      return 'Tiến trình tải bị dừng đột ngột mà không có thông báo lỗi nào (ứng dụng, máy hoặc một phần mềm khác dừng nó). Tubmedia sẽ thử tải lại video này.';
    case 'fragment':
      return 'Một phần dữ liệu video bị gián đoạn.';
    case 'file_access':
      return 'Không ghi được tệp: tệp đang bị chương trình khác khoá (trình phát, diệt virus…) hoặc thiếu quyền ghi. Tubmedia sẽ thử lại.';
    case 'ssl':
      return 'Lỗi kết nối bảo mật (SSL/chứng chỉ) — thường do mạng, proxy hoặc phần mềm diệt virus chặn. Tubmedia sẽ thử lại.';
    case 'postprocess':
      return 'Bước ghép hình + tiếng (FFmpeg) sau khi tải bị lỗi. Tubmedia sẽ thử lại.';
    case 'extractor':
      return 'Nền tảng chưa trả dữ liệu video ổn định.';
    default:
      return 'Kết nối mạng hoặc máy chủ video đang không ổn định.';
  }
}

/** 2026-10-27: câu cho lỗi KHÔNG thử lại — nêu nguyên nhân cụ thể (tên nền tảng nếu biết) thay vì "lỗi không xác định". */
export function finalDownloadFailureMessage(subtype: YtDlpFailureSubtype, platformLabel: string | null): string {
  const where = platformLabel?.trim() || 'nền tảng gốc';
  switch (subtype) {
    case 'format_unavailable':
      return `Video vẫn còn trên ${where} nhưng không có định dạng nào khớp cài đặt chất lượng hiện tại (độ phân giải / FPS / bitrate / codec). Hãy nới giới hạn chất lượng trong Cài đặt › Tải danh sách rồi bấm Thử lại.`;
    case 'live':
      return `Video đang phát trực tiếp hoặc sắp công chiếu trên ${where} — chưa có bản tải được. Hãy thử lại sau khi buổi phát kết thúc và ${where} đã lưu bản ghi.`;
    case 'not_found':
      return `Liên kết không còn tồn tại trên ${where} (HTTP 404/410) — video có thể đã bị xoá hoặc link sai. Kiểm tra lại link trong trình duyệt.`;
    case 'unavailable':
      return `Video không khả dụng trên ${where} (riêng tư, bị gỡ hoặc bị chặn theo vùng). Mở link trong trình duyệt để xem lý do cụ thể.`;
    default:
      return 'Không tải được video này vì một lỗi không xác định do công cụ tải (yt-dlp) báo về. Mở Nhật ký riêng của danh sách để xem chi tiết kỹ thuật; nếu lỗi lặp lại, hãy gửi gói chẩn đoán cho bên hỗ trợ.';
  }
}

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

  // 2026-10-27 (điều tra "cookie hỏng sau vài phút"): yt-dlp nói RÕ cookie YouTube không còn hợp lệ (bị xoay/thu hồi) — đây
  // mới là dấu hiệu cookie hỏng thật. Kiểm trước 429 vì câu này chắc chắn hơn mọi lỗi khác cùng lượt.
  if (
    includesAny(lower, [
      'cookies are no longer valid',
      'account cookies are no longer valid',
      'have likely been rotated',
      'cookies have been rotated'
    ])
  ) {
    return { category: 'authentication', subtype: 'cookies_invalid', httpStatus: null, retryable: false };
  }

  if (
    includesAny(lower, ['http error 429', 'status code 429', 'too many requests', '429 too many requests'])
  ) {
    return { category: 'rate_limit', subtype: 'http_429', httpStatus: 429, retryable: false };
  }

  // "Sign in to confirm you’re not a bot": YouTube chặn tạm theo lượng yêu cầu từ một địa chỉ IP (nhật ký 27/10: cả video
  // KHÔNG gắn cookie cũng dính, rồi vài phút sau tự hết). Không phải cookie hỏng — tách riêng để hàng đợi nghỉ với YouTube
  // rồi tự tiếp tục như HTTP 429, thay vì báo "cookie hết hạn".
  if (
    // Chỉ câu "not a bot" — KHÔNG dùng "sign in to confirm" chung: "Sign in to confirm your age" là video giới hạn độ tuổi, cần
    // đăng nhập thật (rà soát 2026-10-27).
    includesAny(lower, ['confirm you are not a bot', "confirm you're not a bot", 'confirm you’re not a bot', 'not a bot']) &&
    !includesAny(lower, ['confirm your age'])
  ) {
    return { category: 'authentication', subtype: 'bot_check', httpStatus: null, retryable: false };
  }

  if (
    includesAny(lower, [
      // 2026-10-27: Vimeo "The web client only works when logged-in … provide account credentials" (nhật ký 22/10 ra "chưa xác định").
      'only works when logged-in',
      'http error 401',
      'status code 401',
      'provide account credentials',
      'use --cookies-from-browser',
      'use --cookies for the authentication',
      'cookies for the authentication',
      'login required',
      'authentication required',
      'members-only',
      'age-restricted',
      'confirm your age',
      'inappropriate for some users'
    ])
  ) {
    return {
      category: 'authentication',
      subtype: 'authentication',
      httpStatus: null,
      retryable: false
    };
  }

  // 2026-10-27 (rà soát trước 1.7.3): các lỗi trước đây rơi vào "chưa xác định" hoặc báo lệch.
  // Video đang phát trực tiếp / sắp công chiếu — chưa có bản tải được (khác video bị gỡ).
  if (
    includesAny(lower, [
      'live event will begin',
      'premieres in',
      'premiere will begin',
      'will begin in a few moments',
      'this live event has ended',
      'is currently live',
      'live streams are not supported'
    ])
  ) {
    return { category: 'non_retryable', subtype: 'live', httpStatus: null, retryable: false };
  }
  // Không có định dạng khớp cài đặt chất lượng: video VẪN còn — trước đây báo nhầm "không còn khả dụng".
  if (includesAny(lower, ['requested format is not available', 'no video formats found'])) {
    return { category: 'non_retryable', subtype: 'format_unavailable', httpStatus: null, retryable: false };
  }
  if (includesAny(lower, ['http error 404', 'http error 410', 'status code 404', 'status code 410', '404: not found', '410: gone'])) {
    return { category: 'non_retryable', subtype: 'not_found', httpStatus: lower.includes('410') ? 410 : 404, retryable: false };
  }
  // Tệp bị chương trình khác khoá / thiếu quyền ghi — thường tự hết (diệt virus, trình phát đang mở tệp) nên vẫn thử lại.
  if (
    includesAny(lower, [
      'permission denied',
      'access is denied',
      '[winerror 5]',
      '[winerror 32]',
      'being used by another process',
      'permissionerror',
      '[errno 13]'
    ])
  ) {
    return { category: 'retryable', subtype: 'file_access', httpStatus: null, retryable: true };
  }
  if (includesAny(lower, ['certificate verify failed', 'ssl:', 'sslerror', 'ssl error', 'tlsv1 alert', 'unsafe legacy renegotiation'])) {
    return { category: 'retryable', subtype: 'ssl', httpStatus: null, retryable: true };
  }
  if (includesAny(lower, ['postprocessing:', 'conversion failed', 'error merging', 'ffmpeg exited with code'])) {
    return { category: 'retryable', subtype: 'postprocess', httpStatus: null, retryable: true };
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
      'not available in your country'
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
