/**
 * Mức độ thông báo có KIỂU: giao diện không được đoán mức từ nội dung chữ.
 *
 *  - error   : việc đang làm bị hỏng thật (đỏ);
 *  - warning : việc vẫn chạy được nhưng cần chú ý, hoặc thiếu điều kiện để làm tiếp (vàng);
 *  - info    : thông tin, tiến trình đang chạy (xanh dương);
 *  - success : hoàn tất (xanh lá);
 *  - neutral : kết quả bình thường do người dùng chủ động hoặc không có việc gì: đã hủy,
 *              tạm dừng, bỏ qua, không có gì để dọn (xám trung tính).
 */
export const NOTICE_TONES = ['error', 'warning', 'info', 'success', 'neutral'] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

/** Nhãn chữ luôn đi kèm biểu tượng để người dùng không phải phân biệt chỉ bằng màu. */
export const NOTICE_TONE_LABEL: Record<NoticeTone, string> = {
  error: 'Lỗi',
  warning: 'Cảnh báo',
  info: 'Thông tin',
  success: 'Thành công',
  neutral: 'Đã ghi nhận'
};

export function isNoticeTone(value: unknown): value is NoticeTone {
  return typeof value === 'string' && (NOTICE_TONES as readonly string[]).includes(value);
}

/** Vai trò trợ năng: chỉ lỗi và cảnh báo mới "ngắt lời" trình đọc màn hình. */
export function noticeAriaRole(tone: NoticeTone): 'alert' | 'status' {
  return tone === 'error' || tone === 'warning' ? 'alert' : 'status';
}

const ERROR_CODES: ReadonlySet<string> = new Set([
  'TOOL_NOT_FOUND',
  'TOOL_HEALTH_CHECK_FAILED',
  'DISK_FULL',
  'PERMISSION_DENIED',
  'DOWNLOAD_FAILED',
  'VERIFICATION_FAILED',
  'PROCESSING_FAILED',
  'MERGE_FAILED',
  'ROLLBACK_FAILED',
  'DATABASE_MIGRATION_FAILED',
  'PROCESS_SPAWN_FAILED'
]);

const WARNING_CODES: ReadonlySet<string> = new Set([
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED',
  'INVALID_COOKIE_TEXT',
  'INVALID_INPUT',
  'SOURCE_RATE_LIMITED',
  'NETWORK_ERROR',
  'NETWORK_CIRCUIT_OPEN',
  'PROCESS_TIMEOUT',
  'UPDATE_BLOCKED_ACTIVE_WORK',
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_INSTALL_PREPARATION_FAILED',
  'UPDATE_FAILED'
]);

const INFO_CODES: ReadonlySet<string> = new Set([
  'RETRY_WITH_CONFIGURED_COOKIES',
  'UPDATE_NOT_NEWER',
  'DISK_SPACE_RECOVERED_INFO'
]);

const NEUTRAL_CODES: ReadonlySet<string> = new Set(['PROCESS_CANCELLED', 'SOURCE_REMOVED']);

/** Mã lỗi chưa biết được coi là lỗi thật (an toàn hơn là nói nhẹ đi). */
export function toneForErrorCode(code: string | null | undefined): NoticeTone {
  const key = (code ?? '').toUpperCase();
  if (NEUTRAL_CODES.has(key)) return 'neutral';
  if (INFO_CODES.has(key)) return 'info';
  if (WARNING_CODES.has(key)) return 'warning';
  if (ERROR_CODES.has(key)) return 'error';
  return 'error';
}

const STATUS_TONES: Record<string, NoticeTone> = {
  completed: 'success',
  success: 'success',
  healthy: 'success',
  valid: 'success',
  done: 'success',
  ok: 'success',
  failed: 'error',
  error: 'error',
  broken: 'error',
  invalid: 'error',
  warning: 'warning',
  warn: 'warning',
  fatal: 'error',
  info: 'info',
  debug: 'neutral',
  interrupted: 'warning',
  blocked: 'warning',
  degraded: 'warning',
  analyzing: 'info',
  downloading: 'info',
  downloaded: 'info',
  verifying: 'info',
  normalizing: 'info',
  processing: 'info',
  merging: 'info',
  retrying: 'info',
  installing: 'info',
  checking: 'info',
  running: 'info',
  active: 'info',
  paused: 'neutral',
  cancelled: 'neutral',
  canceled: 'neutral',
  skipped: 'neutral',
  pending: 'neutral',
  ready: 'neutral',
  idle: 'neutral',
  draft: 'neutral',
  archived: 'neutral',
  unknown: 'neutral'
};

/** Mức của một trạng thái tác vụ/công cụ. Trạng thái lạ là trung tính, không bao giờ là lỗi. */
export function toneForStatus(status: string): NoticeTone {
  const key = status.trim().toLowerCase();
  const exact = STATUS_TONES[key];
  if (exact) return exact;
  const partial = Object.keys(STATUS_TONES).find((name) => name.length >= 5 && key.includes(name));
  return partial ? (STATUS_TONES[partial] ?? 'neutral') : 'neutral';
}

/**
 * Lỗi đi qua IPC của Electron chỉ còn `message`, các thuộc tính như `code` bị mất. Bên chính gắn
 * thêm một dấu KIỂU ở đầu thông điệp; bên giao diện đọc dấu này (và luôn gỡ nó khỏi chữ hiển thị).
 */
const TYPED_MARKER = /\[\[tm:(error|warning|info|success|neutral):([A-Z0-9_]{1,64})\]\]\s*/;

export interface TypedMessage {
  tone: NoticeTone;
  code: string;
  message: string;
}

export function encodeTypedMessage(tone: NoticeTone, code: string, message: string): string {
  const safeCode = code.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64) || 'UNKNOWN';
  return `[[tm:${tone}:${safeCode}]] ${message}`;
}

export function readTypedMessage(raw: string): TypedMessage | null {
  const match = TYPED_MARKER.exec(raw);
  if (!match) return null;
  const tone = match[1];
  const code = match[2];
  if (!isNoticeTone(tone) || !code) return null;
  return { tone, code, message: raw.replace(TYPED_MARKER, '').trim() };
}

/** Gỡ dấu kiểu khỏi chữ hiển thị (an toàn với chuỗi không có dấu). */
export function stripTypedMarker(raw: string): string {
  return raw.replace(TYPED_MARKER, '');
}

export type DetailTone = 'neutral' | 'good' | 'warning' | 'danger' | 'info';

/** Biến thể của CompactDetail/InfoDisclosure ứng với một mức thông báo. */
export function detailToneFor(tone: NoticeTone): DetailTone {
  if (tone === 'error') return 'danger';
  if (tone === 'success') return 'good';
  return tone;
}

/** Tên biến CSS màu CHỮ của mức (dùng cho chữ ngắn không nằm trong khung Notice). */
export function toneTextVar(tone: NoticeTone): string {
  return `var(--tone-${tone}-text)`;
}

/** Mã lỗi đã được phân loại rõ ràng (test bắt buộc mọi mã của AppError phải nằm trong danh sách này). */
export function isKnownErrorCode(code: string): boolean {
  const key = code.toUpperCase();
  return NEUTRAL_CODES.has(key) || INFO_CODES.has(key) || WARNING_CODES.has(key) || ERROR_CODES.has(key);
}
