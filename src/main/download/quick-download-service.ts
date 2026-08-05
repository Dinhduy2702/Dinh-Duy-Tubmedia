import { app, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  validateQuickDownloadRequest,
  type QuickDownloadErrorCode,
  type QuickDownloadStatus,
  type ValidatedQuickDownloadRequest
} from '@shared/quick-download.js';
import { ProcessCancelledError, ToolNotFoundError } from '@shared/errors/app-errors.js';
import { hasConfiguredCookies } from '@shared/utils/cookie-policy.js';
import type { FileVerifier } from '../media/file-verifier.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { buildQuickDownloadArguments } from './quick-download-command.js';

interface PersistedQuickDownloadState {
  version: 1;
  statuses: QuickDownloadStatus[];
}

interface ActiveQuickTask {
  status: QuickDownloadStatus;
  request: ValidatedQuickDownloadRequest;
  controller: AbortController;
  tempDirectory: string;
  outputToken: string;
  runToken: string;
  cookiesAttached: boolean;
  compactFilename: boolean;
  genericFallbackTried: boolean;
  recentLines: string[];
  done: Promise<void>;
}

const TERMINAL_PHASES = new Set<QuickDownloadStatus['phase']>([
  'completed',
  'cancelled',
  'failed',
  'interrupted'
]);

function cloneStatus(status: QuickDownloadStatus): QuickDownloadStatus {
  return {
    ...status,
    warnings: [...status.warnings]
  };
}

