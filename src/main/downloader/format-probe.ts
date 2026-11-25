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
  type AvailableFormatSummary
} from '@shared/utils/format-availability.js';
import { buildSafeYtDlpArguments } from './ytdlp-arguments.js';

export const FORMAT_PROBE_TIMEOUT_MS = 90_000;

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
