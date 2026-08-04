export type UiTone = 'info' | 'success' | 'warning' | 'error';

export interface FriendlyIssue {
  title: string;
  message: string;
  steps: string[];
  technical: string;
  tone: UiTone;
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
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^[A-Za-z]+Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s*\|\s*ERROR:\s*/gi, ' · ')
    .trim();
}

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
  if (/\b(?:eventCode|jobId|projectId|progressPhases|cookieFailureConfirmed|cookieRetryRequested)\b/.test(trimmed)) {
    return true;
  }
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
  return cleaned.length > USER_MESSAGE_LIMIT ? `${cleaned.slice(0, USER_MESSAGE_LIMIT - 1).trim()}…` : cleaned;
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
    (lower.includes('update for version') && lower.includes('is not available') && lower.includes('latest version')) ||
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

export function friendlyIssue(value: unknown): FriendlyIssue {
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
  const lower = cleaned.toLowerCase();
  const update = updaterNotice(cleaned);
  if (update) {
    return {
      ...update,
      steps: [],
      technical
    };
  }

  if (/^(?:đã\s+hủy|thao\s+tác\s+đã\s+hủy|cancelled|canceled)/i.test(cleaned)) {
    return {
      title: 'Đã hủy thao tác',
      message: 'Yêu cầu đã được dừng theo lựa chọn của bạn. Dữ liệu đã hoàn tất trước đó vẫn được giữ nguyên.',
      steps: [],
      technical,
      tone: 'info'
    };
  }
  if (/^(?:hãy\s+chọn|vui\s+lòng|chỉ\s+hỗ\s+trợ|cần\s+chọn|không\s+có\s+gì\s+để)/i.test(cleaned)) {
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
        'Đóng hoàn toàn Chrome hoặc Edge, kể cả tiến trình chạy nền.',
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
    lower.includes('thiếu công cụ')
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
      tone: 'warning'
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
      tone: 'warning'
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

  const fallback = containsTechnicalKeys(structured) || isTechnicalText(cleaned)
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
