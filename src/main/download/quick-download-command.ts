import {
  formatQuickDownloadTime,
  type QuickDownloadMediaMode,
  type ValidatedQuickDownloadRequest
} from '@shared/quick-download.js';
import { YTDLP_PROGRESS_FLAGS } from '../downloader/ytdlp-progress.js';
// Rà soát toàn diện (2026-09-24) — mục 2.2: logic dựng tham số cookie gộp về dùng chung với các luồng
// yt-dlp khác (download-engine.ts, preview-frame-command.ts) — không đổi hành vi, chỉ tổ chức lại code.
import { buildCookieArguments, type CookieArgumentSettings } from '../downloader/ytdlp-cookie-arguments.js';

export interface QuickDownloadCommandPaths {
  ffmpegDirectory: string;
  tempDirectory: string;
  runToken: string;
  outputToken?: string;
}

export interface QuickDownloadCommandOptions {
  compactFilename?: boolean;
  forceGenericExtractor?: boolean;
  /** Giai đoạn 6 mục 7 (2026-09-24): mẫu đặt tên tệp do người dùng cấu hình trong Cài đặt. */
  filenameTemplate?: string | undefined;
}

// Giai đoạn 6 mục 7 (2026-09-24) — "Mẫu đặt tên tệp": mặc định GIỮ NGUYÊN đúng tên hiện có (tên video +
// mã video) để không đổi hành vi cho người dùng chưa cấu hình gì trong Cài đặt.
export const DEFAULT_QUICK_DOWNLOAD_FILENAME_TEMPLATE = '{title} [{id}]';

// Ánh xạ token của Tubmedia sang cú pháp trường yt-dlp thật. {channel} dùng đúng chuỗi dự phòng
// (uploader → channel → uploader_id) đã dùng ở nơi khác trong tệp này (TUBMEDIA_UPLOADER) để nhất quán
// khi kênh không có tên hiển thị. {date} KHÔNG phải trường yt-dlp — là NGÀY TẢI (hôm nay), tính sẵn ở
// tầng ứng dụng rồi chèn như một chuỗi TĨNH, vì yt-dlp chỉ biết ngày ĐĂNG TẢI (upload_date) của nguồn,
// không biết "hôm nay".
const FILENAME_TEMPLATE_FIELDS: Record<'title' | 'channel' | 'id', string> = {
  title: '%(title).80B',
  channel: '%(uploader,channel,uploader_id|)s',
  id: '%(id)s'
};

/**
 * Biến mẫu tên tệp của người dùng ({title}/{channel}/{date}/{id}) thành PHẦN ĐẦU của mẫu tên tệp yt-dlp
 * thật. Phần đuôi bắt buộc (khoảng cắt nếu có + "[QD-token]" dùng để tìm lại tệp khi cần) LUÔN được ghép
 * thêm riêng ở buildQuickDownloadArguments, KHÔNG nằm trong mẫu người dùng chỉnh được — đây là cơ chế nội
 * bộ (tìm lại tệp đầu ra khi không đọc được đường dẫn trực tiếp từ yt-dlp), đổi/xóa sẽ làm hỏng khả năng
 * tìm lại tệp đã tải xong.
 */
export function buildFilenamePrefixFromTemplate(rawTemplate: string, now: Date = new Date()): string {
  const template = rawTemplate.trim() || DEFAULT_QUICK_DOWNLOAD_FILENAME_TEMPLATE;
  const dateText = now.toISOString().slice(0, 10); // YYYY-MM-DD — cố định tại thời điểm bắt đầu tải.
  // '%' không nằm trong bộ 4 token — loại bỏ trước để không ai (vô tình hay cố ý) chèn được cú pháp
  // trường yt-dlp khác ngoài 4 token đã định nghĩa (schema Cài đặt cũng đã chặn '%' khi lưu).
  const withoutPercent = template.replaceAll('%', '');
  return withoutPercent.replace(/\{(title|channel|date|id)\}/g, (_match, token: string) =>
    token === 'date' ? dateText : FILENAME_TEMPLATE_FIELDS[token as 'title' | 'channel' | 'id']
  );
}

export type QuickDownloadAuthentication = CookieArgumentSettings;

const VIDEO_AUDIO_SELECTORS = {
  best: 'bv*+ba/b',
  '1080p': 'bv*[height<=1080]+ba/b[height<=1080]/b',
  '720p': 'bv*[height<=720]+ba/b[height<=720]/b',
  '480p': 'bv*[height<=480]+ba/b[height<=480]/b'
} as const;

const VIDEO_ONLY_SELECTORS = {
  best: 'bv*[ext=mp4]/bv*',
  '1080p': 'bv*[ext=mp4][height<=1080]/bv*[height<=1080]/bv*',
  '720p': 'bv*[ext=mp4][height<=720]/bv*[height<=720]/bv*',
  '480p': 'bv*[ext=mp4][height<=480]/bv*[height<=480]/bv*'
} as const;

