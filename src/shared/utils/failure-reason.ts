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
  /** Câu lỗi tiếng Việt của tác vụ — dùng để nêu lý do cụ thể khi GHÉP video lỗi (bộ ghép không gắn loại lỗi). */
  message?: string | null;
}

/** 2026-10-27: lý do cụ thể khi ghép lỗi, đọc từ câu lỗi của bộ ghép (merge-engine.ts). null = không nhận ra. */
function mergeReason(message: string): string | null {
  const lower = message.toLowerCase();
  const sourceNumber = /video nguồn #(\d+)/i.exec(message)?.[1];
  if (/không đọc được video nguồn|không vượt qua kiểm tra giải mã|video nguồn #\d+ –/.test(lower)) {
    return sourceNumber ? `Video nguồn #${sourceNumber} bị hỏng` : 'Một video nguồn bị hỏng';
  }
  if (/thiếu video nguồn|video nguồn bị thiếu|enoent|không còn tệp nguồn/.test(lower)) return 'Thiếu video nguồn để ghép';
  if (lower.includes('luồng âm thanh bị thiếu')) return 'Thành phẩm bị thiếu tiếng (đã chặn)';
  if (lower.includes('âm thanh và hình ảnh lệch')) return 'Thành phẩm lệch tiếng và hình (đã chặn)';
  if (lower.includes('chặn thành phẩm vì phát hiện')) return 'Thành phẩm bị lỗi hình (đã chặn)';
  if (lower.includes('nén nhỏ bất thường')) return 'Thành phẩm nhỏ bất thường (đã chặn)';
  if (lower.includes('thành phẩm pending không hợp lệ') || lower.includes('không đạt kiểm tra')) return 'Thành phẩm ghép không đạt kiểm tra';
  if (lower.includes('chưa tương thích concat')) return 'Các video không cùng định dạng để ghép nối';
  if (lower.includes('không có video hợp lệ')) return 'Không có video hợp lệ để ghép';
  if (lower.includes('commit thành phẩm')) return 'Không lưu được thành phẩm';
  if (lower.includes('mốc bắt đầu/kết thúc')) return 'Mốc cắt bắt đầu / kết thúc không hợp lệ';
  if (lower.includes('đổi tỉ lệ')) return 'Đổi tỉ lệ khung hình bị lỗi';
  if (/no space left|enospc|dung lượng/.test(lower)) return 'Ổ đĩa đầy';
  return null;
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
    // 2026-10-27 (rà soát trước 1.7.3): các lỗi trước đây hiện "chưa xác định" hoặc báo lệch.
    case 'format_unavailable':
      return `Không có định dạng khớp cài đặt chất lượng (video vẫn còn trên ${where})`;
    case 'live':
      return `Video đang phát trực tiếp / sắp công chiếu trên ${where}`;
    case 'not_found':
      return `Liên kết không còn tồn tại trên ${where} (HTTP 404/410)`;
    case 'file_access':
      return 'Tệp bị chương trình khác khoá hoặc thiếu quyền ghi';
    case 'ssl':
      return 'Lỗi kết nối bảo mật (SSL) — proxy/diệt virus chặn';
    case 'postprocess':
      return 'Ghép hình + tiếng sau khi tải bị lỗi (FFmpeg)';
    case 'file_invalid':
      return 'Tệp tải về bị hỏng (đã cách ly)';
    case 'video_short':
      return 'Tệp tải về bị hụt hình';
    case 'audio_lost':
      return 'Tệp tải về bị mất tiếng';
    case 'quality_unmet':
      return 'Không có bản đạt giới hạn chất lượng đã đặt';
    case 'remux_failed':
      return 'Đóng gói lại sang MP4 bị lỗi';
    case 'edit_copy_failed':
      return 'Tạo bản dựng CapCut bị lỗi';
    case 'encoder_missing':
      return 'FFmpeg thiếu bộ mã hoá cho bản CapCut';
    case 'name_conflict':
      return 'Trùng tên tệp với nguồn của danh sách khác';
    case 'source_missing':
      return 'Thiếu dữ liệu nguồn của danh sách';
    default:
      break;
  }
  const code = input.code.toUpperCase();
  if (code === 'NETWORK_ERROR') return 'Mạng hoặc máy chủ không ổn định';
  if (code === 'MERGE_FAILED' || input.jobType === 'merge') return mergeReason(input.message ?? '') ?? 'Ghép video gặp sự cố';
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
