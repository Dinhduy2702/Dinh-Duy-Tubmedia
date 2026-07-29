export interface FriendlyIssue {
  title: string;
  message: string;
  steps: string[];
  technical: string;
  tone: 'warning' | 'error';
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (typeof value === 'symbol') return value.description ?? 'Symbol';
  if (typeof value === 'function') return value.name ? `[Function ${value.name}]` : '[Function]';

  try {
    return JSON.stringify(value) ?? 'Không thể đọc chi tiết lỗi.';
  } catch {
    return 'Không thể đọc chi tiết lỗi.';
  }
}

function cleanTechnical(raw: string): string {
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s*\|\s*ERROR:\s*/gi, ' · ')
    .trim();
}

export function friendlyIssue(value: unknown): FriendlyIssue {
  const raw = describeUnknown(value);
  const technical = cleanTechnical(raw);
  const lower = technical.toLowerCase();

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
        'Nội dung vừa dán hoặc tệp vừa chọn chưa phải cookies.txt dạng Netscape mà yt-dlp có thể sử dụng.',
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
      title: 'Chrome hoặc Edge đang khóa dữ liệu đăng nhập',
      message:
        'Ứng dụng chưa thể lấy cookies trực tiếp vì trình duyệt Chromium vẫn đang giữ cơ sở dữ liệu. Danh sách liên quan đã được tạm dừng an toàn.',
      steps: [
        'Đóng hoàn toàn Chrome/Edge, kể cả biểu tượng chạy nền cạnh đồng hồ hoặc tiến trình trong Task Manager.',
        'Thử lại bằng tùy chọn Trình duyệt; trên Windows nên ưu tiên Firefox.',
        'Hoặc dùng Dán trực tiếp / Chọn tệp cookies.txt để tiếp tục ngay.'
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
    const missingTools = ['yt-dlp', 'ffmpeg', 'ffprobe'].filter(
      (name) =>
        lower.includes(`${name}:`) ||
        lower.includes(`công cụ ${name}`) ||
        lower.includes(`không tìm thấy ${name}`)
    );
    const missingLabel = missingTools.length > 0 ? missingTools.join(', ') : 'một công cụ bắt buộc';
    return {
      title: 'Thiếu công cụ xử lý video',
      message: `Ứng dụng chưa thể chạy ${missingLabel}. Hàng đợi đã được giữ nguyên và chưa tạo tác vụ lỗi hàng loạt.`,
      steps: [
        'Vào Trung tâm công cụ để xem đúng công cụ và đường dẫn đang lỗi.',
        'Nhấn Kiểm tra lại; nếu vẫn lỗi, chọn Sửa chữa tất cả.',
        'Khi ba công cụ bắt buộc báo Sẵn sàng, tiếp tục đúng danh sách.'
      ],
      technical,
      tone: 'error'
    };
  }
  if (lower.includes('disk_full') || lower.includes('no space') || lower.includes('không đủ dung lượng')) {
    return {
      title: 'Ổ đĩa không đủ dung lượng',
      message: 'Danh sách đã tạm dừng trước khi ghi thêm dữ liệu để tránh làm hỏng tệp.',
      steps: [
        'Giải phóng dung lượng hoặc đổi thư mục lưu.',
        'Bảo đảm còn ít nhất mức dự phòng trong cấu hình tài nguyên.',
        'Nhấn Tiếp tục.'
      ],
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
      steps: [
        'Chọn thư mục khác trên ổ dữ liệu.',
        'Tránh thư mục hệ thống được bảo vệ.',
        'Kiểm tra ổ đĩa còn kết nối rồi thử lại.'
      ],
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
      message: 'Ứng dụng đã tự dừng đúng danh sách để tránh thử lại liên tục và lặp lỗi.',
      steps: [
        'Kiểm tra mạng và máy chủ trung gian.',
        'Kiểm tra cookies nếu nền tảng yêu cầu đăng nhập.',
        'Nhấn Tiếp tục sau khi kết nối ổn định.'
      ],
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
      title: 'Timestamp của thành phẩm ghép không hợp lệ',
      message:
        'Một hoặc nhiều video nguồn mang mốc thời gian bất thường khiến container báo thời lượng lớn hơn thực tế. Tubmedia đã thử remux để đưa timeline về 0 trước khi cách ly thành phẩm.',
      steps: [
        'Xem khung Chi tiết lỗi của quy trình để biết thời lượng dự kiến, thời lượng đọc được và tệp đã đưa vào quarantine.',
        'Nhấn Sao chép chi tiết lỗi để lấy toàn bộ mã sự kiện, đường dẫn và thông tin từng video nguồn.',
        'Sau khi cập nhật bản sửa timestamp, chọn Chạy lại quy trình; không cần tải lại những video nguồn đã hợp lệ.'
      ],
      technical,
      tone: 'error'
    };
  }
  return {
    title: 'Không thể hoàn tất thao tác',
    message: technical || 'Ứng dụng gặp sự cố chưa xác định. Trạng thái hiện tại vẫn được giữ an toàn.',
    steps: [
      'Sửa nguyên nhân được mô tả phía trên rồi thử lại đúng khu vực.',
      'Mở Nhật ký riêng để xem mã chẩn đoán.',
      'Xuất gói chẩn đoán khi lỗi lặp lại.'
    ],
    technical,
    tone: 'error'
  };
}
