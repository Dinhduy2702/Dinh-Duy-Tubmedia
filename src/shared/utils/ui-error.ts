import { describeValidationIssues } from './validation-message.js';
import {
  NOTICE_TONE_LABEL,
  readTypedMessage,
  stripTypedMarker,
  type NoticeTone
} from './notice-tone.js';

export type UiTone = NoticeTone;

export interface FriendlyIssue {
  title: string;
  message: string;
  steps: string[];
  technical: string;
  tone: UiTone;
  /** Mã lỗi nghiệp vụ khi lỗi đến từ tiến trình chính (có dấu kiểu). */
  code?: string;
}

type UnknownRecord = Record<string, unknown>;

const USER_MESSAGE_LIMIT = 420;
const TECHNICAL_KEYS = new Set([
  'url',
  'workflow',
  'progressPhases',
  'cookieFailureConfirmed',
  'cookieRetryRequested',
  'metadata',
  'stack',
  'eventCode',
  'jobId',
  'projectId'
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function textField(record: UnknownRecord | null, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function stableTechnical(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

function parseStructuredString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function cleanRemotePrefix(raw: string): string {
  return stripTypedMarker(raw)
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^[A-Za-z]+Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s*\|\s*ERROR:\s*/gi, ' · ')
    .trim();
}

// Giai đoạn 2 (2026-09-25) — Phát hiện kiến trúc số 2: các heuristic cũ chỉ bắt JSON/mảng, stack trace
// và tên lớp lỗi JS — KHÔNG bắt được câu dạng "Nhãn tiếng Việt: LỖI_HỆ_ĐIỀU_HÀNH_THÔ" (vd
// `merge-engine.ts`: "Không thể commit thành phẩm an toàn: ENOENT: no such file..."), khiến lỗi hệ
// điều hành/Node.js thô lộ thẳng ra thông báo chính thay vì bị thay bằng câu an toàn. Thêm 2 nhóm mẫu:
// mã lỗi hệ điều hành/Node.js phổ biến, và tiền tố "TênLớpLỗi:" (SqliteError, AggregateError...) lồng
// giữa câu.
const RAW_OS_ERROR_CODES =
  /\b(?:ENOENT|EACCES|EPERM|EBUSY|EEXIST|ENOSPC|ECONNRESET|ETIMEDOUT|EPIPE|EMFILE|EISDIR|ENOTDIR|EAGAIN|ENOTEMPTY)\b/;
const RAW_ERROR_CLASS_PREFIX = /\b[A-Z][A-Za-z]*Error:\s/;
// Giai đoạn 3 (2026-09-25): PROCESSING_FAILED/MERGE_FAILED đôi khi dùng thẳng `stderrTail` của FFmpeg
// làm message (vd clip-engine.ts, normalize-engine.ts) — log FFmpeg có định dạng đặc trưng không lẫn
// với câu tiếng Việt bình thường: thẻ "[bộ mã hóa @ 0xĐỊA_CHỈ]" hoặc dòng liệt kê luồng "Stream #0:0".
const RAW_FFMPEG_LOG_PATTERN = /\[[a-z0-9_]+\s*@\s*0x[0-9a-f]+\]|Stream #\d+:\d+/i;

function isTechnicalText(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed === '[object Object]') return true;
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    (trimmed.endsWith('}') || trimmed.endsWith(']'))
  ) {
    return true;
  }
  if (/\n\s*at\s+/i.test(trimmed) || /\bat\s+[^\s]+\s*\([^)]*:\d+:\d+\)/i.test(trimmed)) return true;
  if (/\b(?:TypeError|ReferenceError|SyntaxError|UnhandledPromiseRejection)\b/i.test(trimmed)) return true;
  if (
    /\b(?:eventCode|jobId|projectId|progressPhases|cookieFailureConfirmed|cookieRetryRequested)\b/.test(
      trimmed
    )
  ) {
    return true;
  }
  if (RAW_OS_ERROR_CODES.test(trimmed)) return true;
  if (RAW_ERROR_CLASS_PREFIX.test(trimmed)) return true;
  if (RAW_FFMPEG_LOG_PATTERN.test(trimmed)) return true;
  return false;
}