function parseByteValue(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseProgressPercent(value: string): number {
  const parsed = Number.parseFloat(value.replace('%', '').trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(99.5, parsed));
}

function classifyCookieFailure(lines: string[], cookiesAttached: boolean): QuickDownloadErrorCode | null {
  const lower = lines.join('\n').toLowerCase();

  if (
    lower.includes('could not copy chrome cookie database') ||
    lower.includes('cookie database is locked') ||
    (lower.includes('permission denied') && lower.includes('cookie'))
  ) {
    return 'BROWSER_COOKIE_DATABASE_LOCKED';
  }

  if (
    /sign in|login required|confirm (?:you(?:'|’)?re|you are) not a bot|not a bot|cookies-from-browser|use --cookies|authentication|members.only|age.restricted|account required/.test(
      lower
    )
  ) {
    return cookiesAttached ? 'COOKIES_EXPIRED' : 'AUTHENTICATION_REQUIRED';
  }

  return null;
}

function cookieFailureMessage(code: QuickDownloadErrorCode): string {
  if (code === 'BROWSER_COOKIE_DATABASE_LOCKED') {
    return 'Trình duyệt đang khóa dữ liệu đăng nhập. Hãy đóng hoàn toàn trình duyệt hoặc dùng Dán cookies / Chọn tệp cookies.txt; Tải nhanh sẽ tự tiếp tục sau khi cập nhật.';
  }

  if (code === 'COOKIES_EXPIRED') {
    return 'Cookies hiện tại đã hết hạn hoặc không còn được YouTube chấp nhận. Hãy cập nhật cookies mới; Tải nhanh sẽ tự tiếp tục tác vụ này.';
  }

  return 'Video yêu cầu đăng nhập để xác nhận bạn không phải bot. Hãy mở Cookies và chọn một trong ba cách cấu hình; Tải nhanh sẽ tự tiếp tục sau khi lưu.';
}

function classifyOutputPathFailure(lines: string[]): boolean {
  const lower = lines.join('\n').toLowerCase();
  return /unable to open for writing|no such file or directory|filename or extension is too long|file name too long|winerror 206|cannot create (?:the )?file|path too long/.test(
    lower
  );
}

function classifyUnsupportedUrlFailure(lines: string[]): boolean {
  const lower = lines.join('\n').toLowerCase();
  return /unsupported url|no suitable extractor|url could not be handled|not a valid url|unknown url type/.test(
    lower
  );
}

function outputPathFailureMessage(): string {
  return 'Không thể tạo tệp tải xuống vì tên hoặc đường dẫn không hợp lệ/quá dài. Tubmedia đã tự thử lại bằng tên ngắn; hãy chọn thư mục có đường dẫn ngắn hơn, còn dung lượng và có quyền ghi.';
}

function unsupportedUrlMessage(): string {
  return 'Liên kết này chưa được yt-dlp hỗ trợ. Tubmedia đã thử bộ trích xuất chuyên dụng và chế độ liên kết trực tiếp/chung nhưng chưa tìm thấy luồng media. Hãy cập nhật yt-dlp trong Công cụ, kiểm tra lại liên kết bài/video cụ thể hoặc mở trang gốc để lấy liên kết trực tiếp.';
}

function isPersistedState(value: unknown): value is PersistedQuickDownloadState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedQuickDownloadState>;
  return candidate.version === 1 && Array.isArray(candidate.statuses);
}

export class QuickDownloadService {
  private activeTask: ActiveQuickTask | null = null;
  private readonly statuses = new Map<string, QuickDownloadStatus>();
  private persistTail: Promise<void> = Promise.resolve();
  private startTail: Promise<void> = Promise.resolve();
  private readonly statePath: string;
  private readonly tempRoot: string;
  private cookieBlockedRequest: ValidatedQuickDownloadRequest | null = null;

  public constructor(
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager,
    private readonly verifier: FileVerifier,
    private readonly logger: Logger,
    stateDirectory: string,
    private readonly settings?: SettingsService
  ) {
    this.statePath = join(stateDirectory, 'state.json');
    this.tempRoot = join(app.getPath('temp'), 'TubmediaQD');
  }

  private cookieSettings(): {
    cookiesFilePath: string;
    cookiesBrowser: 'none' | 'chrome' | 'edge' | 'firefox';
    cookiesBrowserProfile: string;
  } {
    const settings = this.settings?.get();
    return settings
      ? {
          cookiesFilePath: settings.cookiesFilePath,
          cookiesBrowser: settings.cookiesBrowser,
          cookiesBrowserProfile: settings.cookiesBrowserProfile
        }
      : {
          cookiesFilePath: '',
          cookiesBrowser: 'none',
          cookiesBrowserProfile: ''
        };
  }

  public isActive(): boolean {
    return Boolean(this.activeTask && !TERMINAL_PHASES.has(this.activeTask.status.phase));
  }

  public currentStatus(): QuickDownloadStatus | null {
    const active = this.activeTask?.status;
    if (active) return cloneStatus(active);

    const latest = [...this.statuses.values()].sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)
    )[0];
    return latest ? cloneStatus(latest) : null;
  }

  public async pauseActive(): Promise<QuickDownloadStatus | null> {
    const taskId = this.activeTask?.status.taskId;
    return taskId ? this.pause(taskId) : null;
  }

  public async resumeActive(): Promise<QuickDownloadStatus | null> {
    const taskId = this.activeTask?.status.taskId;
    return taskId ? this.resume(taskId) : null;
  }

  public async cancelActive(): Promise<QuickDownloadStatus | null> {
    const taskId = this.activeTask?.status.taskId;
    return taskId ? this.cancel(taskId) : null;
  }

  public defaultOutputDirectory(): string {
    return app.getPath('downloads');
  }

  public async recover(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const raw = await readFile(this.statePath, 'utf8').catch(() => null);
    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedState(parsed)) return;

      for (const stored of parsed.statuses.slice(-30)) {
        const recovered = cloneStatus({
          ...stored,
          mediaMode: (stored as Partial<QuickDownloadStatus>).mediaMode ?? 'video-audio',
          errorCode: (stored as Partial<QuickDownloadStatus>).errorCode ?? null
        });
        if (!TERMINAL_PHASES.has(recovered.phase)) {
          recovered.phase = 'interrupted';
          recovered.message =
            'Tác vụ Tải nhanh bị gián đoạn khi ứng dụng đóng. Hãy kiểm tra file hiện có rồi tải lại khi cần.';
          recovered.error = 'Tác vụ trước đó chưa hoàn tất.';
          recovered.completedAt = new Date().toISOString();
        }
        this.statuses.set(recovered.taskId, recovered);
      }
      this.pruneStatuses();
      await this.persist();
    } catch (error) {
      this.logger.warn(
        'quick-download',
        'QUICK_DOWNLOAD_STATE_RECOVERY_FAILED',
        `Không thể đọc trạng thái Tải nhanh cũ: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public async start(rawRequest: unknown): Promise<QuickDownloadStatus> {
    return this.enqueueStart(rawRequest, false);
  }

  public async retryCookieBlocked(): Promise<QuickDownloadStatus | null> {
    const request = this.cookieBlockedRequest;
    if (!request || !hasConfiguredCookies(this.cookieSettings())) {
      return this.currentStatus();
    }

    if (this.isActive()) return this.currentStatus();
    this.cookieBlockedRequest = null;
    return this.enqueueStart(request, true);
  }

  private async enqueueStart(rawRequest: unknown, forceCookies: boolean): Promise<QuickDownloadStatus> {
    const previousStart = this.startTail;
    let releaseStart!: () => void;
    this.startTail = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    await previousStart;

    try {
      return await this.startLocked(rawRequest, forceCookies);
    } finally {
      releaseStart();
    }
  }

  private async startLocked(rawRequest: unknown, forceCookies: boolean): Promise<QuickDownloadStatus> {
    const request = validateQuickDownloadRequest(rawRequest);

    if (this.isActive()) {
      throw new Error('Một video đang được tải nhanh. Hãy chờ hoàn tất hoặc hủy tác vụ hiện tại.');
    }

    await this.assertWritableDirectory(request.outputDirectory);
    await this.tools.ensureRequiredReady();

    const ytDlp = this.tools.get('yt-dlp');
    const ffmpeg = this.tools.get('ffmpeg');
    const ffprobe = this.tools.get('ffprobe');

    for (const tool of [ytDlp, ffmpeg, ffprobe]) {
      if (!tool.available || !tool.executablePath) {
        throw new ToolNotFoundError(tool.name);
      }
    }

    const ytDlpPath = ytDlp.executablePath;
    const ffmpegPath = ffmpeg.executablePath;
    if (!ytDlpPath || !ffmpegPath) {
      throw new Error('Đường dẫn công cụ Tải nhanh chưa sẵn sàng.');
    }

    const taskId = randomUUID();
    const outputToken = taskId.replaceAll('-', '').slice(0, 12);
    const runToken = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}` + `-${outputToken}`;
    const tempDirectory = join(this.tempRoot, outputToken);
    await mkdir(tempDirectory, { recursive: true });

    const status: QuickDownloadStatus = {
      taskId,
      mode: request.mode,
      mediaMode: request.mediaMode,
      phase: 'preparing',
      progress: 0,
      title: '',
      message:
        request.mode === 'range' ? 'Đang chuẩn bị tải đoạn video.' : 'Đang chuẩn bị tải toàn bộ video.',
      speed: '',
      eta: '',
      downloadedBytes: 0,
      totalBytes: 0,
      outputPath: null,
      outputDirectory: request.outputDirectory,
      requestedStartSeconds: request.startSeconds,
      requestedEndSeconds: request.endSeconds,
      actualDurationSeconds: null,
      accurateCut: request.accurateCut,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      errorCode: null,
      warnings: []
    };

    const active: ActiveQuickTask = {
      status,
      request,
      controller: new AbortController(),
      tempDirectory,
      outputToken,
      runToken,
      cookiesAttached: forceCookies && hasConfiguredCookies(this.cookieSettings()),
      compactFilename: false,
      genericFallbackTried: false,
      recentLines: [],
      done: Promise.resolve()
    };

    if (!forceCookies) this.cookieBlockedRequest = null;
    this.activeTask = active;
    this.publish(active);
    active.done = this.execute(active, ytDlpPath, ffmpegPath);
    return cloneStatus(status);
  }

  public status(taskId: string): QuickDownloadStatus | null {
    const current = this.statuses.get(taskId);
    return current ? cloneStatus(current) : null;
  }

  public async pause(taskId: string): Promise<QuickDownloadStatus | null> {
    const active = this.activeTask;
    if (!active || active.status.taskId !== taskId) return this.status(taskId);
    if (TERMINAL_PHASES.has(active.status.phase) || active.status.phase === 'paused') {
      return cloneStatus(active.status);
    }

    active.status.phase = 'pausing';
    active.status.message = 'Đang tạm dừng cây tiến trình Tải nhanh.';
    this.publish(active);

    await this.processes.pauseByJob(taskId);
    if (!this.processes.hasJob(taskId)) {
      await Promise.resolve();
      if (!TERMINAL_PHASES.has(active.status.phase)) {
        throw new Error('Tiến trình Tải nhanh đã kết thúc trước khi có thể tạm dừng.');
      }
      return cloneStatus(active.status);
    }

    active.status.phase = 'paused';
    active.status.message = 'Đã tạm dừng Tải nhanh.';
    this.publish(active);
    return cloneStatus(active.status);
  }

  public async resume(taskId: string): Promise<QuickDownloadStatus | null> {
    const active = this.activeTask;
    if (!active || active.status.taskId !== taskId) return this.status(taskId);
    if (active.status.phase !== 'paused') return cloneStatus(active.status);

    active.status.phase = 'resuming';
    active.status.message = 'Đang tiếp tục cây tiến trình Tải nhanh.';
    this.publish(active);

    await this.processes.resumeByJob(taskId);
    if (!this.processes.hasJob(taskId)) {
      await Promise.resolve();
      if (!TERMINAL_PHASES.has(active.status.phase)) {
        throw new Error('Tiến trình Tải nhanh không còn tồn tại để tiếp tục.');
      }
      return cloneStatus(active.status);
    }

    active.status.phase = 'downloading';
    active.status.message = 'Đang tiếp tục tải video.';
    this.publish(active);
    return cloneStatus(active.status);
  }

  public async cancel(taskId: string): Promise<QuickDownloadStatus | null> {
    const active = this.activeTask;
    if (!active || active.status.taskId !== taskId) return this.status(taskId);
    if (TERMINAL_PHASES.has(active.status.phase)) return cloneStatus(active.status);

    active.status.phase = 'cancelling';
    active.status.message = 'Đang dừng yt-dlp và toàn bộ tiến trình con.';
    this.publish(active);

    active.controller.abort();
    await this.processes.killByJob(taskId).catch(() => undefined);
    await active.done;
    return cloneStatus(active.status);
  }

  public revealOutput(taskId: string): boolean {
    const current = this.statuses.get(taskId);
    if (!current?.outputPath || !existsSync(current.outputPath)) return false;
    shell.showItemInFolder(current.outputPath);
    return true;
  }

  public async shutdown(preserve = true): Promise<void> {
    const active = this.activeTask;
    if (!active || TERMINAL_PHASES.has(active.status.phase)) {
      await this.persist();
      return;
    }

    active.status.phase = preserve ? 'interrupted' : 'cancelling';
    active.status.message = preserve
      ? 'Tác vụ bị gián đoạn do ứng dụng đang đóng.'
      : 'Đang hủy Tải nhanh do ứng dụng đang đóng.';
    active.status.error = preserve ? 'Ứng dụng đã đóng trước khi tác vụ hoàn tất.' : null;
    active.status.errorCode = null;
    active.status.completedAt = preserve ? new Date().toISOString() : null;
    this.publish(active);

    active.controller.abort();
    await this.processes.killByJob(active.status.taskId).catch(() => undefined);
    await active.done;
    await this.persist();
  }

  private async execute(active: ActiveQuickTask, ytDlpPath: string, ffmpegPath: string): Promise<void> {
    try {
      while (true) {
        const authentication = active.cookiesAttached ? this.cookieSettings() : undefined;
        const args = buildQuickDownloadArguments(
          active.request,
          {
            ffmpegDirectory: dirname(ffmpegPath),
            tempDirectory: active.tempDirectory,
            runToken: active.runToken,
            outputToken: active.outputToken
          },
          authentication,
          {
            compactFilename: active.compactFilename,
            forceGenericExtractor: active.genericFallbackTried
          }
        );

        active.recentLines = [];
        const result = await this.processes.run({
          jobId: active.status.taskId,
          tool: 'yt-dlp',
          executablePath: ytDlpPath,
          args,
          cwd: active.request.outputDirectory,
          signal: active.controller.signal,
          timeoutMs: 24 * 60 * 60 * 1000,
          priority: 'below_normal',
          onStdoutLine: (line) => this.consumeLine(active, line.trim()),
          onStderrLine: (line) => this.consumeLine(active, line.trim())
        });

        if (
          active.controller.signal.aborted ||
          active.status.phase === 'cancelling' ||
          active.status.phase === 'interrupted'
        ) {
          throw new ProcessCancelledError();
        }

        if (result.code !== 0) {
          const cookieCode = classifyCookieFailure(active.recentLines, active.cookiesAttached);

          if (
            cookieCode === 'AUTHENTICATION_REQUIRED' &&
            !active.cookiesAttached &&
            hasConfiguredCookies(this.cookieSettings())
          ) {
            active.cookiesAttached = true;
            active.status.phase = 'preparing';
            active.status.progress = 0;
            active.status.speed = '';
            active.status.eta = '';
            active.status.downloadedBytes = 0;
            active.status.totalBytes = 0;
            active.status.outputPath = null;
            active.status.error = null;
            active.status.errorCode = null;
            active.status.message = 'Video yêu cầu đăng nhập. Đang tự thử lại bằng cookies đã cấu hình.';
            this.publish(active);
            this.logger.info(
              'quick-download',
              'QUICK_DOWNLOAD_COOKIES_ATTACHED_ON_DEMAND',
              'Tải nhanh tự thử lại bằng cookies sau khi nền tảng yêu cầu xác thực.',
              { jobId: active.status.taskId }
            );
            continue;
          }

          if (cookieCode) {
            this.cookieBlockedRequest = active.request;
            this.failTask(active, cookieFailureMessage(cookieCode), cookieCode);
            await this.cleanupActive(active, false);
            return;
          }

          if (classifyOutputPathFailure(active.recentLines)) {
            if (!active.compactFilename) {
              active.compactFilename = true;
              await this.prepareAutomaticRetry(
                active,
                'Tên tệp từ nền tảng quá dài hoặc không phù hợp với Windows. Đang tự thử lại bằng tên rút gọn an toàn.'
              );
              this.logger.warn(
                'quick-download',
                'QUICK_DOWNLOAD_SAFE_FILENAME_RETRY',
                'Tải nhanh tự thử lại bằng tên tệp ngắn sau lỗi mở tệp để ghi.',
                { jobId: active.status.taskId }
              );
              continue;
            }

            this.failTask(active, outputPathFailureMessage(), 'OUTPUT_PATH_INVALID');
            await this.cleanupActive(active, true);
            return;
          }

          if (classifyUnsupportedUrlFailure(active.recentLines)) {
            if (!active.genericFallbackTried) {
              active.genericFallbackTried = true;
              active.compactFilename = true;
              await this.prepareAutomaticRetry(
                active,
                'Nền tảng chưa có bộ trích xuất riêng. Đang thử chế độ liên kết trực tiếp/chung.'
              );
              this.logger.info(
                'quick-download',
                'QUICK_DOWNLOAD_GENERIC_EXTRACTOR_RETRY',
                'Tải nhanh tự thử lại liên kết bằng generic/default extractors.',
                { jobId: active.status.taskId }
              );
              continue;
            }

            this.failTask(active, unsupportedUrlMessage(), 'UNSUPPORTED_URL');
            await this.cleanupActive(active, true);
            return;
          }

          if (active.genericFallbackTried) {
            this.failTask(active, unsupportedUrlMessage(), 'UNSUPPORTED_URL');
            await this.cleanupActive(active, true);
            return;
          }
        }

        await this.finishTask(active, result.code);
        return;
      }
    } catch (error) {
      if (active.status.phase === 'interrupted') {
        await this.cleanupActive(active, false);
        return;
      }

      if (
        active.status.phase === 'cancelling' ||
        error instanceof ProcessCancelledError ||
        active.controller.signal.aborted
      ) {
        active.status.phase = 'cancelled';
        active.status.message = 'Đã hủy Tải nhanh.';
        active.status.error = null;
        active.status.errorCode = null;
        active.status.completedAt = new Date().toISOString();
        this.publish(active);
        await this.cleanupActive(active, true);
        return;
      }

      this.failTask(active, error instanceof Error ? error.message : String(error), null);
      await this.cleanupActive(active, false);
    }
  }

  private async prepareAutomaticRetry(active: ActiveQuickTask, message: string): Promise<void> {
    await rm(active.tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(active.tempDirectory, { recursive: true });
    active.status.phase = 'preparing';
    active.status.progress = 0;
    active.status.title = '';
    active.status.speed = '';
    active.status.eta = '';
    active.status.downloadedBytes = 0;
    active.status.totalBytes = 0;
    active.status.outputPath = null;
    active.status.error = null;
    active.status.errorCode = null;
    active.status.message = message;
    active.recentLines = [];
    this.publish(active);
  }

  private consumeLine(active: ActiveQuickTask, line: string): void {
    if (!line) return;

    active.recentLines.push(line);
    if (active.recentLines.length > 80) {
      active.recentLines.splice(0, active.recentLines.length - 80);
    }

    if (line.startsWith('TUBMEDIA_TITLE|')) {
      active.status.title = line.slice('TUBMEDIA_TITLE|'.length);
      active.status.phase = 'downloading';
      active.status.message = 'Đang tải dữ liệu video.';
      this.publish(active);
      return;
    }

    if (line.startsWith('TUBMEDIA_FILE|')) {
      active.status.outputPath = line.slice('TUBMEDIA_FILE|'.length);
      active.status.phase = 'processing';
      active.status.progress = Math.max(99, active.status.progress);
      active.status.message = 'Đang hoàn tất file video.';
      this.publish(active);
      return;
    }

    if (line.startsWith('TUBMEDIA_PROGRESS|')) {
      const parts = line.split('|');
      active.status.phase = 'downloading';
      active.status.progress = parseProgressPercent(parts[1] ?? '');
      active.status.speed = (parts[2] ?? '').trim();
      active.status.eta = (parts[3] ?? '').trim();
      active.status.downloadedBytes = parseByteValue(parts[4] ?? '');
      active.status.totalBytes = parseByteValue(parts[5] ?? '');
      active.status.message =
        active.status.mode === 'range' ? 'Đang tải đoạn video đã chọn.' : 'Đang tải toàn bộ video.';
      this.publish(active);
    }
  }

  private async finishTask(active: ActiveQuickTask, code: number): Promise<void> {
    if (code !== 0) {
      const detail = this.lastUsefulError(active.recentLines);
      throw new Error(detail ? `Tải video thất bại: ${detail}` : `yt-dlp kết thúc với mã ${code}.`);
    }

    if (!active.status.outputPath || !existsSync(active.status.outputPath)) {
      active.status.outputPath = await this.findOutputByToken(
        active.status.outputDirectory,
        active.outputToken
      );
    }

    if (!active.status.outputPath || !existsSync(active.status.outputPath)) {
      throw new Error('yt-dlp báo hoàn tất nhưng không tìm thấy file đầu ra.');
    }

    active.status.phase = 'verifying';
    active.status.progress = 99.5;
    active.status.message = 'Đang kiểm tra file đầu ra bằng ffprobe/FFmpeg.';
    this.publish(active);

    const expectedDuration =
      active.status.mode === 'range' &&
      active.status.requestedStartSeconds !== null &&
      active.status.requestedEndSeconds !== null
        ? active.status.requestedEndSeconds - active.status.requestedStartSeconds
        : undefined;

    const checked = await this.verifier.verify(active.status.outputPath, 'standard', expectedDuration, {
      jobId: active.status.taskId,
      signal: active.controller.signal,
      expectedStreams: {
        video: active.status.mediaMode !== 'audio-only',
        audio: active.status.mediaMode !== 'video-only'
      }
    });

    active.status.actualDurationSeconds = checked.duration;
    if (!checked.ok) {
      throw new Error(`File đầu ra không đạt kiểm tra: ${checked.reasons.join('; ')}`);
    }

    active.status.phase = 'completed';
    active.status.progress = 100;
    active.status.message =
      active.status.mediaMode === 'audio-only'
        ? 'Đã tải và kiểm tra xong tệp âm thanh.'
        : active.status.mediaMode === 'video-only'
          ? 'Đã tải và kiểm tra xong video không âm thanh.'
          : active.status.mode === 'range'
            ? 'Đã tải và kiểm tra xong đoạn video.'
            : 'Đã tải và kiểm tra xong video.';
    active.status.completedAt = new Date().toISOString();
    active.status.error = null;
    active.status.errorCode = null;
    this.cookieBlockedRequest = null;
    this.publish(active);
    await this.cleanupActive(active, true);
  }

  private failTask(active: ActiveQuickTask, message: string, errorCode: QuickDownloadErrorCode | null): void {
    if (TERMINAL_PHASES.has(active.status.phase)) return;
    active.status.phase = 'failed';
    active.status.error = message;
    active.status.errorCode = errorCode;
    active.status.message = message;
    active.status.completedAt = new Date().toISOString();
    this.publish(active);
    this.logger.error('quick-download', 'QUICK_DOWNLOAD_FAILED', message, {
      jobId: active.status.taskId,
      metadata: {
        outputPath: active.status.outputPath,
        recentLines: active.recentLines.slice(-10)
      }
    });
  }

  private publish(active: ActiveQuickTask): void {
    this.statuses.set(active.status.taskId, cloneStatus(active.status));
    this.pruneStatuses();
    void this.persist();
  }

  private async cleanupActive(active: ActiveQuickTask, removeTemp: boolean): Promise<void> {
    if (removeTemp) {
      await rm(active.tempDirectory, {
        recursive: true,
        force: true
      }).catch(() => undefined);
    }

    if (this.activeTask === active) this.activeTask = null;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot: PersistedQuickDownloadState = {
      version: 1,
      statuses: [...this.statuses.values()].map(cloneStatus)
    };
    const pending = `${this.statePath}.${process.pid}.pending`;

    const operation = this.persistTail.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      await writeFile(pending, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(pending, this.statePath).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
        await rm(this.statePath, { force: true });
        await rename(pending, this.statePath);
      });
    });

    this.persistTail = operation.catch((error: unknown) => {
      this.logger.warn(
        'quick-download',
        'QUICK_DOWNLOAD_STATE_WRITE_FAILED',
        `Không thể lưu trạng thái Tải nhanh: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    await operation;
  }

  private async assertWritableDirectory(directory: string): Promise<void> {
    const info = await stat(directory).catch(() => null);
    if (!info?.isDirectory()) throw new Error('Thư mục lưu video không tồn tại.');

    await access(directory, fsConstants.W_OK).catch(() => {
      throw new Error('Tubmedia không có quyền ghi vào thư mục đã chọn.');
    });
  }

  private async findOutputByToken(outputDirectory: string, token: string): Promise<string | null> {
    const entries = await readdir(outputDirectory, {
      withFileTypes: true
    }).catch(() => []);
    const matches: Array<{ path: string; modifiedAt: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes(token) || entry.name.endsWith('.part')) {
        continue;
      }

      const fullPath = join(outputDirectory, entry.name);
      const info = await stat(fullPath).catch(() => null);
      if (info && info.size > 0) {
        matches.push({ path: fullPath, modifiedAt: info.mtimeMs });
      }
    }

    matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
    return matches[0]?.path ?? null;
  }

  private lastUsefulError(lines: string[]): string | null {
    const ignored = ['TUBMEDIA_PROGRESS|', '[download]', '[Merger]', '[ExtractAudio]'];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line && !ignored.some((prefix) => line.startsWith(prefix))) {
        return line.slice(0, 500);
      }
    }
    return null;
  }

  private pruneStatuses(): void {
    if (this.statuses.size <= 30) return;
    const removable = [...this.statuses.entries()]
      .filter(([, status]) => TERMINAL_PHASES.has(status.phase))
      .sort((left, right) => left[1].startedAt.localeCompare(right[1].startedAt));

    while (this.statuses.size > 20 && removable.length > 0) {
      const next = removable.shift();
      if (next) this.statuses.delete(next[0]);
    }
  }
}
