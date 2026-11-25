/**
 * 1.8.0 việc C: khi yt-dlp báo "Requested format is not available", nói ĐÚNG nguyên nhân bằng danh sách định dạng thật của
 * nguồn (một lần `yt-dlp --print "%(formats...)j"` sau lỗi) thay cho câu chung "không có định dạng khớp cài đặt".
 *
 * Ba trường hợp (mỗi câu đều có tiêu đề + các bước đánh số — xem user-action-message.ts):
 *   1. source_limited  — nguồn chỉ có tối đa X p / Y FPS / codec Z nên không khớp mức đã đặt → chỉ đúng ô cần nới.
 *   2. machine_limited — nền tảng không trả bản video nào, hoặc YouTube chỉ trả ≤ 720p kèm dấu hiệu máy bị hạn chế
 *                        (thiếu bộ chạy JS, yt-dlp báo thiếu định dạng…) → "máy này chỉ nhận được tối đa X p" + đổi mạng,
 *                        làm mới cookie, cập nhật công cụ; kèm phiên bản yt-dlp và có/không bộ chạy JS.
 *   3. probe_failed    — không đọc được danh sách định dạng → giữ câu cũ, thêm phiên bản yt-dlp.
 * Không gọi mạng ở đây: phần phân tích nhận dữ liệu đã đọc, test dùng dữ liệu `-J` mẫu.
 */
import type { AppSettings } from '../types/domain.js';
import { ALLOW_BELOW_MINIMUM_LABEL, effectiveDownloadBounds, isCapCutDownloadMode } from './download-quality.js';
import { formatUserActionMessage } from './user-action-message.js';

export interface AvailableVideoFormat {
  height: number;
  fps: number | null;
  codec: string;
  hasAudio: boolean;
}

export interface AvailableFormatSummary {
  videoFormats: AvailableVideoFormat[];
  maxHeight: number | null;
  maxFps: number | null;
  codecs: string[];
  hasAudio: boolean;
}

export type FormatUnavailableCause = 'source_limited' | 'machine_limited' | 'probe_failed';

export interface FormatUnavailableContext {
  summary: AvailableFormatSummary | null;
  settings: AppSettings;
  platform: string | null;
  platformLabel: string | null;
  ytdlpVersion: string | null;
  jsRuntime: boolean;
  /** stderr/stdout của lượt tải lỗi + lượt đọc định dạng, để tìm dấu hiệu máy bị hạn chế. */
  diagnosticText: string;
}

export interface FormatUnavailableDiagnosis {
  cause: FormatUnavailableCause;
  reason: string;
  message: string;
  details: Record<string, unknown>;
}

/** Mẫu `--print` gọn (vài KB) thay cho `-J` (có video tới 11 MB) — chỉ các trường cần cho chẩn đoán. */
export const FORMAT_PROBE_PRINT_TEMPLATE = '%(formats.:.{format_id,vcodec,acodec,height,fps})j';

/** Câu yt-dlp (chữ thường) cho thấy máy không nhận đủ định dạng — không phải nguồn thật sự thấp. */
const MACHINE_LIMIT_MARKERS = [
  'no supported javascript runtime',
  'some formats may be missing',
  'formats have been skipped',
  'missing a url',
  'n challenge solving failed',
  'signature solving failed',
  'signature extraction failed',
  'po token',
  'only images are available'
];

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function realCodec(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'none' ? value.trim() : null;
}

/** Tên codec đời thường: avc1.64002A → H.264, vp09/vp9 → VP9, av01 → AV1, hev1/hvc1 → HEVC. */
export function codecFamily(codec: string): string {
  const value = codec.toLowerCase();
  if (value.startsWith('avc') || value.startsWith('h264')) return 'H.264';
  if (value.startsWith('vp09') || value.startsWith('vp9')) return 'VP9';
  if (value.startsWith('av01') || value.startsWith('av1')) return 'AV1';
  if (value.startsWith('hev') || value.startsWith('hvc') || value.startsWith('h265')) return 'HEVC';
  return codec.split('.')[0]!.toUpperCase();
}

const PREFERENCE_FAMILY: Record<AppSettings['downloadCodecPreference'], string | null> = {
  auto: null,
  h264: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  av1: 'AV1'
};

/**
 * Nhận mảng formats (từ `--print FORMAT_PROBE_PRINT_TEMPLATE`) hoặc cả đối tượng `-J`. Ảnh xem trước (storyboard, vcodec
 * "none") và bản chỉ tiếng không tính là bản video. Dữ liệu không đọc được → null.
 */