function preferredMessage(value: unknown): string {
  if (value instanceof Error) return cleanRemotePrefix(value.message);
  if (typeof value === 'string') return cleanRemotePrefix(value);
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['message', 'resultMessage', 'errorMessage', 'reason', 'detail', 'description']) {
    const candidate = textField(record, key);
    if (candidate) return cleanRemotePrefix(candidate);
  }
  const nestedError = record.error;
  if (typeof nestedError === 'string') return cleanRemotePrefix(nestedError);
  if (nestedError instanceof Error) return cleanRemotePrefix(nestedError.message);
  return '';
}

function hasErrorSignal(record: UnknownRecord): boolean {
  return Boolean(
    textField(record, 'error') ||
    textField(record, 'errorMessage') ||
    textField(record, 'errorCode') ||
    record.success === false ||
    record.ok === false ||
    ['failed', 'error'].includes(textField(record, 'state').toLowerCase()) ||
    ['failed', 'error'].includes(textField(record, 'status').toLowerCase()) ||
    ['failed', 'error'].includes(textField(record, 'phase').toLowerCase())
  );
}

function completedResult(value: unknown): { message: string; outputPath: string } | null {
  const record = asRecord(value);
  if (!record || hasErrorSignal(record)) return null;
  const stage = [
    textField(record, 'progressStage'),
    textField(record, 'state'),
    textField(record, 'status'),
    textField(record, 'phase')
  ]
    .join(' ')
    .toLowerCase();
  const phases = Array.isArray(record.progressPhases) ? record.progressPhases : [];
  const phasesCompleted =
    phases.length > 0 &&
    phases.every((item) => {
      const phase = asRecord(item);
      return textField(phase, 'state').toLowerCase() === 'completed' || Number(phase?.percent) >= 100;
    });
  const resultMessage = textField(record, 'resultMessage');
  const completed =
    phasesCompleted ||
    /(?:đã\s+hoàn\s+tất|hoàn\s+tất|completed|downloaded|success)/i.test(stage) ||
    /^(?:đã\s+tải|đã\s+hoàn\s+tất|hoàn\s+tất)/i.test(resultMessage);
  if (!completed) return null;
  return {
    message: resultMessage || 'Tác vụ đã hoàn tất thành công.',
    outputPath: textField(record, 'outputPath')
  };
}

function containsTechnicalKeys(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return Object.keys(record).some((key) => TECHNICAL_KEYS.has(key));
}

function userMessage(raw: string, fallback: string): string {
  const cleaned = cleanRemotePrefix(raw).replace(/\s+/g, ' ').trim();
  if (!cleaned || isTechnicalText(cleaned)) return fallback;
  return cleaned.length > USER_MESSAGE_LIMIT
    ? `${cleaned.slice(0, USER_MESSAGE_LIMIT - 1).trim()}…`
    : cleaned;
}

function updaterNotice(raw: string): Pick<FriendlyIssue, 'title' | 'message' | 'tone'> | null {
  const lower = cleanRemotePrefix(raw).toLowerCase();
  if (!lower) return null;
  if (lower.includes('checking for update') || lower.includes('đang kiểm tra cập nhật')) {
    return {
      title: 'Đang kiểm tra cập nhật',
      message: 'Ứng dụng đang kiểm tra phiên bản mới trên máy chủ.',
      tone: 'info'
    };
  }
  if (
    (lower.includes('update for version') &&
      lower.includes('is not available') &&
      lower.includes('latest version')) ||
    lower.includes('you are using the latest version') ||
    lower.includes('đang sử dụng phiên bản mới nhất')
  ) {
    return {
      title: 'Ứng dụng đã được cập nhật',
      message: 'Bạn đang sử dụng phiên bản mới nhất.',
      tone: 'info'
    };
  }
  if (
    lower.includes('update downloaded') ||
    lower.includes('update has already been downloaded') ||
    lower.includes('bản cập nhật đã sẵn sàng')
  ) {
    return {
      title: 'Bản cập nhật đã sẵn sàng',
      message: 'Bản cập nhật đã tải xong và sẵn sàng để cài đặt.',
      tone: 'success'
    };
  }
  if (lower.includes('update available') || lower.includes('đã phát hiện bản cập nhật')) {
    return {
      title: 'Có bản cập nhật mới',
      message: 'Một phiên bản mới hơn đã sẵn sàng. Mở Trung tâm cập nhật để xem chi tiết.',
      tone: 'info'
    };
  }
  return null;
}