function selectorFor(request: ValidatedQuickDownloadRequest): string {
  if (request.mediaMode === 'audio-only') return 'ba/b';
  if (request.mediaMode === 'video-only') return VIDEO_ONLY_SELECTORS[request.quality];
  return VIDEO_AUDIO_SELECTORS[request.quality];
}

function extensionFor(mode: QuickDownloadMediaMode): string {
  return mode === 'audio-only' ? 'm4a' : '%(ext)s';
}

function safeRangeSuffix(request: ValidatedQuickDownloadRequest): string {
  if (request.mode !== 'range' || request.startSeconds === null || request.endSeconds === null) {
    return '';
  }

  const start = formatQuickDownloadTime(request.startSeconds).replaceAll(':', '-');
  const end = formatQuickDownloadTime(request.endSeconds).replaceAll(':', '-');
  return ` [${start}-${end}]`;
}

export function buildQuickDownloadArguments(
  request: ValidatedQuickDownloadRequest,
  paths: QuickDownloadCommandPaths,
  authentication?: QuickDownloadAuthentication,
  options: QuickDownloadCommandOptions = {}
): string[] {
  const filenameToken = paths.outputToken ?? paths.runToken;
  // Mẫu tên tệp người dùng (mục 7) CHỈ áp dụng ở nhánh bình thường — nhánh "compactFilename" là lưới an
  // toàn tự động khi tên theo mẫu quá dài/không hợp lệ với Windows, PHẢI giữ cố định để luôn hoạt động.
  const filenamePrefix = options.compactFilename
    ? 'Video [%(id)s]'
    : buildFilenamePrefixFromTemplate(options.filenameTemplate ?? DEFAULT_QUICK_DOWNLOAD_FILENAME_TEMPLATE);
  const outputTemplate = `${filenamePrefix}${safeRangeSuffix(request)} [QD-${filenameToken}].${extensionFor(request.mediaMode)}`;

  const args = [
    '--ignore-config',
    '--no-playlist',
    // --print làm yt-dlp im lặng: thiếu --progress thì --progress-template không in dòng nào và
    // thanh tiến độ/tốc độ/ETA đứng ở 0% cho tới khi xong.
    ...YTDLP_PROGRESS_FLAGS,
    '--no-color',
    '--windows-filenames',
    '--trim-filenames',
    '128',
    '--continue',
    '--no-overwrites',
    '--no-post-overwrites',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
    '--retry-sleep',
    'fragment:exp=1:20',
    '--concurrent-fragments',
    '4',
    '--ffmpeg-location',
    paths.ffmpegDirectory,
    '-P',
    `home:${request.outputDirectory}`,
    '-P',
    `temp:${paths.tempDirectory}`,
    '-o',
    outputTemplate,
    '-f',
    selectorFor(request),
    '--progress-template',
    [
      'download:TUBMEDIA_PROGRESS',
      '%(progress._percent_str)s',
      '%(progress._speed_str)s',
      '%(progress._eta_str)s',
      '%(progress.downloaded_bytes)s',
      '%(progress.total_bytes_estimate)s'
    ].join('|'),
    '--print',
    'before_dl:TUBMEDIA_TITLE|%(title)s',
    '--print',
    'after_move:TUBMEDIA_FILE|%(filepath)s'
  ];

  // Giai đoạn 6 mục 1: lấy tên kênh/nguồn để ghi credit vào metadata sau khi tải xong (chuỗi rỗng nếu
  // nguồn không có cả 3 trường — không báo lỗi, chỉ bỏ qua dòng "Nguồn" khi ghi metadata).
  if (request.embedCredit) {
    args.push('--print', 'before_dl:TUBMEDIA_UPLOADER|%(uploader,channel,uploader_id|)s');
  }

  if (request.mediaMode === 'video-audio') {
    args.push('--merge-output-format', 'mp4');
  } else if (request.mediaMode === 'audio-only') {
    args.push('--extract-audio', '--audio-format', 'm4a', '--audio-quality', '0');
  }

  if (request.downloadSubtitles) {
    args.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      request.subtitleLanguage,
      '--convert-subs',
      'srt'
    );
  }

  if (request.downloadThumbnail) {
    args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  }

  if (request.writeMetadata) {
    args.push('--write-info-json', '--write-description');
  }

  if (request.mode === 'range' && request.startSeconds !== null && request.endSeconds !== null) {
    args.push('--download-sections', `*${request.startSeconds}-${request.endSeconds}`);
    if (request.accurateCut) args.push('--force-keyframes-at-cuts');
  }

  args.push(...buildCookieArguments(authentication));

  if (options.forceGenericExtractor) {
    args.push('--ies', 'generic,default');
  }

  // "--" bảo đảm URL luôn là đối số vị trí, không bao giờ bị yt-dlp hiểu là tùy chọn.
  args.push('--', request.url);
  return args;
}
