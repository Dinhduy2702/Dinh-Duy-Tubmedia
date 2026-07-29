import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type { VerificationLevel } from '@shared/types/domain.js';
import { VerificationFailedError } from '@shared/errors/app-errors.js';
import type { MediaAnalyzer } from './media-analyzer.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { ToolManager } from '../tools/tool-manager.js';

export interface VerificationResult {
  ok: boolean;
  path: string;
  level: VerificationLevel;
  reasons: string[];
  duration: number;
}

export interface VerificationOptions {
  jobId?: string;
  projectId?: string | null;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

function ffmpegProgressPercent(line: string, duration: number): number | null {
  if (duration <= 0) return null;
  if (line.startsWith('out_time_ms=')) {
    const microseconds = Number(line.slice('out_time_ms='.length));
    if (Number.isFinite(microseconds)) {
      return Math.max(0, Math.min(100, (microseconds / 1_000_000 / duration) * 100));
    }
  }
  if (line === 'progress=end') return 100;
  return null;
}

function conciseProcessError(...values: string[]): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1_500);
}

export class FileVerifier {
  public constructor(
    private readonly analyzer: MediaAnalyzer,
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager
  ) {}

  private async verifyVideoSample(
    path: string,
    positionSeconds: number,
    label: string,
    verifyJobId: string,
    options: VerificationOptions
  ): Promise<string | null> {
    const ffprobe = this.tools.get('ffprobe');
    if (!ffprobe.available || !ffprobe.executablePath) {
      throw new VerificationFailedError('Thiếu ffprobe cho Standard verification.');
    }

    const position = Math.max(0, positionSeconds).toFixed(3);
    const context = {
      jobId: `${verifyJobId}-sample-${label}`,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      timeoutMs: 60_000,
      priority: 'below_normal' as const,
      ...(options.signal ? { signal: options.signal } : {})
    };
    const probe = await this.processes.run({
      ...context,
      tool: 'ffprobe',
      executablePath: ffprobe.executablePath,
      args: [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-read_intervals',
        `${position}%+2`,
        '-show_entries',
        'packet=pts_time,size',
        '-of',
        'csv=p=0',
        path
      ]
    });
    if (probe.code === 0 && probe.stdoutTail.trim()) return null;

    // Một số MP4 stream-copy có edit-list/timestamp làm ffprobe seek theo interval
    // không trả packet dù video vẫn giải mã bình thường. Kiểm tra thêm một frame
    // bằng FFmpeg để tránh đưa nhầm thành phẩm hợp lệ vào quarantine.
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) {
      return `Không đọc được mẫu ${label} tại ${position}s: ${conciseProcessError(probe.stderrTail, probe.stdoutTail) || 'ffprobe không trả packet.'}`;
    }
    const decode = await this.processes.run({
      ...context,
      jobId: `${verifyJobId}-decode-${label}`,
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath,
      args: [
        '-hide_banner',
        '-v',
        'error',
        '-ss',
        position,
        '-i',
        path,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-'
      ]
    });
    if (decode.code === 0) return null;

    return `Không giải mã được mẫu ${label} tại ${position}s: ${conciseProcessError(probe.stderrTail, decode.stderrTail) || `ffprobe=${probe.code}, ffmpeg=${decode.code}`}`;
  }

  public async verify(
    path: string,
    level: VerificationLevel,
    expectedDuration?: number,
    options: VerificationOptions = {}
  ): Promise<VerificationResult> {
    const reasons: string[] = [];
    try {
      await access(path, constants.R_OK);
    } catch {
      return {
        ok: false,
        path,
        level,
        reasons: ['Tệp không tồn tại hoặc không đọc được.'],
        duration: 0
      };
    }

    try {
      const verifyJobId = options.jobId ?? `verify-${Date.now()}`;
      const info = await this.analyzer.analyze(path, verifyJobId);
      if (expectedDuration !== undefined) {
        const durationTolerance = Math.max(3, expectedDuration * 0.02);
        if (Math.abs(info.duration - expectedDuration) > durationTolerance) {
          reasons.push(
            `Thời lượng lệch ${Math.abs(info.duration - expectedDuration).toFixed(2)}s: thực tế ${info.duration.toFixed(2)}s / dự kiến ${expectedDuration.toFixed(2)}s (cho phép ${durationTolerance.toFixed(2)}s).`
          );
        }
      }
      if (info.width <= 0 || info.height <= 0) {
        reasons.push('Độ phân giải không hợp lệ.');
      }
      if (info.duration <= 0) reasons.push('Thời lượng không hợp lệ.');
      if (info.fileSize <= 0) reasons.push('Dung lượng file không hợp lệ.');

      if (level === 'standard' && info.duration > 0) {
        const sampleDuration = expectedDuration !== undefined &&
          Number.isFinite(expectedDuration) &&
          expectedDuration > 0 &&
          Math.abs(info.duration - expectedDuration) > Math.max(3, expectedDuration * 0.02)
          ? expectedDuration
          : info.duration;
        const endOffset = Math.min(2, Math.max(0.25, sampleDuration * 0.08));
        const samples = [
          { position: 0, label: 'đầu' },
          { position: sampleDuration / 2, label: 'giữa' },
          { position: Math.max(0, sampleDuration - endOffset), label: 'cuối' }
        ].filter((sample, index, values) =>
          values.findIndex((candidate) => Math.abs(candidate.position - sample.position) < 0.05) === index
        );
        for (const sample of samples) {
          const failure = await this.verifyVideoSample(
            path,
            sample.position,
            sample.label,
            verifyJobId,
            options
          );
          if (failure) reasons.push(failure);
        }
      }

      if (level === 'deep') {
        const ffmpeg = this.tools.get('ffmpeg');
        if (!ffmpeg.available || !ffmpeg.executablePath) {
          throw new VerificationFailedError('Thiếu FFmpeg cho Deep verification.');
        }
        options.onProgress?.(0);
        const result = await this.processes.run({
          jobId: verifyJobId,
          ...(options.projectId ? { projectId: options.projectId } : {}),
          tool: 'ffmpeg',
          executablePath: ffmpeg.executablePath,
          args: [
            '-hide_banner',
            '-v',
            'error',
            '-i',
            path,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-progress',
            'pipe:1',
            '-nostats',
            '-f',
            'null',
            '-'
          ],
          timeoutMs: 24 * 60 * 60 * 1000,
          priority: 'below_normal',
          ...(options.signal ? { signal: options.signal } : {}),
          onStdoutLine: (line) => {
            const percent = ffmpegProgressPercent(line, info.duration);
            if (percent !== null) options.onProgress?.(percent);
          }
        });
        if (result.code !== 0 || result.stderrTail.trim()) {
          reasons.push(result.stderrTail || 'Deep verification thất bại.');
        }
        options.onProgress?.(100);
      }

      return {
        ok: reasons.length === 0,
        path,
        level,
        reasons,
        duration: info.duration
      };
    } catch (error) {
      return {
        ok: false,
        path,
        level,
        reasons: [error instanceof Error ? error.message : String(error)],
        duration: 0
      };
    }
  }
}
