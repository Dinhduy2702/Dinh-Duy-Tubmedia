/**
 * Giai đoạn 6 mục 2/3 (2026-09-23/24) — "Cắt tệp có sẵn": cắt một đoạn từ video đã có sẵn trên máy, tích
 * hợp vào bước "Xem trước & Cắt". Đơn giản có chủ đích — không hàng đợi, không tạm dừng/tiếp tục, không
 * cookie: chỉ MỘT tác vụ ffmpeg chạy trên một tệp cục bộ người dùng tự chọn, có thể hủy.
 * Mục 3: thêm đổi tỉ lệ khung hình (9:16/1:1/16:9) — nền mờ kiểu CapCut, luôn mã hóa lại (xem
 * local-cut-command.ts). Tên tệp kết quả có thêm hậu tố tỉ lệ (ví dụ " [9x16]") khi không phải 'original'.
 */
import { shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import { access, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { sanitizeProgress } from '@shared/utils/progress-policy.js';
import {
  LOCAL_CUT_ASPECT_RATIOS,
  validateLocalCutRequest,
  type LocalCutAspectRatio,
  type LocalCutStatus,
  type ValidatedLocalCutRequest
} from '@shared/local-cut.js';
import { ProcessCancelledError, ToolNotFoundError } from '@shared/errors/app-errors.js';
import type { FileVerifier } from './file-verifier.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { buildLocalCutArguments, buildLocalFrameExtractArguments } from './local-cut-command.js';

const TERMINAL_PHASES = new Set<LocalCutStatus['phase']>(['completed', 'cancelled', 'failed']);
const ASPECT_RATIOS = new Set<LocalCutAspectRatio>(LOCAL_CUT_ASPECT_RATIOS);
const FRAME_TIMEOUT_MS = 20_000;
const CUT_TIMEOUT_MS = 6 * 60 * 60 * 1000;

interface ActiveLocalCut {
  status: LocalCutStatus;
  request: ValidatedLocalCutRequest;
  controller: AbortController;
}

export class LocalCutService {
  private readonly statuses = new Map<string, LocalCutStatus>();
  private active: ActiveLocalCut | null = null;

  public constructor(
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager,
    private readonly verifier: FileVerifier,
    private readonly logger: Logger
  ) {}

  public isActive(): boolean {
    return Boolean(this.active && !TERMINAL_PHASES.has(this.active.status.phase));
  }

  public async previewFrame(rawRequest: unknown): Promise<{ dataUrl: string }> {
    const candidate = rawRequest as { filePath?: unknown; timestampSeconds?: unknown; aspectRatio?: unknown };
    const filePath = typeof candidate.filePath === 'string' ? candidate.filePath.trim() : '';
    const timestampSeconds = typeof candidate.timestampSeconds === 'number' ? candidate.timestampSeconds : NaN;
    const aspectRatio: LocalCutAspectRatio =
      typeof candidate.aspectRatio === 'string' && ASPECT_RATIOS.has(candidate.aspectRatio as LocalCutAspectRatio)
        ? (candidate.aspectRatio as LocalCutAspectRatio)
        : 'original';

    if (!filePath || !Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
      throw new Error('Yêu cầu xem trước khung hình không hợp lệ.');
    }
    if (!existsSync(filePath)) {
      throw new Error('Không tìm thấy tệp nguồn.');
    }

    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const workDirectory = await mkdtemp(join(tmpdir(), 'tubmedia-local-cut-frame-'));
    try {
      const framePath = join(workDirectory, 'frame.jpg');
      const result = await this.processes.run({
        jobId: `local-cut-frame-${randomUUID()}`,
        tool: 'ffmpeg',
        executablePath: ffmpeg.executablePath,
        args: buildLocalFrameExtractArguments(filePath, timestampSeconds, framePath, aspectRatio),
        priority: 'below_normal',
        timeoutMs: FRAME_TIMEOUT_MS
      });
      if (result.code !== 0 || !existsSync(framePath)) {
        throw new Error(
          'Không trích được khung hình — mốc thời gian có thể vượt quá thời lượng thật của tệp.'
        );
      }
      const buffer = await readFile(framePath);
      return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` };
    } finally {
      await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  public start(rawRequest: unknown): Promise<LocalCutStatus> {
    let request: ValidatedLocalCutRequest;

    try {
      request = validateLocalCutRequest(rawRequest);

      if (this.isActive()) {
        throw new Error('Một lượt cắt khác đang chạy.');
      }
      if (!existsSync(request.filePath)) {
        throw new Error('Không tìm thấy tệp nguồn.');
      }
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const taskId = randomUUID();
    const status: LocalCutStatus = {
      taskId,
      phase: 'queued',
      progress: 0,
      message: 'Đang chuẩn bị cắt đoạn.',
      sourceFilePath: request.filePath,
      sourceFileName: basename(request.filePath),
      outputPath: null,
      requestedStartSeconds: request.startSeconds,
      requestedEndSeconds: request.endSeconds,
      actualDurationSeconds: null,
      accurateCut: request.accurateCut,
      aspectRatio: request.aspectRatio,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      warnings: []
    };
    const active: ActiveLocalCut = { status, request, controller: new AbortController() };
    this.statuses.set(taskId, status);
    this.active = active;

    void this.run(active).catch((error: unknown) => {
      if (TERMINAL_PHASES.has(active.status.phase)) return;
      this.fail(active, error instanceof Error ? error.message : String(error));
    });

    return Promise.resolve(status);
  }

  public status(taskId: string): LocalCutStatus | null {
    return this.statuses.get(taskId) ?? null;
  }

  public cancel(taskId: string): Promise<LocalCutStatus | null> {
    const active = this.active;
    if (!active || active.status.taskId !== taskId || TERMINAL_PHASES.has(active.status.phase)) {
      return Promise.resolve(this.statuses.get(taskId) ?? null);
    }
    active.status.message = 'Đang dừng theo yêu cầu.';
    this.publish(active);
    active.controller.abort();
    return Promise.resolve(this.statuses.get(taskId) ?? null);
  }

  public revealOutput(taskId: string): boolean {
    const current = this.statuses.get(taskId);
    if (!current?.outputPath || !existsSync(current.outputPath)) return false;
    shell.showItemInFolder(current.outputPath);
    return true;
  }

  private publish(active: ActiveLocalCut): void {
    this.statuses.set(active.status.taskId, { ...active.status, warnings: [...active.status.warnings] });
  }

  private fail(active: ActiveLocalCut, message: string): void {
    active.status.phase = 'failed';
    active.status.error = message;
    active.status.message = message;
    active.status.completedAt = new Date().toISOString();
    this.publish(active);
    this.logger.error('local-cut', 'LOCAL_CUT_FAILED', message, { jobId: active.status.taskId });
    if (this.active === active) this.active = null;
  }

  private async run(active: ActiveLocalCut): Promise<void> {
    const { request, status } = active;
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const sourceStat = await stat(request.filePath).catch(() => null);
    if (!sourceStat || !sourceStat.isFile()) {
      throw new Error('Tệp nguồn không tồn tại hoặc không phải tệp thường.');
    }

    const outputStat = await stat(request.outputDirectory).catch(() => null);
    if (!outputStat?.isDirectory()) {
      throw new Error('Thư mục lưu kết quả không tồn tại.');
    }
    await access(request.outputDirectory, fsConstants.W_OK).catch(() => {
      throw new Error('Tubmedia không có quyền ghi vào thư mục đã chọn.');
    });

    // Đổi tỉ lệ khung hình LUÔN bắt buộc mã hóa lại (bộ lọc nền mờ là bộ lọc pixel, không thể đi cùng
    // -c copy) — accurateCut không còn ý nghĩa khi aspectRatio khác 'original', xem local-cut-command.ts.
    const isReencode = request.accurateCut || request.aspectRatio !== 'original';

    status.phase = 'processing';
    status.message =
      request.aspectRatio !== 'original'
        ? `Đang cắt và đổi tỉ lệ ${request.aspectRatio} (nền mờ kiểu CapCut).`
        : request.accurateCut
          ? 'Đang cắt và mã hóa lại đoạn đã chọn.'
          : 'Đang cắt nhanh đoạn đã chọn.';
    this.publish(active);

    const extension = isReencode ? '.mp4' : extname(request.filePath) || '.mp4';
    const baseName = basename(request.filePath, extname(request.filePath));
    const aspectTag =
      request.aspectRatio === 'original' ? '' : ` [${request.aspectRatio.replace(':', 'x')}]`;
    const outputName = `${baseName} [${Math.round(request.startSeconds)}-${Math.round(request.endSeconds)}]${aspectTag}${extension}`;
    const finalOutput = join(request.outputDirectory, outputName);
    const pendingOutput = `${finalOutput}.pending${extension}`;

    const expectedDuration = request.endSeconds - request.startSeconds;
    const args = buildLocalCutArguments({
      filePath: request.filePath,
      startSeconds: request.startSeconds,
      endSeconds: request.endSeconds,
      accurateCut: request.accurateCut,
      aspectRatio: request.aspectRatio,
      outputPath: pendingOutput
    });

    let result: Awaited<ReturnType<ProcessManager['run']>>;
    try {
      result = await this.processes.run({
        jobId: `local-cut-${status.taskId}`,
        tool: 'ffmpeg',
        executablePath: ffmpeg.executablePath,
        args,
        priority: 'below_normal',
        signal: active.controller.signal,
        timeoutMs: CUT_TIMEOUT_MS,
        onStdoutLine: (line) => {
          if (!line.startsWith('out_time_ms=')) return;
          const microseconds = Number(line.slice('out_time_ms='.length));
          if (!Number.isFinite(microseconds) || expectedDuration <= 0) return;
          status.progress = sanitizeProgress((microseconds / 1_000_000 / expectedDuration) * 100);
          this.publish(active);
        }
      });
    } catch (error) {
      // Sửa lỗi (2026-09-24): ProcessManager.run() NÉM lỗi (không trả về {code,...}) khi tiến trình bị
      // hủy qua signal — bài kiểm thật (Playwright + Electron thật) bắt đúng lỗi này: trước khi sửa,
      // hủy giữa chừng bị báo NHẦM thành "failed" thay vì "cancelled" vì lỗi lọt qua catch chung ở start().
      if (error instanceof ProcessCancelledError || active.controller.signal.aborted) {
        await rm(pendingOutput, { force: true }).catch(() => undefined);
        status.phase = 'cancelled';
        status.message = 'Đã dừng theo yêu cầu.';
        status.completedAt = new Date().toISOString();
        this.publish(active);
        if (this.active === active) this.active = null;
        return;
      }
      throw error;
    }

    if (active.controller.signal.aborted) {
      await rm(pendingOutput, { force: true }).catch(() => undefined);
      status.phase = 'cancelled';
      status.message = 'Đã dừng theo yêu cầu.';
      status.completedAt = new Date().toISOString();
      this.publish(active);
      if (this.active === active) this.active = null;
      return;
    }

    if (result.code !== 0 || !existsSync(pendingOutput)) {
      await rm(pendingOutput, { force: true }).catch(() => undefined);
      throw new Error(result.stderrTail.trim() || `FFmpeg kết thúc với mã ${result.code}.`);
    }

    status.phase = 'verifying';
    status.message = 'Đang kiểm tra đoạn vừa cắt.';
    this.publish(active);

    const checked = await this.verifier.verify(pendingOutput, 'standard', expectedDuration, {
      jobId: status.taskId,
      signal: active.controller.signal,
      expectedStreams: { video: true, audio: false }
    });

    if (!checked.ok) {
      await rm(pendingOutput, { force: true }).catch(() => undefined);
      throw new Error(`Đoạn vừa cắt không đạt kiểm tra: ${checked.reasons.join('; ')}`);
    }

    await rename(pendingOutput, finalOutput);

    status.actualDurationSeconds = checked.duration;
    status.outputPath = finalOutput;
    status.phase = 'completed';
    status.progress = 100;
    status.message = 'Đã cắt và kiểm tra xong đoạn đã chọn.';
    status.completedAt = new Date().toISOString();
    this.publish(active);
    if (this.active === active) this.active = null;
  }
}