export function safeUiText(value: unknown, fallback = 'Không thể hoàn tất thao tác.'): string {
  const structured = typeof value === 'string' ? parseStructuredString(value) : value;
  const completed = completedResult(structured);
  if (completed) return userMessage(completed.message, 'Tác vụ đã hoàn tất thành công.');
  const preferred = preferredMessage(structured);
  const update = updaterNotice(preferred);
  if (update) return update.message;
  return userMessage(preferred, fallback);
}

function classifyIssue(value: unknown): FriendlyIssue {
  const structured = typeof value === 'string' ? parseStructuredString(value) : value;
  const technical = stableTechnical(structured);
  const completed = completedResult(structured);
  if (completed) {
    return {
      title: 'Đã hoàn tất',
      message: completed.outputPath
        ? 'Tệp đã được tải và kiểm tra thành công. Bạn có thể mở vị trí tệp từ trang Tiến trình.'
        : userMessage(completed.message, 'Tác vụ đã hoàn tất thành công.'),
      steps: [],
      technical,
      tone: 'success'
    };
  }

  const raw = preferredMessage(structured);
  const cleaned = cleanRemotePrefix(raw);
  const validation = describeValidationIssues(cleaned);
  if (validation) {
    return {
      title: 'Dữ liệu chưa hợp lệ',
      message: validation,
      steps: ['Sửa lại ô được nêu ở trên rồi thử lại.'],
      technical,
      tone: 'warning'
    };
  }
  const lower = cleaned.toLowerCase();
  const update = updaterNotice(cleaned);
  if (update) {
    return {
      ...update,
      steps: [],
      technical
    };
  }

  if (/^(?:đã\s+hủy|thao\s+tác\s+đã\s+hủy|tác\s+vụ\s+đã\s+(?:bị\s+)?hủy|cancelled|canceled)/i.test(cleaned)) {
    return {
      title: 'Đã hủy thao tác',
      message:
        'Yêu cầu đã được dừng theo lựa chọn của bạn. Dữ liệu đã hoàn tất trước đó vẫn được giữ nguyên.',
      steps: [],
      technical,
      tone: 'neutral'
    };
  }
  if (/^không\s+có\s+gì\s+để/i.test(cleaned)) {
    return {
      title: 'Không có gì để làm',
      message: userMessage(cleaned, 'Hiện không có mục nào cần xử lý.'),
      steps: [],
      technical,
      tone: 'neutral'
    };
  }
  if (/^(?:hãy\s+chọn|vui\s+lòng|chỉ\s+hỗ\s+trợ|cần\s+chọn)/i.test(cleaned)) {
    return {
      title: 'Cần bổ sung thông tin',
      message: userMessage(cleaned, 'Hãy kiểm tra lại lựa chọn rồi thử lại.'),
      steps: [],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('cookies_expired') ||
    lower.includes('cookies đã cấu hình không còn') ||
    lower.includes('cookies đã hết hạn')
  ) {
    return {
      title: 'Cookies đã hết hạn hoặc không còn hợp lệ',
      message:
        'Nền tảng đã từ chối phiên đăng nhập hiện tại. Chỉ danh sách liên quan được tạm dừng; các luồng khác vẫn tiếp tục.',
      steps: [
        'Đăng nhập lại vào tài khoản có quyền xem video.',
        'Xuất hoặc dán cookies mới trong đúng danh sách.',
        'Lưu cookies; ứng dụng sẽ tự tiếp tục video đang bị chặn.'
      ],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('invalid_cookie_text') ||
    lower.includes('định dạng netscape') ||
    lower.includes('nội dung cookies đang trống')
  ) {
    return {
      title: 'Nội dung cookies chưa đúng định dạng',
      message:
        'Nội dung vừa dán hoặc tệp vừa chọn chưa phải cookies.txt dạng Netscape mà ứng dụng có thể sử dụng.',
      steps: [
        'Xuất cookies ở định dạng Netscape cookies.txt.',
        'Dán toàn bộ nội dung, gồm các cột ngăn bằng tab.',
        'Không dán mật khẩu hoặc mã xác minh.'
      ],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('could not copy chrome cookie database') ||
    lower.includes('browser_cookie_database_locked') ||
    lower.includes('khóa cơ sở dữ liệu đăng nhập') ||
    lower.includes('cookie database is locked') ||
    (lower.includes('could not copy') && lower.includes('cookie database'))
  ) {
    return {
      title: 'Trình duyệt đang khóa dữ liệu đăng nhập',
      message:
        'Ứng dụng chưa thể lấy cookies trực tiếp vì Chrome hoặc Edge vẫn đang sử dụng cơ sở dữ liệu đăng nhập.',
      steps: [
        'Đóng hoàn toàn Chrome hoặc Edge. Nếu vừa đóng cửa sổ mà vẫn gặp lỗi này, trình duyệt có ' +
          'thể đang chạy ẩn trong nền — mở Task Manager (Ctrl+Shift+Esc), tìm mọi tiến trình ' +
          '"chrome.exe" hoặc "msedge.exe" còn sót lại và chọn Kết thúc tác vụ.',
        'Thử lại bằng tùy chọn Trình duyệt; trên Windows có thể ưu tiên Firefox.',
        'Hoặc dùng Dán trực tiếp / Chọn tệp cookies.txt.'
      ],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('authentication_required') ||
    lower.includes('cần đăng nhập') ||
    lower.includes('cookies hợp lệ')
  ) {
    return {
      title: 'Video cần đăng nhập hoặc cookies',
      message:
        'Chỉ video này đã được tạm dừng; các video phía sau và các danh sách khác vẫn tiếp tục bình thường.',
      steps: [
        'Mở khung Cookies trong đúng danh sách.',
        'Chọn trình duyệt, dán cookies hoặc chọn tệp cookies.',
        'Lưu cookies; video bị chặn sẽ tự quay lại hàng đợi.'
      ],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('enoent') ||
    lower.includes('tool_not_found') ||
    lower.includes('tool_health_check_failed') ||
    lower.includes('thiếu công cụ') ||
    // Giai đoạn 3 (2026-09-25): ToolNotFoundError tự viết "Không tìm thấy công cụ X." — trước đây
    // không khớp cụm nào ở đây nên rơi vào nhánh mặc định (tiêu đề chung, gợi ý không đúng chỗ).
    lower.includes('không tìm thấy công cụ')
  ) {
    return {
      title: 'Thiếu công cụ xử lý video',
      message: 'Một công cụ bắt buộc chưa sẵn sàng. Hàng đợi đã được giữ nguyên để tránh tạo lỗi hàng loạt.',
      steps: [
        'Mở Trung tâm công cụ.',
        'Nhấn Kiểm tra lại; nếu vẫn lỗi, chọn Sửa chữa tất cả.',
        'Tiếp tục tác vụ khi các công cụ bắt buộc báo Sẵn sàng.'
      ],
      technical,
      tone: 'error'
    };
  }
  if (lower.includes('disk_full') || lower.includes('no space') || lower.includes('không đủ dung lượng')) {
    return {
      title: 'Ổ đĩa không đủ dung lượng',
      message: 'Danh sách đã tạm dừng trước khi ghi thêm dữ liệu để tránh làm hỏng tệp.',
      steps: ['Giải phóng dung lượng hoặc đổi thư mục lưu.', 'Nhấn Tiếp tục sau khi đã xử lý.'],
      technical,
      tone: 'error'
    };
  }
  if (
    lower.includes('permission_denied') ||
    lower.includes('không có quyền') ||
    lower.includes('permission denied')
  ) {
    return {
      title: 'Không thể ghi vào thư mục đã chọn',
      message: 'Windows đang chặn quyền truy cập hoặc đường dẫn không còn tồn tại.',
      steps: ['Chọn thư mục khác trên ổ dữ liệu.', 'Kiểm tra ổ đĩa còn kết nối rồi thử lại.'],
      technical,
      tone: 'error'
    };
  }
  if (
    lower.includes('network_circuit_open') ||
    lower.includes('mạng/cdn') ||
    lower.includes('mạng hoặc máy chủ')
  ) {
    return {
      title: 'Mạng hoặc máy chủ nguồn đang không ổn định',
      message: 'Ứng dụng đã tạm dừng đúng danh sách để tránh thử lại liên tục.',
      steps: ['Kiểm tra kết nối mạng và cookies.', 'Nhấn Tiếp tục khi kết nối ổn định.'],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('http 403') ||
    lower.includes('http error 403') ||
    lower.includes('403 forbidden') ||
    /máy chủ video.*từ chối/.test(lower)
  ) {
    return {
      title: 'Máy chủ video tạm thời từ chối tải',
      message:
        'Video này chưa tải xong vì máy chủ nguồn trả về HTTP 403. Dữ liệu đã tải dở vẫn được giữ để tiếp tục ở lần thử sau.',
      steps: [
        'Không xóa tệp .part trong thư mục tải.',
        'Chờ một lúc rồi chọn Thử lại đúng video.',
        'Nếu nhiều video cùng lỗi, kiểm tra cookies, proxy và kết nối mạng.'
      ],
      technical,
      tone: 'warning'
    };
  }
  if (
    lower.includes('một phần dữ liệu video bị gián đoạn') ||
    lower.includes('dữ liệu video vẫn bị gián đoạn') ||
    lower.includes('fragment') ||
    lower.includes('did not get any data blocks')
  ) {
    return {
      title: 'Luồng tải video bị gián đoạn',
      message:
        'Một phần dữ liệu từ máy chủ nguồn chưa tải được. Dữ liệu hoàn chỉnh trước đó và tệp .part vẫn được giữ an toàn.',
      steps: [
        'Không xóa tệp .part trong thư mục tải.',
        'Chờ kết nối ổn định rồi chọn Thử lại đúng video.',
        'Mở Nhật ký riêng nếu cùng video tiếp tục bị gián đoạn.'
      ],
      technical,
      tone: 'warning'
    };
  }
  /* TUBMEDIA VISUAL OUTPUT ISSUE R33 */
  if (
    lower.includes('visual-integrity-verification') ||
    lower.includes('lỗi hình ảnh') ||
    lower.includes('lỗi giải mã hình ảnh') ||
    lower.includes('đoạn hình đen') ||
    lower.includes('hình đứng bất thường')
  ) {
    return {
      title: 'Phát hiện lỗi hình ảnh trong thành phẩm',
      message: userMessage(
        cleaned,
        'Tubmedia đã chặn file trước khi xuất vì hậu kiểm phát hiện frame lỗi, đoạn đen bất thường hoặc hình đứng kéo dài. File lỗi không được dùng làm thành phẩm.'
      ),
      steps: [
        'Xem mốc thời gian và video nguồn gần nhất trong trạng thái chi tiết.',
        'Kiểm tra clip nguồn quanh mốc đó; Tubmedia đã tự thử mã hóa lại nếu lỗi nằm gần điểm nối.',
        'Thay clip nguồn nếu cần rồi chạy lại. Chi tiết kỹ thuật đầy đủ vẫn nằm trong Nhật ký.'
      ],
      technical,
      tone: 'error'
    };
  }

  if (
    lower.includes('thời lượng lệch') ||
    lower.includes('timestamp bất thường') ||
    lower.includes('verify-merged-output')
  ) {
    return {
      title: 'Thời lượng thành phẩm chưa hợp lệ',
      message:
        'Một hoặc nhiều video nguồn có mốc thời gian bất thường. Thành phẩm chưa được xác nhận để bảo vệ dữ liệu.',
      steps: [
        'Mở Nhật ký của quy trình để xem video nguồn liên quan.',
        'Chạy lại quy trình sau khi cập nhật hoặc thay video nguồn lỗi.'
      ],
      technical,
      tone: 'error'
    };
  }

  const fallback =
    containsTechnicalKeys(structured) || isTechnicalText(cleaned)
      ? 'Ứng dụng chưa thể hoàn tất thao tác này. Chi tiết kỹ thuật đã được lưu trong Nhật ký để hỗ trợ kiểm tra.'
      : 'Ứng dụng gặp sự cố chưa xác định. Trạng thái hiện tại vẫn được giữ an toàn.';
  return {
    title: 'Không thể hoàn tất thao tác',
    message: userMessage(cleaned, fallback),
    steps: [
      'Kiểm tra lại dữ liệu hoặc lựa chọn vừa thực hiện.',
      'Mở Nhật ký nếu sự cố lặp lại.',
      'Thử lại đúng thao tác sau khi đã xử lý nguyên nhân.'
    ],
    technical,
    tone: 'error'
  };
}

const GENERIC_FALLBACK_TITLE = 'Không thể hoàn tất thao tác';

const TYPED_FALLBACK_TITLE: Record<NoticeTone, string> = {
  error: GENERIC_FALLBACK_TITLE,
  warning: 'Cần chú ý',
  info: 'Thông tin',
  success: 'Đã hoàn tất',
  neutral: 'Đã ghi nhận'
};

interface KnownCodeFallback {
  title?: string;
  message?: string;
  steps?: string[];
}

// Giai đoạn 2 (2026-09-25) — Phát hiện kiến trúc số 1: trước đây, một lỗi có MÃ đã biết nhưng nội dung
// chữ không khớp cụm nào ở classifyIssue() (vd `ToolNotFoundError`, `MergeFailedError` với message tự
// do không trùng mẫu) bị rơi vào nhánh mặc định RỒI BỊ GHI ĐÈ thành tiêu đề chung chung ("Không thể
// hoàn tất thao tác") và STEPS BỊ XÓA SẠCH — tệ hơn cả một lỗi lạ không có mã (lỗi lạ vẫn giữ được 3 gợi
// ý mặc định của classifyIssue()). Bảng này cho MỖI mã đã biết một tiêu đề đúng ngữ cảnh — CHỈ áp dụng
// khi nội dung không khớp nhánh cụ thể nào (nếu đã khớp, nhánh đó đã có tiêu đề/gợi ý phù hợp riêng).
//
// Giai đoạn 3 (2026-09-25) — rà lại bảng kiểm kê Giai đoạn 1 sau khi có kiến trúc trên: với các mã có
// message LUÔN theo một khuôn cố định (một điểm gọi duy nhất, hoặc mọi biến thể đều na ná nhau về mức
// "kỹ thuật"), an toàn để thay cả `message`/`steps` bằng nội dung đã đề xuất và người dùng đã duyệt.
// CỐ TÌNH KHÔNG thay `message` cho các mã có nhiều điểm gọi với chất lượng khác nhau (DOWNLOAD_FAILED,
// PROCESSING_FAILED, MERGE_FAILED) — một vài thông điệp ở đó đã đủ tốt (vd "Mốc cắt không hợp lệ...");
// thay message hàng loạt sẽ xóa mất phần đã tốt. Các mã đó chỉ nhận `title` chung, message gốc giữ
// nguyên, dựa vào bước 2 (`isTechnicalText()`) để chặn phần lộ kỹ thuật thô nếu có.
const KNOWN_CODE_FALLBACK: Partial<Record<string, KnownCodeFallback>> = {
  // Dự phòng: nhánh "enoent" ở trên đã mở rộng để bắt luôn message gốc "Không tìm thấy công cụ X." nên
  // trường hợp này hiếm khi còn rơi tới đây — giữ lại phòng khi ToolNotFoundError đổi cách viết sau này.
  TOOL_NOT_FOUND: { title: 'Thiếu công cụ xử lý video' },
  TOOL_HEALTH_CHECK_FAILED: {
    title: 'Công cụ xử lý video hoạt động bất thường',
    message: 'Một công cụ xử lý video đang hoạt động không bình thường.',
    steps: ['Mở Trung tâm công cụ.', 'Chọn Sửa chữa tất cả nếu vẫn báo lỗi.']
  },
  SOURCE_REMOVED: {
    title: 'Video không còn khả dụng',
    steps: ['Hãy kiểm tra lại link hoặc bỏ qua video này.']
  },
  DOWNLOAD_FAILED: { title: 'Không thể tải xong video' },
  VERIFICATION_FAILED: {
    title: 'Không thể xác nhận tệp vừa tạo',
    message: 'Tubmedia không thể kiểm tra tệp video vừa tạo — có thể tệp bị lỗi khi ghi.',
    steps: ['Thử lại thao tác; nếu lặp lại, video nguồn có thể bị hỏng.']
  },
  PROCESSING_FAILED: { title: 'Xử lý video gặp lỗi' },
  MERGE_FAILED: { title: 'Không thể ghép video' },
  UPDATE_FAILED: {
    title: 'Không thể cập nhật công cụ xử lý video',
    message: 'Tubmedia không tải hoặc xác minh được bản cập nhật của công cụ xử lý video.',
    steps: [
      'Kiểm tra kết nối mạng rồi thử lại.',
      'Vẫn có thể dùng phiên bản công cụ hiện tại — không ảnh hưởng tác vụ đang chạy.'
    ]
  },
  ROLLBACK_FAILED: {
    title: 'Không thể khôi phục phiên bản công cụ trước đó',
    steps: ['Chạy lại Kiểm tra/Sửa chữa trong Trung tâm công cụ để tải lại công cụ từ đầu.']
  },
  DATABASE_MIGRATION_FAILED: {
    title: 'Không thể nâng cấp dữ liệu ứng dụng',
    message:
      'Tubmedia không thể nâng cấp đúng cách dữ liệu ứng dụng khi khởi động. Dữ liệu cũ vẫn được giữ nguyên, chưa bị thay đổi.',
    steps: [
      'Khởi động lại ứng dụng.',
      'Nếu lặp lại, sao lưu thư mục dữ liệu rồi liên hệ hỗ trợ kèm Chi tiết kỹ thuật.'
    ]
  },
  PROCESS_SPAWN_FAILED: {
    title: 'Không thể khởi chạy công cụ xử lý video',
    message: 'Tubmedia không thể khởi chạy công cụ xử lý video.',
    steps: ['Mở Trung tâm công cụ → Kiểm tra lại/Sửa chữa tất cả.', 'Tắt tạm thời phần mềm diệt virus nếu vẫn lỗi.']
  },
  PROCESS_TIMEOUT: {
    title: 'Một bước xử lý chạy quá lâu',
    message: 'Bước xử lý video này chạy quá lâu nên đã bị dừng để tránh treo ứng dụng.',
    steps: [
      'Thử lại; nếu máy đang chạy nhiều việc cùng lúc, hãy giảm số quy trình song song trong Cài đặt.'
    ]
  }
};

function typedRaw(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return record ? preferredMessage(record) : '';
}

/**
 * Mức (tone) ưu tiên lấy từ dấu KIỂU do bên chính gắn vào lỗi (xem notice-tone.ts). Chỉ khi lỗi
 * không có dấu kiểu (lỗi lạ, chưa phân loại) mới dùng cách nhận diện theo nội dung như trước.
 */
export function friendlyIssue(value: unknown): FriendlyIssue {
  const issue = classifyIssue(value);
  const typed = readTypedMessage(typedRaw(value));
  if (!typed) return issue;
  const generic = issue.title === GENERIC_FALLBACK_TITLE;
  if (!generic) return { ...issue, tone: typed.tone, code: typed.code };
  const known = KNOWN_CODE_FALLBACK[typed.code];
  return {
    ...issue,
    tone: typed.tone,
    code: typed.code,
    title: known?.title ?? TYPED_FALLBACK_TITLE[typed.tone],
    ...(known?.message ? { message: known.message } : {}),
    ...(known?.steps ? { steps: known.steps } : {})
  };
}

/** Nhãn chữ của mức, dùng chung cho mọi thành phần hiển thị thông báo. */
export function issueToneLabel(tone: UiTone): string {
  return NOTICE_TONE_LABEL[tone];
}
