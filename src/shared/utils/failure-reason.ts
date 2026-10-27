/**
 * 2026-10-27 (người dùng yêu cầu): thông báo lỗi phải nêu NGUYÊN NHÂN ngay, không bắt mở Nhật ký. Câu lý do NGẮN (vài chữ),
 * có tên nền tảng gốc — dùng cho thông báo từng video và thông báo gộp nhiều video ("2 video — Video đã bị xoá khỏi
 * YouTube; 1 video — Máy chủ Facebook từ chối tải").
 */
export interface FailureReasonInput {
  /** Mã lỗi của tác vụ (DOWNLOAD_FAILED, MERGE_FAILED, NETWORK_ERROR…). */
  code: string;
  /** failureSubtype do bộ tải phân loại (removed, unavailable, http_403…), nếu có. */
  subtype?: string | null;
  /** Câu gốc của công cụ tải (đã che bí mật) — dùng để phân biệt riêng tư / bị xoá / chặn theo vùng. */
  technicalSummary?: string | null;
  /** Tên nền tảng dễ đọc (YouTube, Facebook…); không rõ thì null. */
  platformLabel?: string | null;
  jobType?: string;
}

export function failureReasonLabel(input: FailureReasonInput): string {
  const where = input.platformLabel?.trim() || 'nền tảng gốc';
  const text = (input.technicalSummary ?? '').toLowerCase();
  const subtype = input.subtype ?? '';
  const removedText = /(has been removed|was removed|been deleted|has been terminated|no longer available|content isn.t available|this content is no longer|page isn.t available|video does not exist|does not exist|not found|deleted)/;
  if (subtype === 'removed' || (subtype === 'unavailable' && removedText.test(text))) return `Video đã bị xoá khỏi ${where}`;
  if (subtype === 'unavailable') {
    if (/private/.test(text)) return `Video ở chế độ riêng tư trên ${where}`;
    if (/(not available in your country|blocked it in your country|geo.?restrict|in your country|from your location)/.test(text)) {
      return `Video bị ${where} chặn theo vùng`;
    }
    if (/members.only|join this channel/.test(text)) return `Video chỉ dành cho hội viên kênh trên ${where}`;
    return `Video không còn khả dụng trên ${where}`;
  }
  switch (subtype) {
    case 'http_403':
      return `Máy chủ ${where} từ chối tải (HTTP 403)`;
    case 'http_429':
    case 'bot_check':
      return `${where} đang giới hạn tải`;
    case 'authentication':
    case 'cookies_invalid':
      return `${where} yêu cầu đăng nhập / cookies`;
    case 'unsupported_url':
      return 'Liên kết không phải trang video';
    case 'fragment':
      return 'Dữ liệu video bị gián đoạn khi tải';
    case 'network':
      return 'Mạng hoặc máy chủ không ổn định';
    case 'extractor':
      return `${where} chưa trả dữ liệu video ổn định`;
    case 'interrupted':
      return 'Tiến trình tải bị dừng đột ngột';
    case 'path_too_long':
      return 'Đường dẫn tệp quá dài';
    case 'disk_full':
      return 'Ổ đĩa đầy';
    case 'tool_missing':
      return 'Thiếu công cụ tải';
    default:
      break;
  }
  const code = input.code.toUpperCase();
  if (code === 'NETWORK_ERROR') return 'Mạng hoặc máy chủ không ổn định';
  if (code === 'MERGE_FAILED' || input.jobType === 'merge') return 'Ghép video gặp sự cố';
  if (code.includes('VERIFY') || code.includes('VERIFICATION')) return 'Tệp tải về không đạt kiểm tra';
  return 'Lỗi chưa xác định (xem Nhật ký)';
}

/** "2 video — A; 1 video — B" theo thứ tự nhiều nhất trước; tối đa `limit` lý do, còn lại gộp "…". */
export function summarizeFailureReasons(reasons: Iterable<string>, limit = 4): string {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, limit).map(([reason, count]) => `${count} video — ${reason}`);
  const rest = sorted.slice(limit).reduce((sum, [, count]) => sum + count, 0);
  return shown.join('; ') + (rest > 0 ? `; ${rest} video — lý do khác` : '');
}
