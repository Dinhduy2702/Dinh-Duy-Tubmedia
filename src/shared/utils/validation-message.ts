/**
 * Kênh IPC kiểm tra dữ liệu bằng zod; khi sai, renderer chỉ nhận chuỗi
 *   Error invoking remote method 'settings:update': ZodError: [ { "code": "too_big", ... } ]
 * và trước đây phải hiện "Ứng dụng chưa thể hoàn tất thao tác này". Hàm này đọc mảng lỗi và diễn giải
 * thành câu tiếng Việt nêu rõ ô nào sai và vì sao.
 */
const FIELD_LABELS: Record<string, string> = {
  aria2Connections: 'Kết nối aria2c mỗi video',
  maxGlobalDownloadWorkers: 'Tổng video tải đồng thời toàn ứng dụng',
  downloadConcurrentFragments: 'Fragment đồng thời mỗi video',
  progressRefreshMs: 'Chu kỳ làm mới tiến độ',
  sourceCacheDays: 'Số ngày giữ nguồn',
  logRetentionDays: 'Số ngày giữ nhật ký',
  downloadMinHeight: 'Độ phân giải tối thiểu',
  downloadMaxHeight: 'Độ phân giải tối đa',
  downloadMinFps: 'FPS tối thiểu',
  downloadMaxFps: 'FPS tối đa',
  downloadMinVideoBitrateKbps: 'Video bitrate tối thiểu',
  downloadVideoBitrateKbps: 'Video bitrate',
  downloadMinAudioBitrateKbps: 'Audio bitrate tối thiểu',
  downloadAudioBitrateKbps: 'Audio bitrate',
  proxy: 'Proxy mạng',
  rateLimit: 'Giới hạn tốc độ',
  cookiesBrowserProfile: 'Hồ sơ trình duyệt',
  ytdlpPath: 'Đường dẫn yt-dlp',
  ffmpegPath: 'Đường dẫn FFmpeg',
  ffprobePath: 'Đường dẫn ffprobe',
  aria2cPath: 'Đường dẫn aria2c',
  toolManifestUrl: 'Địa chỉ danh sách cập nhật công cụ',
  appFeedUrl: 'Máy chủ cập nhật ứng dụng',
  defaultSourceFolder: 'Thư mục nguồn mặc định',
  defaultTempFolder: 'Thư mục tạm mặc định',
  defaultOutputFolder: 'Thư mục thành phẩm mặc định',
  name: 'Tên',
  finalFileName: 'Tên sản phẩm đầu ra',
  linksText: 'Danh sách link',
  outputFolder: 'Thư mục lưu',
  tempFolder: 'Thư mục tạm',
  sourceFolder: 'Thư mục nguồn',
  url: 'Liên kết',
  outputDirectory: 'Thư mục lưu',
  subtitleLanguage: 'Ngôn ngữ phụ đề'
};

const MAX_LISTED_ISSUES = 3;

interface ZodIssueLike {
  code?: unknown;
  origin?: unknown;
  path?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  expected?: unknown;
  format?: unknown;
  message?: unknown;
}

function fieldName(issue: ZodIssueLike): string | null {
  if (!Array.isArray(issue.path) || issue.path.length === 0) return null;
  const key = String(issue.path[issue.path.length - 1]);
  return FIELD_LABELS[key] ?? key;
}

function reasonOf(issue: ZodIssueLike): string {
  const isString = issue.origin === 'string';
  switch (issue.code) {
    case 'too_big':
      return isString
        ? `tối đa ${String(issue.maximum)} ký tự`
        : `giá trị lớn nhất là ${String(issue.maximum)}`;
    case 'too_small':
      if (isString) {
        return Number(issue.minimum) <= 1 ? 'không được để trống' : `tối thiểu ${String(issue.minimum)} ký tự`;
      }
      return `giá trị nhỏ nhất là ${String(issue.minimum)}`;
    case 'invalid_type':
      if (issue.expected === 'number' || issue.expected === 'int') return 'phải là một số hợp lệ (không để trống)';
      if (issue.expected === 'string') return 'phải là chuỗi ký tự';
      if (issue.expected === 'boolean') return 'phải là bật hoặc tắt';
      return 'sai kiểu dữ liệu';
    case 'invalid_value':
      return 'giá trị không nằm trong các lựa chọn cho phép';
    case 'invalid_format':
      return issue.format === 'url' ? 'địa chỉ (URL) không hợp lệ' : 'định dạng không hợp lệ';
    case 'unrecognized_keys':
      return 'có trường không được hỗ trợ';
    default:
      return 'giá trị không hợp lệ';
  }
}

/** Trả về câu diễn giải tiếng Việt, hoặc null nếu văn bản không phải mảng lỗi zod. */
export function describeValidationIssues(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const issues = parsed.filter(
    (item): item is ZodIssueLike =>
      typeof item === 'object' && item !== null && typeof (item as ZodIssueLike).code === 'string'
  );
  if (issues.length !== parsed.length) return null;

  const parts = issues.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const field = fieldName(issue);
    return field ? `Ô "${field}": ${reasonOf(issue)}.` : `Dữ liệu: ${reasonOf(issue)}.`;
  });
  const more = issues.length - MAX_LISTED_ISSUES;
  if (more > 0) parts.push(`Và ${more} lỗi khác.`);
  return parts.join(' ');
}