export function summarizeAvailableFormats(input: unknown): AvailableFormatSummary | null {
  const list = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { formats?: unknown }).formats)
      ? ((input as { formats: unknown[] }).formats)
      : null;
  if (!list) return null;
  const videoFormats: AvailableVideoFormat[] = [];
  let hasAudio = false;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const format = item as Record<string, unknown>;
    const vcodec = realCodec(format.vcodec);
    const acodec = realCodec(format.acodec);
    if (acodec) hasAudio = true;
    const height = finitePositive(format.height);
    if (!vcodec || !height) continue;
    videoFormats.push({ height, fps: finitePositive(format.fps), codec: codecFamily(vcodec), hasAudio: Boolean(acodec) });
  }
  const heights = videoFormats.map((format) => format.height);
  const fpsValues = videoFormats.map((format) => format.fps).filter((fps): fps is number => fps !== null);
  return {
    videoFormats,
    maxHeight: heights.length ? Math.max(...heights) : null,
    maxFps: fpsValues.length ? Math.max(...fpsValues) : null,
    codecs: [...new Set(videoFormats.map((format) => format.codec))],
    hasAudio
  };
}

/** Đọc dòng JSON in ra bởi FORMAT_PROBE_PRINT_TEMPLATE (dòng cuối bắt đầu bằng "["). */
export function parseFormatProbeOutput(stdout: string): AvailableFormatSummary | null {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith('[') || value.startsWith('{'));
  if (!line) return null;
  try {
    return summarizeAvailableFormats(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

function fpsText(fps: number): string {
  return String(Math.round(fps * 100) / 100);
}

function toolInfo(context: FormatUnavailableContext): string {
  return `yt-dlp ${context.ytdlpVersion ?? 'chưa rõ phiên bản'}, ${context.jsRuntime ? 'có' : 'không có'} bộ chạy JavaScript`;
}

const SETTINGS_STEP = 'Mở Cài đặt › Tải danh sách.';
const RETRY_STEP = 'Bấm Thử lại video này.';
const ALLOW_STEP = `bật ô "${ALLOW_BELOW_MINIMUM_LABEL}"`;

export function diagnoseFormatUnavailable(context: FormatUnavailableContext): FormatUnavailableDiagnosis {
  const { summary, settings } = context;
  const where = context.platformLabel?.trim() || 'nền tảng gốc';
  const bounds = effectiveDownloadBounds(settings);
  const capCut = isCapCutDownloadMode(settings.downloadCompatibilityMode);
  const lowerText = context.diagnosticText.toLowerCase();
  const signals = MACHINE_LIMIT_MARKERS.filter((marker) => lowerText.includes(marker));
  if (!context.jsRuntime) signals.push('no-bundled-js-runtime');
  const baseDetails = {
    ytdlpVersion: context.ytdlpVersion,
    jsRuntime: context.jsRuntime,
    availableMaxHeight: summary?.maxHeight ?? null,
    availableMaxFps: summary?.maxFps ?? null,
    availableVideoFormats: summary?.videoFormats.length ?? null,
    availableCodecs: summary?.codecs ?? null,
    machineLimitSignals: signals
  };
  const result = (cause: FormatUnavailableCause, reason: string, message: string): FormatUnavailableDiagnosis => ({
    cause,
    reason,
    message,
    details: { ...baseDetails, formatDiagnosis: cause, formatDiagnosisReason: reason }
  });

  if (!summary) {
    return result(
      'probe_failed',
      'probe_failed',
      formatUserActionMessage({
        title: 'Không có định dạng khớp cài đặt chất lượng',
        summary: `Video vẫn còn trên ${where} nhưng không có định dạng nào khớp cài đặt chất lượng hiện tại (độ phân giải / FPS / bitrate / codec); Tubmedia không đọc được danh sách định dạng của nguồn để nói rõ hơn (${toolInfo(context)}).`,
        steps: [SETTINGS_STEP, `Nới giới hạn chất lượng hoặc ${ALLOW_STEP}.`, RETRY_STEP]
      })
    );
  }

  const maxHeight = summary.maxHeight;
  const belowMinimum = maxHeight !== null && bounds.minHeight > 0 && maxHeight < bounds.minHeight;
  const allowHint = belowMinimum && !bounds.allowBelowMinimum ? [`Hoặc mở Cài đặt › Tải danh sách, ${ALLOW_STEP} để lấy bản ${maxHeight}p.`] : [];
  const machineLimited =
    maxHeight === null ||
    (context.platform === 'youtube' && maxHeight <= 720 && signals.length > 0);
  if (machineLimited) {
    const got =
      maxHeight === null
        ? `${where} không trả bản video nào cho máy này`
        : `Máy này chỉ nhận được tối đa ${maxHeight}p từ ${where}${belowMinimum ? ` (mức tối thiểu đang đặt là ${bounds.minHeight}p)` : ''}`;
    return result(
      'machine_limited',
      maxHeight === null ? 'no_video_formats' : 'low_resolution_only',
      formatUserActionMessage({
        title: maxHeight === null ? `${where} không trả bản video cho máy này` : `Máy này chỉ nhận được bản ${maxHeight}p`,
        summary: `${got} — thường do ${where} hạn chế mạng/IP của máy, cookie cũ hoặc công cụ tải lỗi thời, không phải do video (${toolInfo(context)}).`,
        steps: [
          'Đổi mạng (tắt VPN/Proxy hoặc dùng Wi-Fi/4G khác) rồi bấm Thử lại.',
          'Làm mới cookie YouTube trong khung Cookies của danh sách.',
          'Mở Trung tâm công cụ và cập nhật yt-dlp lên bản mới nhất.',
          ...allowHint
        ]
      })
    );
  }

  const heights = summary.videoFormats.map((format) => format.height);
  const minHeight = Math.min(...heights);
  const fpsList = summary.videoFormats.map((format) => format.fps).filter((fps): fps is number => fps !== null);
  const minFps = fpsList.length ? Math.min(...fpsList) : null;
  const preferredFamily = capCut ? null : PREFERENCE_FAMILY[settings.downloadCodecPreference];
  const sourceLimited = (reason: string, title: string, text: string, fix: string): FormatUnavailableDiagnosis =>
    result(
      'source_limited',
      reason,
      formatUserActionMessage({ title, summary: `${text} Video vẫn còn trên ${where}.`, steps: [SETTINGS_STEP, fix, RETRY_STEP] })
    );

  if (belowMinimum) {
    return sourceLimited(
      'height_below_minimum',
      `Nguồn chỉ có tối đa ${maxHeight}p`,
      capCut
        ? `Nguồn chỉ có tối đa ${maxHeight}p, còn chế độ CapCut trực tiếp đang cần từ ${bounds.minHeight}p.`
        : `Nguồn chỉ có tối đa ${maxHeight}p, thấp hơn mức tối thiểu ${bounds.minHeight}p đang đặt.`,
      capCut
        ? `Bật ô "${ALLOW_BELOW_MINIMUM_LABEL}" để lấy bản ${maxHeight}p (Tubmedia không phóng to giả).`
        : `Hạ "Độ phân giải tối thiểu" xuống ${maxHeight} (hoặc 0), hoặc ${ALLOW_STEP} để lấy bản ${maxHeight}p.`
    );
  }
  if (bounds.maxHeight > 0 && minHeight > bounds.maxHeight) {
    return sourceLimited(
      'height_above_maximum',
      `Nguồn chỉ có bản từ ${minHeight}p trở lên`,
      `Nguồn chỉ có bản từ ${minHeight}p trở lên, cao hơn mức tối đa ${bounds.maxHeight}p đang đặt.`,
      `Nâng "Độ phân giải tối đa" lên ${minHeight} (hoặc 0 = cao nhất nguồn).`
    );
  }
  if (bounds.minFps > 0 && summary.maxFps !== null && summary.maxFps + 0.5 < bounds.minFps) {
    return sourceLimited(
      'fps_below_minimum',
      `Nguồn chỉ có tối đa ${fpsText(summary.maxFps)} FPS`,
      `Nguồn chỉ có tối đa ${fpsText(summary.maxFps)} FPS, thấp hơn mức tối thiểu ${bounds.minFps} FPS đang đặt.`,
      `Hạ "FPS tối thiểu" xuống ${Math.floor(summary.maxFps)} (hoặc 0), hoặc ${ALLOW_STEP}.`
    );
  }
  if (bounds.maxFps > 0 && minFps !== null && minFps > bounds.maxFps + 0.5) {
    return sourceLimited(
      'fps_above_maximum',
      `Nguồn chỉ có bản ${fpsText(minFps)} FPS trở lên`,
      `Nguồn chỉ có bản từ ${fpsText(minFps)} FPS trở lên, cao hơn mức tối đa ${bounds.maxFps} FPS đang đặt.`,
      `Nâng "FPS tối đa" lên ${Math.ceil(minFps)} (hoặc 0 = cao nhất nguồn).`
    );
  }
  if (preferredFamily && !summary.codecs.includes(preferredFamily)) {
    return sourceLimited(
      'codec_missing',
      `Nguồn không có codec ${preferredFamily}`,
      `Nguồn không có bản codec ${preferredFamily} (chỉ có ${summary.codecs.join(', ') || 'codec khác'}).`,
      `Đổi "Ưu tiên codec video" về Tự động, hoặc ${ALLOW_STEP}.`
    );
  }
  return sourceLimited(
    'no_matching_combination',
    'Không có bản khớp đồng thời mọi giới hạn chất lượng',
    `Nguồn có tối đa ${maxHeight}p${summary.maxFps !== null ? `, ${fpsText(summary.maxFps)} FPS` : ''} (${summary.codecs.join(', ')}) nhưng không có bản nào khớp cùng lúc mọi giới hạn đang đặt (độ phân giải / FPS / bitrate / codec).`,
    `Nới bớt giới hạn bitrate/codec/FPS, hoặc ${ALLOW_STEP}.`
  );
}
