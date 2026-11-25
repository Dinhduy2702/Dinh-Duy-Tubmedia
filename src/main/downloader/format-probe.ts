/**
 * 1.8.0 việc C: sau lỗi "Requested format is not available", đọc MỘT lần danh sách định dạng thật mà máy này nhận được
 * (cùng cookie/proxy/bộ chạy JS với lượt tải, có giới hạn thời gian) để báo đúng nguyên nhân. Dùng `--print` mẫu gọn
 * (vài KB) thay cho `-J` (có video tới 11 MB) và đọc từng dòng stdout nên không phụ thuộc giới hạn đuôi nhật ký tiến trình.
 * Lỗi bất kỳ ở bước này → summary null (trường hợp 3 "không lấy được thông tin"), không bao giờ ném ra ngoài.
 */
import type { ProcessManager } from '../processes/process-manager.js';
import {
  FORMAT_PROBE_PRINT_TEMPLATE,
  parseFormatProbeOutput,
  type AvailableFormatSummary,
  type FormatUnavailableDiagnosis
} from '@shared/utils/format-availability.js';
import { buildSafeYtDlpArguments } from './ytdlp-arguments.js';

export const FORMAT_PROBE_TIMEOUT_MS = 90_000;
/** 1.8.0 việc C: tối đa 3 lượt dò định dạng/phút/nền tảng để tránh gây thêm 429 khi cả danh sách cùng lỗi định dạng. */
export const FORMAT_PROBE_MAX_PER_MINUTE = 3;
export const FORMAT_PROBE_WINDOW_MS = 60_000;
const FORMAT_PROBE_CACHE_MAX_ENTRIES = 200;

export interface FormatProbeGuardOptions {
  maxPerMinute?: number;
  windowMs?: number;
  now?: () => number;
  isPlatformBlocked?: (platform: string) => boolean;
}

export type FormatProbeGuardOutcome =
  | { kind: 'probed'; result: FormatProbeResult; cached: boolean }
  | { kind: 'rate-limited'; lastProjectDiagnosis: FormatUnavailableDiagnosis | null }
  | { kind: 'platform-blocked' };

/**
 * 1.8.0 việc C: bảo vệ bước dò định dạng (yt-dlp --print) khỏi dồn yêu cầu vào nền tảng:
 * - Bộ nhớ đệm theo video trong phiên (không gọi lại cho cùng một video).
 * - Tối đa 3 lượt dò/phút/nền tảng; quá mức thì dùng chẩn đoán gần nhất của cùng danh sách (hoặc câu chung).
 * - Không dò khi nền tảng đang bị 429 / chặn bot.
 */
export class FormatProbeGuard {
  private readonly cache = new Map<string, FormatProbeResult>();
  private readonly recentProbes = new Map<string, number[]>();
  private readonly projectDiagnoses = new Map<string, FormatUnavailableDiagnosis>();
  private readonly maxPerMinute: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private isPlatformBlocked: (platform: string) => boolean;

  public constructor(options: FormatProbeGuardOptions = {}) {
    this.maxPerMinute = options.maxPerMinute ?? FORMAT_PROBE_MAX_PER_MINUTE;
    this.windowMs = options.windowMs ?? FORMAT_PROBE_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
    this.isPlatformBlocked = options.isPlatformBlocked ?? (() => false);
  }

  public setPlatformBlockedCheck(check: (platform: string) => boolean): void {
    this.isPlatformBlocked = check;
  }

  public rememberProjectDiagnosis(projectId: string, diagnosis: FormatUnavailableDiagnosis): void {
    if (!projectId) return;
    this.projectDiagnoses.set(projectId, diagnosis);
  }

  public async probe(input: {
    videoKey: string;
    platform: string | null;
    projectId: string;
    runProbe: () => Promise<FormatProbeResult>;
  }): Promise<FormatProbeGuardOutcome> {
    const cached = this.cache.get(input.videoKey);
    if (cached) return { kind: 'probed', result: cached, cached: true };

    const platformKey = (input.platform || 'generic').toLowerCase();
    if (this.isPlatformBlocked(platformKey)) {
      return { kind: 'platform-blocked' };
    }

    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.recentProbes.get(platformKey) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= this.maxPerMinute) {
      this.recentProbes.set(platformKey, recent);
      return {
        kind: 'rate-limited',
        lastProjectDiagnosis: input.projectId ? (this.projectDiagnoses.get(input.projectId) ?? null) : null
      };
    }

    recent.push(now);
    this.recentProbes.set(platformKey, recent);
    const result = await input.runProbe();
    if (this.cache.size >= FORMAT_PROBE_CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(input.videoKey, result);
    return { kind: 'probed', result, cached: false };
  }
}

export interface FormatProbeRequest {
  jobId: string;
  projectId?: string;
  executablePath: string;
  url: string;
  /** Cookie / proxy / --js-runtimes giống lượt tải vừa lỗi. */
  extraArgs: readonly string[];
  signal?: AbortSignal;
}

export interface FormatProbeResult {
  summary: AvailableFormatSummary | null;
  /** stderr (cảnh báo yt-dlp) để tìm dấu hiệu máy bị hạn chế; hoặc lý do bước đọc thất bại. */
  text: string;
  exitCode: number | null;
}

export function buildFormatProbeArguments(url: string, extraArgs: readonly string[]): string[] {
  return buildSafeYtDlpArguments(
    ['--no-playlist', '--no-progress', '--socket-timeout', '20', '--print', FORMAT_PROBE_PRINT_TEMPLATE, ...extraArgs],
    url
  );
}

export async function probeAvailableFormats(
  processes: Pick<ProcessManager, 'run'>,
  request: FormatProbeRequest
): Promise<FormatProbeResult> {
  const stdoutLines: string[] = [];
  try {
    const result = await processes.run({
      jobId: request.jobId,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      tool: 'yt-dlp',
      executablePath: request.executablePath,
      args: buildFormatProbeArguments(request.url, request.extraArgs),
      priority: 'below_normal',
      timeoutMs: FORMAT_PROBE_TIMEOUT_MS,
      ...(request.signal ? { signal: request.signal } : {}),
      onStdoutLine: (line) => {
        stdoutLines.push(line);
      }
    });
    const stdout = stdoutLines.length ? stdoutLines.join('\n') : result.stdoutTail;
    return {
      summary: result.code === 0 ? parseFormatProbeOutput(stdout) : null,
      text: result.stderrTail,
      exitCode: result.code
    };
  } catch (error) {
    return { summary: null, text: error instanceof Error ? error.message : String(error), exitCode: null };
  }
}
