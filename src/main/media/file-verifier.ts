import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
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

export type VisualIntegrityIssueType = 'decode' | 'black' | 'freeze';

export interface VisualIntegrityIssue {
  type: VisualIntegrityIssueType;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
  message: string;
}

export interface VisualIntegrityResult {
  ok: boolean;
  reasons: string[];
  issues: VisualIntegrityIssue[];
}

export interface VerificationOptions {
  jobId?: string;
  expectedStreams?: { video: boolean; audio: boolean };
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

/* TUBMEDIA AUDIO ONLY VERIFICATION R30 */
interface VerificationMediaSummary {
  duration: number;
  width: number;
  height: number;
  audioCodec: string | null;
  fileSize: number;
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(typeof value === 'string' ? value : '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timeBaseSeconds(stream: Record<string, unknown> | undefined): number | null {
  if (!stream) return null;
  const durationTs = finitePositive(stream.duration_ts);
  const timeBase = typeof stream.time_base === 'string' ? stream.time_base : '';
  const [numeratorText = '', denominatorText = ''] = timeBase.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (durationTs === null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const duration = durationTs * (numerator / denominator);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/* TUBMEDIA MERGED VISUAL INTEGRITY R33 */
function visualClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

function parseNumberAfter(line: string, key: string): number | null {
  const pattern = key + ':\\s*([0-9]+(?:\\.[0-9]+)?)';
  const match = line.match(new RegExp(pattern, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function isVisualIssueNearBoundary(
  issue: Pick<VisualIntegrityIssue, 'startSeconds' | 'endSeconds'>,
  boundaries: readonly number[],
  windowSeconds = 2.5
): boolean {
  const end = issue.endSeconds ?? issue.startSeconds;
  return boundaries.some((boundary) =>
    Math.abs(issue.startSeconds - boundary) <= windowSeconds ||
    Math.abs(end - boundary) <= windowSeconds ||
    (issue.startSeconds <= boundary && end >= boundary)
  );
}

/* TUBMEDIA STRICT VISUAL BOUNDARY POLICY HOTFIX11 */
export interface ShortVisualBoundaryTransition {
  classification: 'boundary-transition';
  boundaryIndex: number;
  boundarySeconds: number;
  durationSeconds: number;
  distanceSeconds: number;
}

const SHORT_BOUNDARY_EDGE_WINDOW_SECONDS = 0.35;
const SHORT_BOUNDARY_BLACK_MAX_SECONDS = 0.35;
const SHORT_BOUNDARY_FREEZE_MAX_SECONDS = 1.25;

export function classifyShortVisualBoundaryTransition(
  issue: Pick<VisualIntegrityIssue, 'type' | 'startSeconds' | 'endSeconds' | 'durationSeconds'>,
  boundaries: readonly number[]
): ShortVisualBoundaryTransition | null {
  if (issue.type !== 'black' && issue.type !== 'freeze') return null;
  if (!Number.isFinite(issue.startSeconds) || issue.startSeconds < 0) return null;

  const reportedDuration = issue.durationSeconds;
  const derivedDuration = issue.endSeconds === null
    ? null
    : Math.max(0, issue.endSeconds - issue.startSeconds);
  const durationSeconds = reportedDuration ?? derivedDuration;
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

  const maximumDuration = issue.type === 'black'
    ? SHORT_BOUNDARY_BLACK_MAX_SECONDS
    : SHORT_BOUNDARY_FREEZE_MAX_SECONDS;
  if (durationSeconds - maximumDuration > 0.000_001) return null;

  const issueEnd = Math.max(
    issue.startSeconds,
    issue.endSeconds ?? issue.startSeconds + durationSeconds
  );
  let best: ShortVisualBoundaryTransition | null = null;
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
    const boundarySeconds = boundaries[boundaryIndex];
    if (boundarySeconds === undefined || !Number.isFinite(boundarySeconds)) continue;
    const crossesBoundary = issue.startSeconds <= boundarySeconds && issueEnd >= boundarySeconds;
    const distanceSeconds = crossesBoundary
      ? 0
      : Math.min(
          Math.abs(issue.startSeconds - boundarySeconds),
          Math.abs(issueEnd - boundarySeconds)
        );
    if (distanceSeconds - SHORT_BOUNDARY_EDGE_WINDOW_SECONDS > 0.000_001) continue;
    if (best === null || distanceSeconds < best.distanceSeconds) {
      best = {
        classification: 'boundary-transition',
        boundaryIndex,
        boundarySeconds,
        durationSeconds,
        distanceSeconds
      };
    }
  }
  return best;
}

export class FileVerifier {
  public constructor(
    private readonly analyzer: MediaAnalyzer,
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager
  ) {}

  private async analyzeAudioOnly(
    path: string,
    verifyJobId: string,
    options: VerificationOptions
  ): Promise<VerificationMediaSummary> {
    const ffprobe = this.tools.get('ffprobe');
    if (!ffprobe.available || !ffprobe.executablePath) {
      throw new VerificationFailedError('Thiếu ffprobe để kiểm tra tệp âm thanh.');
    }
    const result = await this.processes.run({
      jobId: `${verifyJobId}-audio-probe`,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      tool: 'ffprobe',
      executablePath: ffprobe.executablePath,
      args: ['-v', 'error', '-show_streams', '-show_format', '-of', 'json=compact=1', path],
      timeoutMs: 120_000,
      priority: 'below_normal',
      ...(options.signal ? { signal: options.signal } : {})
    });
    if (result.code !== 0) {
      throw new VerificationFailedError(result.stderrTail || 'ffprobe không đọc được tệp âm thanh.');
    }
    let data: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
    try {
      data = JSON.parse(result.stdoutTail) as typeof data;
    } catch {
      throw new VerificationFailedError('ffprobe trả JSON không hợp lệ khi kiểm tra âm thanh.');
    }
    const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
    const duration =
      finitePositive(data.format?.duration) ??
      finitePositive(audio?.duration) ??
      timeBaseSeconds(audio) ??
      0;
    const file = await stat(path);
    return {
      duration,
      width: 0,
      height: 0,
      audioCodec: audio
        ? typeof audio.codec_name === 'string' && audio.codec_name.trim()
          ? audio.codec_name.trim()
          : 'unknown'
        : null,
      fileSize: file.size
    };
  }

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

  /* TUBMEDIA SOURCE-AWARE VISUAL BASELINE R38 */
  public async sourceContainsVisualIssue(
    path: string,
    issue: VisualIntegrityIssue,
    localStartSeconds: number,
    localEndSeconds: number,
    options: VerificationOptions = {}
  ): Promise<boolean> {
    if (issue.type === 'decode') return false;
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) return false;

    const expectedIssueDuration = Math.max(
      issue.type === 'black' ? 0.08 : 0.5,
      issue.durationSeconds ?? Math.max(0, (issue.endSeconds ?? issue.startSeconds) - issue.startSeconds)
    );
    const padding = Math.max(1.5, Math.min(3, expectedIssueDuration));
    const seekStart = Math.max(0, localStartSeconds - padding);
    const requestedEnd = Math.max(localEndSeconds, localStartSeconds + expectedIssueDuration) + padding;
    const windowDuration = Math.max(2.5, requestedEnd - seekStart);
    let maxBlackDuration = 0;
    let openFreezeStart: number | null = null;
    let maxFreezeDuration = 0;
    const probeJobId =
      (options.jobId ?? 'visual-source') +
      '-source-match-' + Date.now() + '-' + Math.floor(Math.random() * 1_000_000);

    const result = await this.processes.run({
      jobId: probeJobId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath,
      args: [
        '-hide_banner', '-nostdin', '-v', 'info', '-xerror', '-err_detect', 'explode',
        '-ss', seekStart.toFixed(3), '-i', path, '-t', windowDuration.toFixed(3),
        '-map', '0:v:0', '-an',
        '-vf', 'blackdetect=d=0.08:pix_th=0.02,freezedetect=n=-60dB:d=1',
        '-f', 'null', '-'
      ],
      timeoutMs: Math.max(60_000, Math.min(10 * 60_000, windowDuration * 20_000)),
      priority: 'below_normal',
      ...(options.signal ? { signal: options.signal } : {}),
      onStderrLine: (line) => {
        if (line.includes('black_start:')) {
          const duration = parseNumberAfter(line, 'black_duration');
          if (duration !== null) maxBlackDuration = Math.max(maxBlackDuration, duration);
        }
        if (line.includes('lavfi.freezedetect.freeze_start:')) {
          openFreezeStart = parseNumberAfter(line, 'lavfi.freezedetect.freeze_start');
        }
        if (line.includes('lavfi.freezedetect.freeze_end:')) {
          const end = parseNumberAfter(line, 'lavfi.freezedetect.freeze_end');
          const reported = parseNumberAfter(line, 'lavfi.freezedetect.freeze_duration');
          const derived = end !== null && openFreezeStart !== null ? Math.max(0, end - openFreezeStart) : null;
          const duration = reported ?? derived;
          if (duration !== null) maxFreezeDuration = Math.max(maxFreezeDuration, duration);
          openFreezeStart = null;
        }
      }
    });
    if (result.code !== 0) return false;
    if (openFreezeStart !== null) {
      maxFreezeDuration = Math.max(maxFreezeDuration, Math.max(0, windowDuration - openFreezeStart));
    }

    const minimumComparableDuration = Math.max(
      issue.type === 'black' ? 0.08 : 0.5,
      expectedIssueDuration * 0.45
    );
    return issue.type === 'black'
      ? maxBlackDuration >= minimumComparableDuration
      : maxFreezeDuration >= minimumComparableDuration;
  }

  public async verifyVisualIntegrity(
    path: string,
    expectedDuration: number,
    boundaries: readonly number[] = [],
    options: VerificationOptions = {}
  ): Promise<VisualIntegrityResult> {
    const reasons: string[] = [];
    const issues: VisualIntegrityIssue[] = [];
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) {
      return {
        ok: false,
        reasons: ['Thiếu FFmpeg để hậu kiểm toàn bộ hình ảnh thành phẩm.'],
        issues: [{
          type: 'decode',
          startSeconds: 0,
          endSeconds: null,
          durationSeconds: null,
          message: 'Thiếu FFmpeg để hậu kiểm toàn bộ hình ảnh thành phẩm.'
        }]
      };
    }

    const verifyJobId = options.jobId ?? ('visual-verify-' + Date.now());
    let lastProcessedSeconds = 0;
    let openFreezeStart: number | null = null;
    const rawBlack: VisualIntegrityIssue[] = [];
    const rawFreeze: VisualIntegrityIssue[] = [];

    options.onProgress?.(0);
    const result = await this.processes.run({
      jobId: verifyJobId + '-full-frame',
      ...(options.projectId ? { projectId: options.projectId } : {}),
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath,
      args: [
        '-hide_banner',
        '-nostdin',
        '-v',
        'info',
        '-xerror',
        '-err_detect',
        'explode',
        '-i',
        path,
        '-map',
        '0:v:0',
        ...(options.expectedStreams?.audio ? ['-map', '0:a:0'] : ['-an']),
        '-vf',
        'blackdetect=d=0.08:pix_th=0.02,freezedetect=n=-60dB:d=1',
        '-progress',
        'pipe:1',
        '-nostats',
        '-f',
        'null',
        '-'
      ],
      timeoutMs: 48 * 60 * 60 * 1000,
      priority: 'below_normal',
      ...(options.signal ? { signal: options.signal } : {}),
      onStdoutLine: (line) => {
        if (line.startsWith('out_time_ms=')) {
          const microseconds = Number(line.slice('out_time_ms='.length));
          if (Number.isFinite(microseconds)) lastProcessedSeconds = Math.max(0, microseconds / 1_000_000);
        }
        const percent = ffmpegProgressPercent(line, expectedDuration);
        if (percent !== null) options.onProgress?.(percent);
      },
      onStderrLine: (line) => {
        if (line.includes('black_start:')) {
          const start = parseNumberAfter(line, 'black_start');
          const end = parseNumberAfter(line, 'black_end');
          const duration = parseNumberAfter(line, 'black_duration');
          if (start !== null) {
            rawBlack.push({
              type: 'black',
              startSeconds: start,
              endSeconds: end,
              durationSeconds: duration,
              message: 'Phát hiện đoạn hình đen tại khoảng ' + visualClock(start) + '.'
            });
          }
        }
        if (line.includes('lavfi.freezedetect.freeze_start:')) {
          openFreezeStart = parseNumberAfter(line, 'lavfi.freezedetect.freeze_start');
        }
        if (line.includes('lavfi.freezedetect.freeze_end:')) {
          const end = parseNumberAfter(line, 'lavfi.freezedetect.freeze_end');
          const duration = parseNumberAfter(line, 'lavfi.freezedetect.freeze_duration');
          const start = openFreezeStart ?? (end !== null && duration !== null ? Math.max(0, end - duration) : null);
          if (start !== null) {
            rawFreeze.push({
              type: 'freeze',
              startSeconds: start,
              endSeconds: end,
              durationSeconds: duration,
              message: 'Phát hiện hình đứng bất thường tại khoảng ' + visualClock(start) + '.'
            });
          }
          openFreezeStart = null;
        }
      }
    });

    if (openFreezeStart !== null) {
      const end = Math.max(openFreezeStart, Math.min(expectedDuration, lastProcessedSeconds || expectedDuration));
      rawFreeze.push({
        type: 'freeze',
        startSeconds: openFreezeStart,
        endSeconds: end,
        durationSeconds: Math.max(0, end - openFreezeStart),
        message: 'Phát hiện hình đứng bất thường tại khoảng ' + visualClock(openFreezeStart) + '.'
      });
    }

    for (const issue of rawBlack) {
      const duration = issue.durationSeconds ?? Math.max(0, (issue.endSeconds ?? issue.startSeconds) - issue.startSeconds);
      if (duration >= 5 || isVisualIssueNearBoundary(issue, boundaries, 1.5)) issues.push(issue);
    }
    for (const issue of rawFreeze) {
      const duration = issue.durationSeconds ?? Math.max(0, (issue.endSeconds ?? issue.startSeconds) - issue.startSeconds);
      if (duration >= 12 || isVisualIssueNearBoundary(issue, boundaries, 1.5)) issues.push(issue);
    }

    if (result.code !== 0) {
      const message = 'Lỗi giải mã hình ảnh khi hậu kiểm toàn bộ thành phẩm, gần ' + visualClock(lastProcessedSeconds) + '.';
      issues.unshift({
        type: 'decode',
        startSeconds: lastProcessedSeconds,
        endSeconds: null,
        durationSeconds: null,
        message
      });
      reasons.push(message);
    }
    for (const issue of issues) {
      if (!reasons.includes(issue.message)) reasons.push(issue.message);
    }
    options.onProgress?.(100);
    return { ok: reasons.length === 0, reasons, issues };
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
      const expectedStreams = options.expectedStreams ?? { video: true, audio: false };
      const info = expectedStreams.video
        ? await this.analyzer.analyze(path, verifyJobId)
        : await this.analyzeAudioOnly(path, verifyJobId, options);
      if (expectedDuration !== undefined) {
        const durationTolerance = Math.max(3, expectedDuration * 0.02);
        if (Math.abs(info.duration - expectedDuration) > durationTolerance) {
          reasons.push(
            `Thời lượng lệch ${Math.abs(info.duration - expectedDuration).toFixed(2)}s: thực tế ${info.duration.toFixed(2)}s / dự kiến ${expectedDuration.toFixed(2)}s (cho phép ${durationTolerance.toFixed(2)}s).`
          );
        }
      }
      if (expectedStreams.video && (info.width <= 0 || info.height <= 0)) {
        reasons.push('Không tìm thấy video stream hoặc độ phân giải không hợp lệ.');
      }
      if (expectedStreams.audio && !info.audioCodec) {
        reasons.push('Không tìm thấy audio stream theo lựa chọn tải.');
      }
      if (info.duration <= 0) reasons.push('Thời lượng không hợp lệ.');
      if (info.fileSize <= 0) reasons.push('Dung lượng file không hợp lệ.');

      if (level === 'standard' && info.duration > 0 && expectedStreams.video) {
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
            '-xerror',
            '-err_detect',
            'explode',
            '-i',
            path,
            ...(expectedStreams.video ? ['-map', '0:v:0'] : []),
            ...(expectedStreams.audio ? ['-map', '0:a:0'] : []),
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
