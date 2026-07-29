import type { JobStatus, JobType, ToolStatus } from '@shared/types/domain';

const STATUS_LABELS: Record<JobStatus | ToolStatus['health'], string> = {
  pending: 'Đang chờ',
  analyzing: 'Đang phân tích',
  ready: 'Sẵn sàng',
  downloading: 'Đang tải',
  downloaded: 'Đã tải',
  verifying: 'Đang kiểm tra',
  normalizing: 'Đang chuẩn hóa',
  processing: 'Đang xử lý',
  merging: 'Đang ghép',
  paused: 'Đã tạm dừng',
  retrying: 'Đang thử lại',
  completed: 'Hoàn tất',
  skipped: 'Đã bỏ qua',
  cancelled: 'Đã hủy',
  failed: 'Có lỗi',
  interrupted: 'Bị gián đoạn',
  healthy: 'Sẵn sàng',
  warning: 'Cần chú ý',
  broken: 'Không hoạt động'
};


const OTHER_STATUS_LABELS: Record<string, string> = {
  draft: 'Bản nháp',
  active: 'Đang hoạt động',
  archived: 'Đã lưu trữ',
  valid: 'Hợp lệ',
  invalid: 'Không hợp lệ',
  info: 'Thông tin',
  warn: 'Cảnh báo',
  error: 'Lỗi',
  debug: 'Gỡ lỗi',
  unknown: 'Không xác định'
};

const AUDIO_MODE_LABELS: Record<string, string> = {
  default: 'Mặc định',
  keep: 'Giữ âm thanh',
  mute: 'Tắt âm thanh',
  copy_if_compatible: 'Sao chép nếu tương thích',
  aac_256: 'AAC 256 kb/giây',
  aac_320: 'AAC 320 kb/giây',
  silent: 'Âm thanh im lặng'
};

const JOB_TYPE_LABELS: Record<JobType, string> = {
  analyze: 'Phân tích',
  download: 'Tải video',
  clip: 'Cắt đoạn',
  normalize: 'Chuẩn hóa',
  merge: 'Ghép video',
  verify: 'Kiểm tra tệp'
};

const TOOL_SOURCE_LABELS: Record<Exclude<ToolStatus['source'], null>, string> = {
  bundled: 'Đi kèm ứng dụng',
  managed: 'Ứng dụng quản lý',
  local: 'Thư mục cục bộ',
  path: 'Biến môi trường hệ thống'
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? OTHER_STATUS_LABELS[status] ?? status;
}

export function jobTypeLabel(type: JobType): string {
  return JOB_TYPE_LABELS[type];
}

export function toolSourceLabel(source: ToolStatus['source']): string {
  return source ? TOOL_SOURCE_LABELS[source] : 'Chưa xác định';
}

export function audioModeLabel(mode: string): string {
  return AUDIO_MODE_LABELS[mode] ?? mode;
}


const MODULE_LABELS: Record<string, string> = {
  app: 'Ứng dụng',
  tools: 'Công cụ',
  update: 'Cập nhật',
  queue: 'Hàng đợi',
  downloader: 'Tải xuống',
  download: 'Tải xuống',
  merge: 'Ghép video',
  normalize: 'Chuẩn hóa',
  process: 'Tiến trình nền',
  workbench: 'Khu vực làm việc',
  backup: 'Sao lưu',
  cookies: 'Cookies',
  database: 'Cơ sở dữ liệu',
  input: 'Dữ liệu đầu vào',
  verification: 'Kiểm tra tệp'
};

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module.toLowerCase()] ?? module;
}
