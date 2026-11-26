import { formatUserActionMessage } from './user-action-message.js';

export type ToolHealthFailureCause =
  | 'cpu_overload_timeout'
  | 'permission_or_antivirus'
  | 'corrupted_or_failed'
  | 'missing';

export interface ToolSystemLoad {
  cpuPercent?: number;
  activeJobs?: number;
}

export interface ToolHealthDiagnosis {
  tool: string;
  cause: ToolHealthFailureCause;
  cpuPercent: number | null;
  activeJobs: number | null;
  hasExistingBinary: boolean;
  technicalSummary: string;
}

const TIMEOUT_PATTERNS = [
  'quá thời gian',
  'vượt quá thời gian',
  'timed out',
  'timeout',
  'etimedout'
];

const PERMISSION_OR_AV_PATTERNS = [
  'eacces',
  'eperm',
  'access is denied',
  'permission denied',
  'virus',
  'potentially unwanted software',
  'blocked by',
  '0xc0000142',
  '3221225794',
  'appcontrol',
  'smartscreen'
];

function includesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function normalizePercent(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeJobs(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/**
 * v1.8.1: phân loại nguyên nhân thực tế khiến kiểm tra công cụ (yt-dlp / ffmpeg / ffprobe / ffplay / aria2c) thất bại
 * để báo rõ cho người dùng biết hướng xử lý, thay vì luôn báo chung chung "Không tìm thấy công cụ".
 */
export function diagnoseToolHealthFailure(input: {
  tool: string;
  hasExistingBinary: boolean;
  failures: readonly string[];
  load?: ToolSystemLoad | undefined;
}): ToolHealthDiagnosis {
  const joined = input.failures.join(' | ');
  const lower = joined.toLowerCase();
  const cpuPercent = normalizePercent(input.load?.cpuPercent);
  const activeJobs = normalizeJobs(input.load?.activeJobs);

  let cause: ToolHealthFailureCause;
  if (input.hasExistingBinary && includesAny(lower, TIMEOUT_PATTERNS)) {
    cause = 'cpu_overload_timeout';
  } else if (input.hasExistingBinary && includesAny(lower, PERMISSION_OR_AV_PATTERNS)) {
    cause = 'permission_or_antivirus';
  } else if (input.hasExistingBinary) {
    cause = 'corrupted_or_failed';
  } else if (includesAny(lower, TIMEOUT_PATTERNS)) {
    cause = 'cpu_overload_timeout';
  } else if (includesAny(lower, PERMISSION_OR_AV_PATTERNS)) {
    cause = 'permission_or_antivirus';
  } else {
    cause = 'missing';
  }

  return {
    tool: input.tool,
    cause,
    cpuPercent,
    activeJobs,
    hasExistingBinary: input.hasExistingBinary,
    technicalSummary: joined || 'Không có chi tiết lỗi từ hệ thống.'
  };
}

export function formatToolHealthFailureMessage(diagnosis: ToolHealthDiagnosis): string {
  const { tool, cause, cpuPercent, activeJobs } = diagnosis;

  if (cause === 'cpu_overload_timeout') {
    const loadParts: string[] = [];
    if (cpuPercent !== null && cpuPercent >= 75) loadParts.push(`CPU đang ở mức ${cpuPercent}%`);
    if (activeJobs !== null && activeJobs > 0) loadParts.push(`${activeJobs} công việc đang chạy cùng lúc`);
    const loadDetail = loadParts.length
      ? ` vì máy đang quá tải (${loadParts.join(', ')})`
      : ' (thường do CPU đang bận nhiều việc cùng lúc hoặc phần mềm diệt virus đang quét tệp)';

    return formatUserActionMessage({
      title: `Công cụ ${tool} phản hồi quá chậm do CPU đang cao`,
      summary: `Không kiểm tra kịp công cụ ${tool}${loadDetail} — tệp công cụ vẫn có trên máy, không phải bị mất.`,
      steps: [
        'Bấm "Tạm dừng tất cả" (góc trên bên phải) hoặc đóng bớt phần mềm nặng (CapCut, nhiều tab trình duyệt) để giảm tải CPU.',
        'Vào Cài đặt › Cấu hình máy giảm số video tải/xử lý cùng lúc xuống mức thấp hơn (ví dụ 2–3 luồng) để máy đỡ kịch 100% CPU.',
        'Chờ vài giây cho CPU hạ xuống dưới 70%, rồi vào Trung tâm công cụ bấm "Kiểm tra lại".'
      ]
    });
  }

  if (cause === 'permission_or_antivirus') {
    return formatUserActionMessage({
      title: `Công cụ ${tool} bị Windows hoặc phần mềm diệt virus chặn chạy`,
      summary: `Tệp ${tool} có sẵn trên máy nhưng Windows Security hoặc phần mềm diệt virus đang chặn quyền thực thi.`,
      steps: [
        'Mở Windows Security (hoặc phần mềm diệt virus đang dùng) › Lịch sử bảo vệ để kiểm tra xem tệp công cụ có bị chặn/cách ly không.',
        'Cho phép tệp chạy lại hoặc thêm thư mục công cụ của Tubmedia vào danh sách ngoại lệ.',
        'Quay lại Trung tâm công cụ bấm "Kiểm tra lại" (hoặc "Sửa chữa tất cả" nếu tệp đã bị xoá).'
      ]
    });
  }

  if (cause === 'corrupted_or_failed') {
    return formatUserActionMessage({
      title: `Công cụ ${tool} có tệp nhưng chạy bị lỗi`,
      summary: `Tubmedia tìm thấy tệp ${tool} trên máy nhưng công cụ không trả về phiên bản hợp lệ (có thể tệp bị hỏng sau lần cập nhật dở hoặc thiếu thành phần).`,
      steps: [
        'Mở Trung tâm công cụ và bấm "Khôi phục" bản trước ngay trên thẻ công cụ bị lỗi.',
        'Nếu vẫn chưa hoạt động, bấm "Sửa chữa tất cả" để ứng dụng tải lại bản sạch.',
        'Sau khi công cụ báo Sẵn sàng, quay lại Hàng đợi bấm "Thử lại lỗi".'
      ]
    });
  }

  return formatUserActionMessage({
    title: `Chưa tìm thấy tệp công cụ ${tool} trên máy`,
    summary: `Không thấy tệp thực thi ${tool} trong thư mục ứng dụng hoặc hệ thống (có thể đã bị xoá hoặc trình diệt virus gỡ mất).`,
    steps: [
      'Mở Trung tâm công cụ và bấm "Sửa chữa tất cả" để ứng dụng tự tải lại công cụ.',
      'Nếu phần mềm diệt virus vừa xoá tệp, hãy thêm thư mục công cụ vào danh sách ngoại lệ trước khi sửa chữa.',
      'Sau khi công cụ báo Sẵn sàng, quay lại tiếp tục công việc.'
    ]
  });
}
