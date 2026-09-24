import { malformedYouTubeVideoUrlMessage } from '@shared/utils/youtube-url-validation.js';
import { type BrowserWindow } from 'electron';
import { cpus, freemem, totalmem } from 'node:os';
import { rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { AttentionNotice, JobType, QueueJob, ResourceProfile } from '@shared/types/domain.js';
import { IPC } from '@shared/contracts/channels.js';
import { retryDelayMs } from '@shared/utils/retry.js';
import { hasConfiguredCookies, isCookieBlockingCode } from '@shared/utils/cookie-policy.js';
import {
  independentDownloadProjectCanStart,
  mergeSourceDownloadLimit,
  queueExecutionLane
} from '@shared/utils/queue-lane.js';
import type { QueueRepository } from '../database/repositories/queue-repository.js';
import type { ProjectRepository } from '../database/repositories/project-repository.js';
import type { ItemRepository } from '../database/repositories/item-repository.js';
import type { MediaSourceRepository } from '../database/repositories/media-source-repository.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { DownloadEngine, DownloadProgress } from '../downloader/download-engine.js';
import type { ClipEngine } from '../clips/clip-engine.js';
import type { MergeEngine } from '../merge/merge-engine.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { Logger } from '../logging/logger.js';
import {
  SystemLoadGovernor,
  DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS,
  defaultLowPercentFor
} from './system-load-governor.js';
import { InvalidInputError, ProcessingFailedError, type AppError } from '@shared/errors/app-errors.js';
import { cleanupTemporaryArtifacts } from '../files/temporary-cleanup.js';
import { sanitizeNullableSeconds, sanitizeProgress } from '@shared/utils/progress-policy.js';
import { initialJobStatus, resolveResumeStatus } from '@shared/utils/job-state-machine.js';
import {
  exhaustedDownloadFailureMessage,
  isCircuitEligibleDownloadFailure
} from '@shared/utils/download-failure.js';
import { effectiveMemoryReserveBytes } from '@shared/utils/resource-memory.js';
import { toneForErrorCode } from '@shared/utils/notice-tone.js';

interface ActiveJob {
  job: QueueJob;
  controller: AbortController;
  promise: Promise<void>;
  sourceLock: string | null;
}
const TERMINAL_STATUSES = new Set(['completed', 'skipped', 'cancelled', 'failed']);
const PAUSABLE_STATUSES = new Set([
  'pending',
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying',
  'interrupted'
]);
const RUNNING_STATUSES = new Set([
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging'
]);
const JOB_TYPE_TEXT: Record<JobType, string> = {
  analyze: 'phân tích',
  download: 'tải video',
  clip: 'cắt đoạn',
  normalize: 'chuẩn hóa',
  merge: 'ghép video',
  verify: 'kiểm tra tệp'
};

interface StoredProgressPhase {
  key: string;
  label: string;
  percent: number;
  state: 'waiting' | 'active' | 'completed';
}

const PHASE_ORDER = [
  'prepare',
  'analyze',
  'download',
  'process',
  'normalize',
  'remux',
  'merge',
  'verify',
  'finalize'
];

function phaseIdentity(status: QueueJob['status'], stage: string): { key: string; label: string } {
  const text = stage.toLocaleLowerCase('vi-VN');
  if (/remux/.test(text)) return { key: 'remux', label: 'Remux nhanh' };
  if (/chuẩn hóa/.test(text) || status === 'normalizing')
    return { key: 'normalize', label: 'Chuẩn hóa video' };
  if (/ghép|concat|stream copy/.test(text) || status === 'merging')
    return { key: 'merge', label: 'Ghép video' };
  if (/kiểm tra|xác minh|hợp lệ/.test(text) || status === 'verifying')
    return { key: 'verify', label: 'Kiểm tra tệp' };
  if (/timeline|ghi tệp cuối|hoàn tất/.test(text)) return { key: 'finalize', label: 'Hoàn tất thành phẩm' };
  if (/tải/.test(text) || status === 'downloading') return { key: 'download', label: 'Tải video' };
  if (/phân tích|đối chiếu/.test(text) || status === 'analyzing')
    return { key: 'analyze', label: 'Phân tích nguồn' };
  if (/xử lý|cắt/.test(text) || status === 'processing') return { key: 'process', label: 'Xử lý video' };
  return { key: 'prepare', label: 'Chuẩn bị' };
}

function progressPhases(
  current: QueueJob,
  status: QueueJob['status'],
  stage: string | undefined,
  percent: number
): StoredProgressPhase[] {
  const raw = Array.isArray(current.input.progressPhases) ? current.input.progressPhases : [];
  const previous = raw.filter((value): value is StoredProgressPhase => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<StoredProgressPhase>;
    return typeof item.key === 'string' && typeof item.label === 'string' && typeof item.percent === 'number';
  });
  const map = new Map(previous.map((phase) => [phase.key, { ...phase }]));

  if (status === 'completed' || status === 'skipped') {
    for (const phase of map.values()) {
      phase.percent = 100;
      phase.state = 'completed';
    }
    map.set('finalize', {
      key: 'finalize',
      label: status === 'skipped' ? stage || 'Đã dùng lại kết quả hợp lệ' : 'Đã hoàn tất',
      percent: 100,
      state: 'completed'
    });
  } else if (stage) {
    const identity = phaseIdentity(status, stage);
    const activeIndex = PHASE_ORDER.indexOf(identity.key);
    for (const phase of map.values()) {
      const index = PHASE_ORDER.indexOf(phase.key);
      if (index >= 0 && activeIndex >= 0 && index < activeIndex) {
        phase.percent = 100;
        phase.state = 'completed';
      } else if (phase.key !== identity.key && phase.state === 'active') {
        phase.state = 'waiting';
      }
    }
    const existing = map.get(identity.key);
    map.set(identity.key, {
      key: identity.key,
      label: identity.label,
      percent: Math.max(existing?.percent ?? 0, sanitizeProgress(percent)),
      state: percent >= 100 ? 'completed' : 'active'
    });
  }

  return [...map.values()].sort((a, b) => PHASE_ORDER.indexOf(a.key) - PHASE_ORDER.indexOf(b.key)).slice(-9);
}
export class QueueManager {
  private readonly active = new Map<string, ActiveJob>();
  private readonly sourceLocks = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;
  private tickRunning = false;
  private paused = false;
  private previousCpu = cpus();
  // VẤN ĐỀ 2 mục 1 (2026-09-22): một bộ điều tiết theo hồ sơ tài nguyên (ngưỡng cao lấy từ
  // cpuSoftLimitPercent của chính hồ sơ đó — tôn trọng cấu hình người dùng đã có, không thêm ngưỡng mới).
  private readonly loadGovernors = new Map<string, SystemLoadGovernor>();
  private window: BrowserWindow | null = null;
  private readonly repeatedFailures = new Map<string, number[]>();
  private readonly cleanupInProgress = new Set<string>();
  private readonly blockingNoticeKeys = new Set<string>();
  // TUBMEDIA DISK SPACE AUTO RECOVERY R28
  private readonly diskRecoveryChecks = new Map<string, number>();
  private readonly diskRecoveryInProgress = new Set<string>();
  private lastActiveDiskCheckAt = 0;
  private readonly progressUpdates = new Map<
    string,
    {
      at: number;
      status: QueueJob['status'];
      stage?: string;
    }
  >();
  public constructor(
    private readonly repo: QueueRepository,
    private readonly projects: ProjectRepository,
    private readonly items: ItemRepository,
    private readonly sources: MediaSourceRepository,
    private readonly settings: SettingsService,
    private readonly downloader: DownloadEngine,
    private readonly clips: ClipEngine,
    private readonly merger: MergeEngine,
    private readonly processes: ProcessManager,
    private readonly logger: Logger,
    private readonly canExecute: () => boolean = () => true
  ) {}
  public setWindow(window: BrowserWindow): void {
    this.window = window;
  }
  public start(): void {
    this.repo.recoverInterrupted();
    this.repo.resetInterrupted();
    const releasedCookieJobs = this.repo.releaseInheritedCookieBlocks();
    if (releasedCookieJobs > 0) {
      this.logger.info(
        'queue',
        'LEGACY_COOKIE_BLOCKS_RELEASED',
        `Đã gỡ trạng thái cookies bị sao chép nhầm khỏi ${releasedCookieJobs} video để hàng đợi tiếp tục kiểm tra từng link.`
      );
    }
    const recoveredSizeJobs = this.repo.recoverLegacySizeEstimateFailures();
    if (recoveredSizeJobs > 0) {
      this.logger.info(
        'queue',
        'LEGACY_SIZE_ESTIMATE_FAILURES_RECOVERED',
        `Đã tự đưa ${recoveredSizeJobs} video từng bị cách ly nhầm vì metadata dung lượng ước tính về hàng đợi để tải lại sạch.`
      );
    }
    if (hasConfiguredCookies(this.settings.get())) {
      this.resumeCookieBlockedJobs();
    }
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    this.scheduleTick(0);
  }
  public async stop(preserveForResume = true): Promise<void> {
    this.schedulerRunning = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const active of this.active.values()) {
      if (preserveForResume)
        this.repo.update(active.job.id, {
          status: 'interrupted',
          errorCode: 'APP_SHUTDOWN',
          errorMessage: 'Ứng dụng đã đóng an toàn; tác vụ sẽ tiếp tục ở lần mở sau.'
        });
      active.controller.abort();
    }
    await Promise.allSettled([...this.active.values()].map((x) => x.promise));
  }

  private scheduleTick(delayMs: number): void {
    if (!this.schedulerRunning || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.schedulerRunning) return;
        if (this.tickRunning) {
          this.scheduleTick(500);
          return;
        }
        this.tickRunning = true;
        void this.tick()
          .catch((error: unknown) => {
            this.logger.error(
              'queue',
              'QUEUE_SCHEDULER_TICK_FAILED',
              error instanceof Error ? error.message : String(error)
            );
          })
          .finally(() => {
            this.tickRunning = false;
            // Khi đang xử lý, phản hồi hàng đợi nhanh. Khi rảnh, giảm truy vấn SQLite,
            // CPU và số lần statfs để giao diện luôn ưu tiên thao tác của người dùng.
            this.scheduleTick(this.active.size > 0 ? 350 : 1_000);
          });
      },
      Math.max(0, delayMs)
    );
  }
  public list(projectId?: string): QueueJob[] {
    return this.repo.list(projectId);
  }
  public recoverToolBlocked(): number {
    if (!this.canExecute()) return 0;
    const recovered = this.repo.recoverToolBlocked();
    for (const projectId of recovered.projectIds) this.projects.setStatus(projectId, 'active');
    if (recovered.jobs > 0) {
      this.logger.info(
        'queue',
        'TOOL_BLOCKED_JOBS_RECOVERED',
        `Đã tự đưa ${recovered.jobs} tác vụ từng bị chặn do thiếu công cụ về hàng chờ sau khi công cụ sẵn sàng.`
      );
      this.emit();
    }
    return recovered.jobs;
  }
  private wakeScheduler(): void {
    if (!this.schedulerRunning || this.tickRunning) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.scheduleTick(0);
  }
  private emit(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC.events.queueChanged, this.repo.list());
    }
    this.wakeScheduler();
  }
  private emitProgress(job: QueueJob): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(IPC.events.jobProgress, job);
  }
  private profileFor(job: QueueJob): ResourceProfile {
    const profiles = this.settings.profiles().resources;
    const project = job.projectId ? this.projects.get(job.projectId) : null;
    return profiles.find((x) => x.id === project?.resourceProfileId) ?? profiles[0]!;
  }
  private limitFor(type: JobType, profile: ResourceProfile): number {
    if (type === 'download') return profile.downloadWorkers;
    if (type === 'clip') return profile.clipWorkers;
    if (type === 'normalize' || type === 'merge') return profile.normalizeWorkers;
    if (type === 'analyze' || type === 'verify') return profile.analyzeWorkers;
    return 1;
  }
  private dependencyState(job: QueueJob, all: QueueJob[]): 'ready' | 'waiting' | 'failed' {
    const dependencies = Array.isArray(job.input.dependsOn)
      ? job.input.dependsOn.filter((x): x is string => typeof x === 'string')
      : [];
    const states = dependencies.map((id) => all.find((x) => x.id === id)?.status);
    if (states.some((status) => status === undefined || status === 'failed' || status === 'cancelled'))
      return 'failed';
    return states.every((status) => status === 'completed' || status === 'skipped') ? 'ready' : 'waiting';
  }
  private cpuPercent(): number {
    const current = cpus();
    let idle = 0;
    let total = 0;
    const sum = (t: { user: number; nice: number; sys: number; idle: number; irq: number }): number =>
      t.user + t.nice + t.sys + t.idle + t.irq;
    current.forEach((cpu, index) => {
      const previous = this.previousCpu[index] ?? cpu;
      total += sum(cpu.times) - sum(previous.times);
      idle += cpu.times.idle - previous.times.idle;
    });
    this.previousCpu = current;
    return total > 0 ? (1 - idle / total) * 100 : 0;
  }
  // TUBMEDIA RACE SAFE RESUME R29
  private pauseResumeInput(job: QueueJob, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const live = this.repo.get(job.id);
    const resumeStatus =
      live && live.status !== 'paused' && live.status !== 'interrupted' ? live.status : job.status;
    return { ...extra, resumeStatus };
  }

  private async resumeActiveJobState(
    current: QueueJob,
    active: ActiveJob,
    preserveCookieMarker: boolean
  ): Promise<QueueJob | null> {
    await this.processes.resumeByJob(current.id);
    const observed = this.repo.get(current.id);
    if (!observed || TERMINAL_STATUSES.has(observed.status)) return observed;
    const targetStatus = resolveResumeStatus(observed.status, current.input.resumeStatus, active.job.type);
    return this.repo.update(
      current.id,
      {
        status: targetStatus,
        errorCode: preserveCookieMarker ? current.errorCode : null,
        errorMessage: preserveCookieMarker ? current.errorMessage : null,
        finishedAt: null,
        speed: null,
        etaSeconds: null
      },
      { resumeStatus: null }
    );
  }

  private formatDiskBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0 GB';
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private diskFoldersForJob(job: QueueJob): string[] {
    if (!job.projectId) return [];
    const project = this.projects.get(job.projectId);
    if (!project) return [];

    const folders =
      job.type === 'download'
        ? [project.sourceFolder]
        : job.type === 'clip'
          ? [project.tempFolder]
          : job.type === 'merge' && job.input.timelineOnly !== true
            ? [project.tempFolder, project.outputFolder]
            : job.type === 'normalize'
              ? [project.outputFolder]
              : [];

    return [...new Set(folders.filter((folder) => folder.trim().length > 0))];
  }

  private async diskSpaceStateForJobs(jobs: QueueJob[]): Promise<{
    ready: boolean;
    folder: string | null;
    freeBytes: number;
    requiredBytes: number;
  }> {
    const checks = new Map<string, number>();
    for (const job of jobs) {
      if (!job.projectId) continue;
      const required = this.profileFor(job).diskFreeMinimumBytes;
      for (const folder of this.diskFoldersForJob(job)) {
        checks.set(folder, Math.max(checks.get(folder) ?? 0, required));
      }
    }
    for (const [folder, requiredBytes] of checks) {
      try {
        const fsInfo = await statfs(folder);
        const freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
        if (freeBytes < requiredBytes) return { ready: false, folder, freeBytes, requiredBytes };
      } catch {
        return { ready: false, folder, freeBytes: 0, requiredBytes };
      }
    }
    return { ready: true, folder: null, freeBytes: 0, requiredBytes: 0 };
  }

  private async guardActiveDiskSpace(): Promise<boolean> {
    const now = Date.now();
    if (this.active.size === 0 || now - this.lastActiveDiskCheckAt < 5_000) return false;
    this.lastActiveDiskCheckAt = now;

    for (const active of this.active.values()) {
      const current = this.repo.get(active.job.id);
      if (!current || !PAUSABLE_STATUSES.has(current.status)) continue;
      const requiredBytes = this.profileFor(current).diskFreeMinimumBytes;

      for (const folder of this.diskFoldersForJob(current)) {
        let freeBytes = 0;
        try {
          const fsInfo = await statfs(folder);
          freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
        } catch (error) {
          const message =
            `Không thể tiếp tục ghi vào ${folder}: ${error instanceof Error ? error.message : String(error)}. ` +
            'Tubmedia đã dừng an toàn tác vụ đang chạy để tránh mất dữ liệu.';
          this.repo.update(
            current.id,
            {
              status: 'paused',
              errorCode: 'PERMISSION_DENIED',
              errorMessage: message,
              speed: null,
              etaSeconds: null
            },
            this.pauseResumeInput(current)
          );
          const pausedProcesses = await this.processes.pauseByJob(current.id).catch(() => 0);
          if (pausedProcesses === 0) active.controller.abort();
          await this.pauseProjectForBlockingError(current, 'PERMISSION_DENIED', message);
          this.notifyBlockingError('PERMISSION_DENIED', message, current);
          this.logger.warn('queue', 'ACTIVE_WRITE_PATH_UNAVAILABLE', message, {
            jobId: current.id,
            ...(current.projectId ? { projectId: current.projectId } : {})
          });
          this.emit();
          return true;
        }

        if (freeBytes >= requiredBytes) continue;

        const message =
          `Ổ đĩa chứa ${folder} chỉ còn ${this.formatDiskBytes(freeBytes)}, thấp hơn mức an toàn ` +
          `${this.formatDiskBytes(requiredBytes)}. Tubmedia đã tạm dừng ngay tác vụ đang chạy để tránh đầy ổ; ` +
          'hãy dọn dung lượng rồi nhấn Tiếp tục.';
        this.repo.update(
          current.id,
          {
            status: 'paused',
            errorCode: 'DISK_FULL',
            errorMessage: message,
            speed: null,
            etaSeconds: null
          },
          this.pauseResumeInput(current)
        );
        const pausedProcesses = await this.processes.pauseByJob(current.id).catch(() => 0);
        if (pausedProcesses === 0) active.controller.abort();
        await this.pauseProjectForBlockingError(current, 'DISK_FULL', message);
        this.notifyBlockingError('DISK_FULL', message, current);
        this.logger.warn('queue', 'ACTIVE_DISK_GUARD_PAUSED', message, {
          jobId: current.id,
          ...(current.projectId ? { projectId: current.projectId } : {}),
          metadata: { folder, freeBytes, requiredBytes }
        });
        this.emit();
        return true;
      }
    }

    return false;
  }

  private notifyDiskSpaceRecovered(projectId: string, resumedJobs: number): void {
    if (!this.window || this.window.isDestroyed()) return;
    const notice: AttentionNotice = {
      id: `disk-space-recovered-${projectId}`,
      severity: 'success',
      title: 'Dung lượng ổ đĩa đã đủ',
      message: `Tubmedia đã kiểm tra lại và tự đưa ${resumedJobs} tác vụ về hàng đợi. Cảnh báo hết dung lượng trước đó đã được gỡ.`,
      code: 'DISK_SPACE_RECOVERED',
      sticky: false,
      projectId
    };
    this.window.webContents.send(IPC.events.attention, notice);
  }

  private async recoverDiskFullProjects(all: QueueJob[]): Promise<boolean> {
    const grouped = new Map<string, QueueJob[]>();
    for (const job of all) {
      if (!job.projectId || job.errorCode !== 'DISK_FULL') continue;
      if (job.status !== 'paused' && job.status !== 'interrupted') continue;
      const jobs = grouped.get(job.projectId) ?? [];
      jobs.push(job);
      grouped.set(job.projectId, jobs);
    }
    let changed = false;
    const now = Date.now();
    for (const [projectId, blockedJobs] of grouped) {
      if (this.diskRecoveryInProgress.has(projectId)) continue;
      const previous = this.diskRecoveryChecks.get(projectId) ?? 0;
      if (now - previous < 5_000) continue;
      this.diskRecoveryChecks.set(projectId, now);
      this.diskRecoveryInProgress.add(projectId);
      try {
        const disk = await this.diskSpaceStateForJobs(blockedJobs);
        if (!disk.ready) continue;
        let resumedJobs = 0;
        for (const job of this.repo.list(projectId)) {
          if (job.errorCode !== 'DISK_FULL') continue;
          if (job.status !== 'paused' && job.status !== 'interrupted') continue;
          const active = this.active.get(job.id);
          let resumed: QueueJob | null;
          if (active) {
            try {
              resumed = await this.resumeActiveJobState(job, active, false);
            } catch (error) {
              this.logger.warn(
                'queue',
                'DISK_SPACE_ACTIVE_RESUME_RETRY',
                `Dung lượng đã đủ nhưng tiến trình ${job.id} chưa thể tiếp tục ngay: ${error instanceof Error ? error.message : String(error)}`,
                { projectId, jobId: job.id }
              );
              continue;
            }
          } else {
            resumed = this.repo.update(
              job.id,
              {
                status: 'pending',
                errorCode: null,
                errorMessage: null,
                finishedAt: null,
                speed: null,
                etaSeconds: null
              },
              {
                progressStage: 'Dung lượng đã đủ — Tubmedia tự tiếp tục',
                resumeStatus: null
              }
            );
          }
          if (!resumed) continue;
          this.emitProgress(resumed);
          resumedJobs += 1;
        }
        if (resumedJobs > 0) {
          this.clearBlockingNoticeKeys(projectId);
          this.repeatedFailures.delete(projectId);
          this.projects.setStatus(projectId, 'active');
          this.logger.info(
            'queue',
            'DISK_SPACE_RECOVERED',
            `Ổ đĩa đã đủ dung lượng; ${resumedJobs} tác vụ được tự động tiếp tục.`,
            { projectId, metadata: { resumedJobs } }
          );
          this.notifyDiskSpaceRecovered(projectId, resumedJobs);
          changed = true;
        }
      } finally {
        this.diskRecoveryInProgress.delete(projectId);
      }
    }
    if (changed) this.emit();
    return changed;
  }

  // VẤN ĐỀ 2 mục 1 (2026-09-22): lấy (hoặc tạo mới) bộ điều tiết CPU riêng cho từng hồ sơ tài nguyên —
  // ngưỡng cao = cpuSoftLimitPercent của chính hồ sơ (tôn trọng giá trị người dùng đã đặt/đề xuất theo
  // máy), ngưỡng thấp thấp hơn một khoảng an toàn để tạo độ trễ (hysteresis), tránh nhấp nháy bật/tắt.
  private loadGovernorFor(profile: ResourceProfile): SystemLoadGovernor {
    const existing = this.loadGovernors.get(profile.id);
    if (existing) return existing;
    const governor = new SystemLoadGovernor({
      highPercent: profile.cpuSoftLimitPercent,
      lowPercent: defaultLowPercentFor(profile.cpuSoftLimitPercent),
      sustainedMs: DEFAULT_LOAD_GOVERNOR_SUSTAINED_MS
    });
    this.loadGovernors.set(profile.id, governor);
    return governor;
  }

  /** true nếu ĐANG giảm tải vì CPU hệ thống cao liên tục — dùng để hiện trạng thái trên giao diện. */
  public isSystemLoadThrottled(): boolean {
    return [...this.loadGovernors.values()].some((governor) => governor.isThrottled());
  }

  private async resourcesAllow(
    job: QueueJob,
    profile: ResourceProfile,
    cpuPercent: number
  ): Promise<boolean> {
    const memoryReserve = effectiveMemoryReserveBytes(profile.memoryFreeMinimumBytes, totalmem());
    if (freemem() < memoryReserve) return false;
    // VẤN ĐỀ 2 mục 1 (2026-09-22): thay kiểm tra tức thời (cpuPercent > cpuSoftLimitPercent, dễ nhấp
    // nháy bật/tắt khi CPU dao động quanh ngưỡng) bằng bộ điều tiết có độ trễ hai chiều, dùng ĐÚNG ngưỡng
    // cpuSoftLimitPercent của hồ sơ làm ngưỡng cao (không đổi hành vi với cấu hình người dùng đã đặt).
    // Áp dụng cho cả tải lẫn ghép (download cũng dùng ffmpeg để hậu xử lý/tạo bản edit, không chỉ mạng)
    // — CHỈ chặn tác vụ MỚI bắt đầu, không đụng tác vụ đang chạy. Luôn cho phép ÍT NHẤT một tác vụ toàn
    // ứng dụng đang chạy (this.active.size === 0) để tránh "đói" hoàn toàn khi máy có vẻ bận nhưng thực
    // ra Tubmedia chưa làm gì cả.
    const cpuTypeGated = ['download', 'clip', 'normalize', 'merge'].includes(job.type);
    if (cpuTypeGated && this.active.size > 0) {
      const throttled = this.loadGovernorFor(profile).sample(cpuPercent, Date.now());
      if (throttled) return false;
    }
    if (job.projectId) {
      for (const targetFolder of this.diskFoldersForJob(job)) {
        try {
          const fs = await statfs(targetFolder);
          const free = Number(fs.bavail) * Number(fs.bsize);
          if (free < profile.diskFreeMinimumBytes) {
            const message =
              `Ổ đĩa chứa ${targetFolder} không đủ dung lượng trống để bắt đầu tác vụ. ` +
              `Danh sách đã được tạm dừng để tránh tạo hàng loạt lỗi.`;
            this.repo.update(
              job.id,
              {
                status: 'paused',
                errorCode: 'DISK_FULL',
                errorMessage: message,
                finishedAt: null
              },
              this.pauseResumeInput(job)
            );
            await this.pauseProjectForBlockingError(job, 'DISK_FULL', message);
            this.notifyBlockingError('DISK_FULL', message, job);
            this.logger.warn('queue', 'DISK_FULL', message, { projectId: job.projectId, jobId: job.id });
            return false;
          }
        } catch (error) {
          const message =
            `Không thể kiểm tra thư mục ${targetFolder}: ${error instanceof Error ? error.message : String(error)}. ` +
            'Danh sách đã được tạm dừng để bạn sửa đường dẫn hoặc quyền truy cập.';
          this.repo.update(
            job.id,
            {
              status: 'paused',
              errorCode: 'PERMISSION_DENIED',
              errorMessage: message,
              finishedAt: null
            },
            this.pauseResumeInput(job)
          );
          await this.pauseProjectForBlockingError(job, 'PERMISSION_DENIED', message);
          this.notifyBlockingError('PERMISSION_DENIED', message, job);
          this.logger.warn('queue', 'PERMISSION_DENIED', message, {
            projectId: job.projectId,
            jobId: job.id
          });
          return false;
        }
      }
    }
    return true;
  }
  private async tick(): Promise<void> {
    if (this.paused || !this.canExecute()) return;
    if (await this.guardActiveDiskSpace()) return;
    let all = this.repo.list();
    if (await this.recoverDiskFullProjects(all)) all = this.repo.list();
    const cpuPercent = this.cpuPercent();
    // VẤN ĐỀ 2 mục 1 (2026-09-22): lấy mẫu bộ điều tiết CHO MỌI HỒ SƠ đang có tác vụ hoạt động, MỖI LƯỢT
    // tick — không chỉ khi có tác vụ đang CHỜ được xét (resourcesAllow). Nếu chỉ lấy mẫu lúc xét tác vụ
    // chờ, một hàng đợi có tác vụ chờ luôn bị chặn bởi giới hạn SỐ WORKER (không phải CPU) sẽ không bao
    // giờ chạm tới bộ điều tiết, khiến đồng hồ "đủ lâu" (sustainedMs) không bao giờ tích lũy được dù CPU
    // đã cao liên tục thật sự — nhịp tick đều đặn (350ms khi có việc đang chạy) mới là nguồn đếm giờ THẬT
    // đáng tin cậy, không phụ thuộc độ sâu hàng đợi.
    const nowForSampling = Date.now();
    const sampledProfileIds = new Set<string>();
    for (const activeJob of this.active.values()) {
      if (!['download', 'clip', 'normalize', 'merge'].includes(activeJob.job.type)) continue;
      const activeProfile = this.profileFor(activeJob.job);
      if (sampledProfileIds.has(activeProfile.id)) continue;
      sampledProfileIds.add(activeProfile.id);
      this.loadGovernorFor(activeProfile).sample(cpuPercent, nowForSampling);
    }
    const pending: QueueJob[] = [];
    let stateChanged = false;
    for (const job of all.filter((x) => x.status === 'pending')) {
      const dependency = this.dependencyState(job, all);
      if (dependency === 'failed') {
        this.repo.update(job.id, {
          status: 'failed',
          errorCode: 'DEPENDENCY_FAILED',
          errorMessage: 'Một tác vụ phụ thuộc đã thất bại, bị hủy hoặc không tồn tại.',
          finishedAt: new Date().toISOString()
        });
        stateChanged = true;
        continue;
      }
      if (dependency === 'ready') pending.push(job);
    }
    const grouped = new Map<string, QueueJob[]>();
    for (const job of pending) {
      const key = job.projectId ?? '__global__';
      const list = grouped.get(key) ?? [];
      list.push(job);
      grouped.set(key, list);
    }
    const fairPending: QueueJob[] = [];
    while ([...grouped.values()].some((jobs) => jobs.length > 0)) {
      for (const jobs of grouped.values()) {
        const next = jobs.shift();
        if (next) fairPending.push(next);
      }
    }
    for (const job of fairPending) {
      if (!this.schedulerRunning) break;
      if (this.active.has(job.id)) continue;
      const profile = this.profileFor(job);
      const activeOfType = [...this.active.values()].filter((x) => x.job.type === job.type).length;
      const activeOfProjectType = [...this.active.values()].filter(
        (x) => x.job.type === job.type && x.job.projectId === job.projectId
      ).length;
      if (job.type === 'download') {
        const lane = queueExecutionLane(job);
        if (lane === 'download-list') {
          if (!independentDownloadProjectCanStart(activeOfProjectType, profile)) continue;
        }
        if (lane === 'merge-workflow') {
          const activeInLane = [...this.active.values()].filter(
            (entry) => entry.job.type === 'download' && queueExecutionLane(entry.job) === lane
          ).length;
          const laneLimit = mergeSourceDownloadLimit(this.settings.get(), profile);
          if (activeOfProjectType >= profile.downloadWorkers || activeInLane >= laneLimit) continue;
        }
      } else if (job.type === 'merge') {
        const globalMergeLimit = Math.max(1, Math.min(4, this.settings.get().maxGlobalMergeJobs));
        if (activeOfProjectType >= 1 || activeOfType >= globalMergeLimit) continue;
      } else if (activeOfType >= this.limitFor(job.type, profile)) continue;
      if (job.sourceId && this.sourceLocks.has(job.sourceId)) continue;
      if (!(await this.resourcesAllow(job, profile, cpuPercent))) {
        if (this.repo.get(job.id)?.status !== 'pending') stateChanged = true;
        continue;
      }
      this.runJob(job, profile); // intentionally detached; state is retained in active map
    }
    if (stateChanged) this.emit();
  }
  private runJob(job: QueueJob, profile: ResourceProfile): void {
    const controller = new AbortController();
    const sourceLock = job.sourceId;
    if (sourceLock) this.sourceLocks.add(sourceLock);
    const promise = this.execute(job, profile, controller.signal)
      .catch((error: unknown) => this.handleExecutorCrash(job, error))
      .finally(() => {
        this.active.delete(job.id);
        this.progressUpdates.delete(job.id);
        if (sourceLock) this.sourceLocks.delete(sourceLock);
        try {
          if (job.projectId) this.syncProjectStatus(job.projectId);
          this.emit();
        } catch (error) {
          this.logger.error(
            'queue',
            'JOB_FINALIZE_FAILED',
            error instanceof Error ? error.message : String(error),
            { jobId: job.id, ...(job.projectId ? { projectId: job.projectId } : {}) }
          );
        }
      });
    this.active.set(job.id, { job, controller, promise, sourceLock });
  }

  /**
   * execute() đã tự phân loại mọi lỗi nghiệp vụ. Đây là lưới an toàn cho lỗi hạ tầng
   * (SQLite lỗi, tác vụ bị xóa giữa chừng...). Nếu không bắt ở đây, promise bị từ chối
   * không ai lắng nghe sẽ trở thành unhandled rejection trong main process, và tác vụ
   * có thể kẹt vĩnh viễn ở trạng thái đang chạy dù không còn worker nào xử lý.
   */
  private handleExecutorCrash(job: QueueJob, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('queue', 'JOB_EXECUTOR_CRASHED', message, {
      jobId: job.id,
      ...(job.projectId ? { projectId: job.projectId } : {})
    });
    try {
      const current = this.repo.get(job.id);
      if (
        current &&
        !TERMINAL_STATUSES.has(current.status) &&
        current.status !== 'paused' &&
        current.status !== 'interrupted'
      ) {
        this.emitProgress(
          this.repo.update(job.id, {
            status: 'failed',
            errorCode: 'UNHANDLED_ERROR',
            errorMessage: message,
            finishedAt: new Date().toISOString()
          })
        );
      }
    } catch {
      // Tác vụ đã bị xóa hoặc DB không ghi được; đã có nhật ký ở trên.
    }
  }

  /**
   * Chờ rồi đưa tác vụ đang 'retrying' về 'pending'. Khác với setTimeout thuần:
   * - thời gian chờ bị ngắt ngay khi tác vụ bị hủy hoặc ứng dụng đóng (trước đây
   *   việc đóng ứng dụng/xóa tác vụ có thể phải chờ tới ~75 giây);
   * - nếu người dùng đã tạm dừng tác vụ trong lúc chờ thì giữ nguyên trạng thái tạm
   *   dừng thay vì tự ý chạy lại;
   * - nếu bị hủy trong lúc chờ thì đánh dấu 'cancelled' thay vì để 'retrying' vĩnh viễn.
   */
  private async requeueAfterDelay(
    jobId: string,
    signal: AbortSignal,
    delayMs: number,
    patch: { errorCode?: string | null; errorMessage?: string | null },
    inputPatch: Record<string, unknown>
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const current = this.repo.get(jobId);
    if (!current) return;
    if (signal.aborted) {
      // Đóng ứng dụng kiểu "giữ lại" đã đặt 'interrupted' từ trước; chỉ xử lý khi còn 'retrying'.
      if (current.status === 'retrying') {
        this.emitProgress(
          this.repo.update(jobId, {
            status: 'cancelled',
            errorCode: 'PROCESS_CANCELLED',
            errorMessage: 'Tác vụ đã bị hủy.',
            finishedAt: new Date().toISOString()
          })
        );
      }
      return;
    }
    // Nếu người dùng bấm Tiếp tục ngay trong lúc chờ, resumeActiveJobState có thể đã đặt
    // một trạng thái "đang chạy" dù chưa có tiến trình nào. Đưa về 'retrying' để hợp lệ hóa.
    if (RUNNING_STATUSES.has(current.status)) {
      this.repo.update(jobId, { status: 'retrying' });
    } else if (current.status !== 'retrying') {
      return;
    }
    this.repo.update(jobId, { status: 'pending', ...patch }, inputPatch);
  }

  private syncProjectStatus(projectId: string): void {
    const jobs = this.repo.list(projectId);
    if (!jobs.length) return;
    if (
      jobs.some((job) =>
        [
          'analyzing',
          'downloading',
          'verifying',
          'normalizing',
          'processing',
          'merging',
          'retrying',
          'pending'
        ].includes(job.status)
      )
    ) {
      this.projects.setStatus(projectId, 'active');
      return;
    }
    if (jobs.some((job) => job.status === 'paused' || job.status === 'interrupted')) {
      this.projects.setStatus(projectId, 'paused');
      return;
    }
    if (jobs.some((job) => job.status === 'failed')) {
      this.projects.setStatus(projectId, 'error');
      void this.cleanupProjectTemporaryArtifacts(projectId, true);
      return;
    }
    if (jobs.every((job) => ['completed', 'skipped', 'cancelled'].includes(job.status))) {
      const cancelled = jobs.some((job) => job.status === 'cancelled');
      this.projects.setStatus(projectId, cancelled ? 'paused' : 'completed');
      void this.cleanupProjectTemporaryArtifacts(projectId);
    }
  }

  private async cleanupProjectTemporaryArtifacts(
    projectId: string,
    preserveTrackedClips = false
  ): Promise<void> {
    if (this.cleanupInProgress.has(projectId)) return;
    const project = this.projects.get(projectId);
    if (!project) return;
    this.cleanupInProgress.add(projectId);
    try {
      const items = this.items.list(projectId);
      const trackedClips = items
        .map((item) => item.clipFile)
        .filter((path): path is string => typeof path === 'string' && path.length > 0);
      const reports = await Promise.all([
        cleanupTemporaryArtifacts(project.tempFolder, trackedClips, preserveTrackedClips),
        cleanupTemporaryArtifacts(join(project.outputFolder, '_normalized')),
        cleanupTemporaryArtifacts(join(project.outputFolder, '_quarantine'))
      ]);
      const report = reports.reduce(
        (total, current) => ({
          removedFiles: total.removedFiles + current.removedFiles,
          removedDirectories: total.removedDirectories + current.removedDirectories,
          skippedUnsafePaths: total.skippedUnsafePaths + current.skippedUnsafePaths
        }),
        { removedFiles: 0, removedDirectories: 0, skippedUnsafePaths: 0 }
      );
      if (!preserveTrackedClips) {
        for (const item of items) {
          if (item.clipFile) this.items.setClipFile(item.id, null);
        }
      }
      this.logger.info(
        'cleanup',
        'TEMPORARY_ARTIFACTS_CLEANED',
        preserveTrackedClips
          ? `Đã dọn ${report.removedFiles} tệp và ${report.removedDirectories} thư mục lỗi/tạm; các đoạn cắt hợp lệ được giữ để người dùng thử lại nhanh.`
          : `Đã tự dọn ${report.removedFiles} tệp và ${report.removedDirectories} thư mục tạm/quarantine sau khi quy trình dừng hoặc hoàn tất.`,
        {
          projectId,
          metadata: { ...report }
        }
      );
    } catch (error) {
      this.logger.warn(
        'cleanup',
        'TEMPORARY_ARTIFACTS_CLEANUP_WARNING',
        `Không thể dọn hết tệp tạm; thành phẩm vẫn an toàn. ${error instanceof Error ? error.message : String(error)}`,
        { projectId }
      );
    } finally {
      this.cleanupInProgress.delete(projectId);
    }
  }

  private updateProgress(
    jobId: string,
    progress: number,
    speed: string | null = null,
    etaSeconds: number | null = null,
    status?: QueueJob['status'],
    force = false,
    details?: Record<string, unknown>
  ): void {
    const current = this.repo.get(jobId);
    if (!current) return;
    const safeProgress = sanitizeProgress(progress, current.progress);
    const safeEtaSeconds = sanitizeNullableSeconds(etaSeconds, current.etaSeconds);
    const nextStatus = status ?? current.status;
    const previous = this.progressUpdates.get(jobId);
    const now = Date.now();
    const refreshMs = Math.max(120, Math.min(2_000, this.settings.get().progressRefreshMs));
    const stage = typeof details?.progressStage === 'string' ? details.progressStage : undefined;
    if (
      !force &&
      safeProgress < 100 &&
      previous?.status === nextStatus &&
      previous.stage === stage &&
      now - previous.at < refreshMs
    ) {
      return;
    }
    this.progressUpdates.set(jobId, {
      at: now,
      status: nextStatus,
      ...(stage ? { stage } : {})
    });
    const inputDetails = {
      ...(details ?? {}),
      progressPhases: progressPhases(current, nextStatus, stage, safeProgress)
    };
    const next = this.repo.update(
      jobId,
      {
        progress: safeProgress,
        speed,
        etaSeconds: safeEtaSeconds,
        ...(status ? { status } : {})
      },
      inputDetails
    );
    this.emitProgress(next);
  }

  private updateDownloadProgress(jobId: string, progress: DownloadProgress): void {
    const current = this.repo.get(jobId);
    const displayNameChanged = Boolean(
      progress.displayName && current?.input.displayName !== progress.displayName
    );
    if (displayNameChanged && progress.displayName) {
      this.repo.updateInput(jobId, { displayName: progress.displayName });
    }
    const status =
      progress.stage === 'analyzing'
        ? 'analyzing'
        : progress.stage === 'verifying'
          ? 'verifying'
          : progress.stage === 'processing'
            ? 'processing'
            : 'downloading';
    this.updateProgress(
      jobId,
      progress.percent,
      progress.speed,
      progress.etaSeconds,
      status,
      displayNameChanged,
      {
        progressStage:
          progress.stageLabel ??
          (progress.stage === 'analyzing'
            ? 'Đang phân tích nguồn'
            : progress.stage === 'downloading'
              ? 'Đang tải video'
              : progress.stage === 'verifying'
                ? 'Đang kiểm tra tệp'
                : progress.stage === 'processing'
                  ? 'Đang xử lý video'
                  : ''),
        ...(progress.elapsedSeconds !== undefined ? { progressElapsedSeconds: progress.elapsedSeconds } : {})
      }
    );
  }
  private async pauseProjectForBlockingError(job: QueueJob, code: string, message: string): Promise<void> {
    if (!job.projectId) return;

    for (const active of this.active.values()) {
      if (active.job.id === job.id || active.job.projectId !== job.projectId) continue;
      try {
        await this.processes.pauseByJob(active.job.id);
        const current = this.repo.get(active.job.id);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          this.repo.update(
            active.job.id,
            {
              status: 'paused',
              errorCode: code,
              errorMessage: message,
              speed: null,
              etaSeconds: null
            },
            this.pauseResumeInput(current)
          );
        }
      } catch (error) {
        const current = this.repo.get(active.job.id);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          // Với lỗi chặn như hết dung lượng/quyền ghi, tiếp tục ghi file nguy hiểm
          // hơn hủy tác vụ. Abort để executor kết thúc và reconcile cancelled.
          active.controller.abort();
          this.logger.error(
            'queue',
            'BACKGROUND_PAUSE_FAILED_ABORTED',
            `Không thể xác nhận tạm dừng nên Tubmedia đã hủy tác vụ để bảo vệ dữ liệu: ${error instanceof Error ? error.message : String(error)}`,
            {
              jobId: active.job.id,
              ...(active.job.projectId ? { projectId: active.job.projectId } : {})
            }
          );
        }
      }
    }

    for (const queued of this.repo.list(job.projectId)) {
      if (queued.id === job.id) continue;
      if (queued.status === 'pending' || queued.status === 'retrying') {
        this.repo.update(
          queued.id,
          {
            status: 'paused',
            errorCode: code,
            errorMessage: message,
            speed: null,
            etaSeconds: null
          },
          this.pauseResumeInput(queued)
        );
      }
    }
    this.projects.setStatus(job.projectId, 'paused');
  }

  private async openCircuitAfterRepeatedFailure(job: QueueJob, message: string): Promise<boolean> {
    if (!job.projectId) return false;
    const now = Date.now();
    const windowMs = 2 * 60 * 1000;
    const recent = (this.repeatedFailures.get(job.projectId) ?? []).filter(
      (timestamp) => now - timestamp <= windowMs
    );
    recent.push(now);
    this.repeatedFailures.set(job.projectId, recent);
    if (recent.length < 3) return false;

    const circuitMessage =
      `Ba video liên tiếp không thể tải do mạng hoặc máy chủ phân phối sau khi đã tự thử lại. Danh sách được tạm dừng để tránh tạo hàng loạt lỗi. ` +
      `Kiểm tra mạng, máy chủ trung gian, cookies hoặc trạng thái nền tảng rồi nhấn Tiếp tục. Lỗi gần nhất: ${message}`;
    await this.pauseProjectForBlockingError(job, 'NETWORK_CIRCUIT_OPEN', circuitMessage);
    this.notifyBlockingError('NETWORK_CIRCUIT_OPEN', circuitMessage, job);
    this.logger.warn('queue', 'NETWORK_CIRCUIT_OPEN', circuitMessage, {
      projectId: job.projectId,
      jobId: job.id,
      metadata: { failuresInWindow: recent.length, windowMs }
    });
    return true;
  }

  private clearBlockingNoticeKeys(projectId?: string | null): void {
    if (!projectId) return;
    for (const key of this.blockingNoticeKeys) {
      if (key.startsWith(`${projectId}:`)) this.blockingNoticeKeys.delete(key);
    }
  }

  private notifyBlockingError(code: string, message: string, job?: QueueJob): void {
    const scope = job?.projectId ?? job?.id ?? 'global';
    const noticeKey = `${scope}:${code}`;
    if (this.blockingNoticeKeys.has(noticeKey)) return;
    this.blockingNoticeKeys.add(noticeKey);
    const title =
      code === 'COOKIES_EXPIRED'
        ? 'Cookies đã hết hạn hoặc không còn hợp lệ'
        : code === 'AUTHENTICATION_REQUIRED' || code === 'BROWSER_COOKIE_DATABASE_LOCKED'
          ? 'Cần xác thực để tiếp tục tải'
          : code === 'DISK_FULL'
            ? 'Ổ đĩa không đủ dung lượng'
            : code === 'PERMISSION_DENIED'
              ? 'Không truy cập được thư mục'
              : code === 'SOURCE_RATE_LIMITED'
                ? 'Nguồn đang giới hạn yêu cầu'
                : code === 'NETWORK_CIRCUIT_OPEN'
                  ? 'Danh sách đã tạm dừng vì mạng không ổn định'
                  : 'Công cụ tải video chưa sẵn sàng';
    const steps =
      code === 'COOKIES_EXPIRED'
        ? [
            'Đăng nhập lại vào tài khoản có quyền xem video.',
            'Xuất hoặc dán cookies mới trong đúng danh sách.',
            'Sau khi lưu, ứng dụng tự tiếp tục các video đang bị chặn.'
          ]
        : code === 'AUTHENTICATION_REQUIRED' || code === 'BROWSER_COOKIE_DATABASE_LOCKED'
          ? [
              'Mở mục Cookies trong chính danh sách này.',
              'Chọn trình duyệt, dán cookies hoặc chọn tệp cookies.txt.',
              'Sau khi lưu, video bị chặn sẽ tự quay lại hàng đợi.'
            ]
          : code === 'DISK_FULL'
            ? ['Giải phóng dung lượng hoặc đổi thư mục lưu.', 'Nhấn Tiếp tục sau khi đã sửa.']
            : code === 'PERMISSION_DENIED'
              ? ['Chọn thư mục khác có quyền ghi.', 'Không chạy ứng dụng bằng thư mục bị Windows bảo vệ.']
              : code === 'SOURCE_RATE_LIMITED'
                ? [
                    'Không nhấn thử lại liên tục; hãy chờ để nền tảng gỡ giới hạn.',
                    'Mở video trong trình duyệt bình thường và hoàn tất xác minh nếu được yêu cầu.',
                    'Nếu phiên đăng nhập thay đổi, cập nhật cookies trong chính danh sách rồi nhấn Tiếp tục.'
                  ]
                : code === 'NETWORK_CIRCUIT_OPEN'
                  ? [
                      'Kiểm tra mạng, máy chủ trung gian hoặc cookies.',
                      'Nhấn Tiếp tục để thử lại đúng danh sách.'
                    ]
                  : ['Mở mục Công cụ.', 'Chọn Kiểm tra lại hoặc Sửa chữa tất cả.'];
    const notice: AttentionNotice = {
      id: `blocking-${scope}-${code}`,
      // Mức lấy từ bảng mức theo mã lỗi (notice-tone.ts): hết dung lượng và không có quyền ghi là LỖI
      // (không tự tắt), giới hạn tốc độ / mạng không ổn định / cần đăng nhập là CẢNH BÁO cần hành động.
      severity: toneForErrorCode(code),
      title,
      message,
      code,
      steps,
      sticky: true,
      ...(job?.projectId ? { projectId: job.projectId } : {}),
      ...(job && code !== 'NETWORK_CIRCUIT_OPEN' ? { jobId: job.id } : {})
    };
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC.events.attention, notice);
      if (!this.window.isVisible()) this.window.show();
      if (this.window.isMinimized()) this.window.restore();
      this.window.flashFrame(true);
      this.window.focus();
    }
  }
  private notifyJobFailure(
    code: string,
    message: string,
    job: QueueJob,
    recoverableExternalFailure = false
  ): void {
    if (!this.window || this.window.isDestroyed()) return;
    const scope = job.projectId ?? job.id;
    const notice: AttentionNotice = {
      id: `job-failure-${scope}-${code}`,
      severity: recoverableExternalFailure ? 'warning' : 'error',
      title:
        recoverableExternalFailure && job.type === 'download'
          ? 'Video chưa tải được sau nhiều lần thử'
          : job.type === 'merge'
            ? 'Ghép video gặp sự cố'
            : job.type === 'download'
              ? 'Không thể tải video'
              : `Tác vụ ${JOB_TYPE_TEXT[job.type]} gặp sự cố`,
      message,
      code,
      steps: recoverableExternalFailure
        ? [
            'Không xóa tệp .part; Tubmedia sẽ dùng lại phần đã tải khi thử lại.',
            'Chờ mạng hoặc máy chủ nguồn ổn định rồi chọn Thử lại đúng video.',
            'Nếu nhiều video cùng lỗi, kiểm tra cookies/proxy rồi nhấn Tiếp tục cho danh sách.'
          ]
        : [
            'Xem đúng dòng tác vụ trong trang Tiến trình.',
            'Mở nhật ký riêng để xem chi tiết nếu lỗi lặp lại.',
            'Sửa nguyên nhân rồi chọn Thử lại đúng tác vụ.'
          ],
      sticky: false,
      ...(job.projectId ? { projectId: job.projectId } : {}),
      jobId: job.id
    };
    this.window.webContents.send(IPC.events.attention, notice);
  }
  private async execute(job: QueueJob, profile: ResourceProfile, signal: AbortSignal): Promise<void> {
    const started = this.repo.update(job.id, {
      status: initialJobStatus(job.type),
      attempts: job.attempts + 1,
      startedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null
    });
    this.emitProgress(started);
    this.logger.info('queue', 'JOB_STARTED', `Bắt đầu tác vụ ${JOB_TYPE_TEXT[job.type]}.`, {
      jobId: job.id,
      ...(job.projectId ? { projectId: job.projectId } : {}),
      metadata: { attempt: job.attempts + 1, maxAttempts: job.maxAttempts }
    });
    let completionStatus: QueueJob['status'] = 'completed';
    try {
      switch (job.type) {
        case 'download': {
          /* TUBMEDIA_R34_QUEUE_YOUTUBE_VALIDATION */
          const malformedYouTubeMessage = malformedYouTubeVideoUrlMessage(job.input.url);
          if (malformedYouTubeMessage) {
            throw new InvalidInputError(malformedYouTubeMessage);
          }
          const result = await this.downloader.run(job, profile, signal, (progress) =>
            this.updateDownloadProgress(job.id, progress)
          );
          completionStatus = result.skipped ? 'skipped' : 'completed';
          const source = job.sourceId ? this.sources.get(job.sourceId) : null;
          this.repo.updateInput(job.id, {
            outputPath: result.outputPath,
            displayName: source?.title ?? job.input.displayName ?? job.input.url ?? 'Video đã tải',
            resultMessage: result.resultMessage,
            reusedExistingFile: result.skipped,
            cookieFailureConfirmed: false,
            cookieRetryRequested: false,
            resumeStatus: null
          });
          break;
        }
        case 'clip':
          await this.runClip(job, profile, signal);
          break;
        case 'merge':
          completionStatus = (await this.runMerge(job, profile, signal)) ? 'skipped' : 'completed';
          break;
        case 'analyze':
        case 'normalize':
        case 'verify':
          throw new ProcessingFailedError(
            `Loại tác vụ ${job.type} chưa có executor độc lập và không được phép hoàn tất giả.`
          );
      }
      const beforeDone = this.repo.get(job.id) ?? job;
      /* TUBMEDIA STABLE COMPLETION CONTRACT HOTFIX12R7 */
      const finalStage = completionStatus === 'skipped' ? 'Đã tải trước đó' : 'Đã hoàn tất';
      const synchronizedFinalStage =
        job.type === 'merge' && job.input.timelineOnly === true
          ? 'Timeline đã sẵn sàng'
          : job.type === 'merge' && beforeDone.input.mergeRecoveryMode === 'verified-final'
            ? 'Thành phẩm cũ hợp lệ · đã bỏ qua ghép'
            : job.type === 'merge' && beforeDone.input.mergeRecoveryMode === 'verified-checkpoint'
              ? 'Đã tiếp tục từ checkpoint hợp lệ'
              : finalStage;
      this.repo.updateInput(job.id, {
        progressStage: synchronizedFinalStage,
        progressPhases: progressPhases(beforeDone, completionStatus, synchronizedFinalStage, 100),
        progressElapsedSeconds:
          typeof beforeDone.input.progressElapsedSeconds === 'number'
            ? beforeDone.input.progressElapsedSeconds
            : undefined
      });
      const done = this.repo.update(job.id, {
        status: completionStatus,
        progress: 100,
        finishedAt: new Date().toISOString(),
        speed: null,
        etaSeconds: 0
      });
      if (job.type === 'download' && job.projectId) {
        this.repeatedFailures.delete(job.projectId);
      }
      this.emitProgress(done);
      this.logger.info(
        'queue',
        job.type === 'merge' && beforeDone.input.mergeRecoveryMode === 'verified-final'
          ? 'MERGE_REUSED_VERIFIED_OUTPUT'
          : job.type === 'merge' && beforeDone.input.mergeRecoveryMode === 'verified-checkpoint'
            ? 'MERGE_RESUMED_VERIFIED_CHECKPOINT'
            : completionStatus === 'skipped'
              ? 'JOB_SKIPPED_EXISTING'
              : 'JOB_COMPLETED',
        completionStatus === 'skipped'
          ? job.type === 'merge'
            ? synchronizedFinalStage
            : 'Video đã tải trước đó, đã kiểm tra hợp lệ và bỏ qua tải lại.'
          : `Hoàn tất tác vụ ${JOB_TYPE_TEXT[job.type]}.`,
        {
          jobId: job.id,
          ...(job.projectId ? { projectId: job.projectId } : {})
        }
      );
    } catch (error) {
      if (signal.aborted) {
        const current = this.repo.get(job.id);
        if (current?.status === 'interrupted' || current?.status === 'paused') {
          this.emitProgress(current);
          return;
        }
        const cancelled = this.repo.update(job.id, {
          status: 'cancelled',
          errorCode: 'PROCESS_CANCELLED',
          errorMessage: 'Tác vụ đã bị hủy.',
          finishedAt: new Date().toISOString()
        });
        this.emitProgress(cancelled);
        return;
      }
      const appError = error as Partial<AppError>;
      const code = appError.code ?? 'UNHANDLED_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      if (code === 'RETRY_WITH_CONFIGURED_COOKIES') {
        const retrying = this.repo.update(job.id, {
          status: 'retrying',
          errorCode: code,
          errorMessage: message,
          speed: null,
          etaSeconds: null
        });
        this.emitProgress(retrying);
        this.logger.info(
          'queue',
          'COOKIE_RETRY_SCHEDULED',
          'Video yêu cầu xác thực; sẽ thử lại kín đáo bằng cookies đã cấu hình.',
          {
            jobId: job.id,
            ...(job.projectId ? { projectId: job.projectId } : {})
          }
        );
        await this.requeueAfterDelay(
          job.id,
          signal,
          350,
          { errorCode: null, errorMessage: null },
          {
            resumeStatus: null,
            cookieFailureConfirmed: true,
            cookieRetryRequested: true,
            progressStage: 'Đang thử lại bằng cookies đã cấu hình'
          }
        );
        return;
      }
      if (
        code === 'AUTHENTICATION_REQUIRED' ||
        code === 'COOKIES_EXPIRED' ||
        code === 'BROWSER_COOKIE_DATABASE_LOCKED' ||
        code === 'TOOL_NOT_FOUND' ||
        code === 'TOOL_HEALTH_CHECK_FAILED' ||
        code === 'DISK_FULL' ||
        code === 'PERMISSION_DENIED' ||
        code === 'SOURCE_RATE_LIMITED'
      ) {
        if (job.type === 'download' && job.projectId) {
          this.repeatedFailures.delete(job.projectId);
        }
        const cookieBlocking = isCookieBlockingCode(code);
        const paused = this.repo.update(
          job.id,
          {
            status: 'paused',
            attempts: job.attempts,
            errorCode: code,
            errorMessage: message,
            finishedAt: null,
            speed: null,
            etaSeconds: null
          },
          this.pauseResumeInput(
            job,
            cookieBlocking
              ? {
                  cookieFailureConfirmed: true,
                  cookieRetryRequested: true
                }
              : {}
          )
        );
        if (!cookieBlocking) await this.pauseProjectForBlockingError(job, code, message);
        this.emitProgress(paused);
        this.notifyBlockingError(code, message, job);
        this.logger.warn('queue', code, message, {
          jobId: job.id,
          ...(job.projectId ? { projectId: job.projectId } : {})
        });
        return;
      }
      if (code === 'SOURCE_REMOVED') {
        if (job.type === 'download' && job.projectId) {
          this.repeatedFailures.delete(job.projectId);
        }
        this.repo.updateInput(job.id, {
          progressStage: 'Video đã bị xóa khỏi YouTube',
          resultMessage: message,
          sourceRemoved: true,
          resumeStatus: null
        });
        const skipped = this.repo.update(job.id, {
          status: 'skipped',
          progress: 100,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date().toISOString(),
          speed: null,
          etaSeconds: 0
        });
        this.emitProgress(skipped);
        this.logger.warn('queue', 'JOB_SKIPPED_SOURCE_REMOVED', message, {
          jobId: job.id,
          ...(job.projectId ? { projectId: job.projectId } : {}),
          metadata: {
            sourceRemoved: true,
            originalErrorCode: code
          }
        });

        if (job.projectId) {
          const projectJobs = this.repo.list(job.projectId);
          const blocked = new Set<string>([job.id]);
          let discovered = true;

          while (discovered) {
            discovered = false;
            for (const dependent of projectJobs) {
              if (blocked.has(dependent.id)) continue;
              if (['completed', 'skipped', 'cancelled', 'failed'].includes(dependent.status)) continue;

              const dependsOn = Array.isArray(dependent.input.dependsOn)
                ? dependent.input.dependsOn.filter((value): value is string => typeof value === 'string')
                : [];

              if (!dependsOn.some((id) => blocked.has(id))) continue;

              this.repo.updateInput(dependent.id, {
                progressStage: 'Bỏ qua vì video nguồn đã bị xóa',
                resultMessage:
                  'Không thể tiếp tục xử lý tác vụ này vì một video nguồn đã bị xóa khỏi YouTube.',
                sourceRemovedDependency: true,
                resumeStatus: null
              });
              const dependentSkipped = this.repo.update(dependent.id, {
                status: 'skipped',
                progress: 100,
                errorCode: null,
                errorMessage: null,
                finishedAt: new Date().toISOString(),
                speed: null,
                etaSeconds: 0
              });
              blocked.add(dependent.id);
              discovered = true;
              this.emitProgress(dependentSkipped);
              this.logger.warn(
                'queue',
                'JOB_SKIPPED_SOURCE_REMOVED_DEPENDENCY',
                'Bỏ qua tác vụ phụ thuộc vì video nguồn đã bị xóa khỏi YouTube.',
                {
                  jobId: dependent.id,
                  projectId: job.projectId,
                  metadata: { removedSourceJobId: job.id }
                }
              );
            }
          }
        }

        return;
      }

      const retryable = appError.retryable === true && job.attempts + 1 < job.maxAttempts;
      if (retryable) {
        const retrying = this.repo.update(job.id, {
          status: 'retrying',
          errorCode: appError.code ?? 'RETRYABLE_ERROR',
          errorMessage: message
        });
        this.emitProgress(retrying);
        this.logger.info('queue', 'JOB_RETRY_SCHEDULED', `Tác vụ sẽ thử lại: ${message}`, {
          jobId: job.id,
          ...(job.projectId ? { projectId: job.projectId } : {}),
          metadata: { nextAttempt: job.attempts + 2, maxAttempts: job.maxAttempts }
        });
        await this.requeueAfterDelay(job.id, signal, retryDelayMs(job.attempts + 1), {}, { resumeStatus: null });
      } else {
        const circuitEligible = isCircuitEligibleDownloadFailure(job.type, appError);
        const finalMessage = circuitEligible
          ? exhaustedDownloadFailureMessage(message, appError.details, job.attempts + 1)
          : message;
        const failed = this.repo.update(job.id, {
          status: 'failed',
          errorCode: code,
          errorMessage: finalMessage,
          finishedAt: new Date().toISOString()
        });
        this.emitProgress(failed);
        this.logger.error('queue', 'JOB_FAILED', failed.errorMessage ?? 'Tác vụ thất bại.', {
          jobId: job.id,
          ...(job.projectId ? { projectId: job.projectId } : {}),
          metadata: {
            errorCode: code,
            errorName: error instanceof Error ? error.name : typeof error,
            details: appError.details ?? null,
            jobType: job.type,
            attempt: job.attempts + 1,
            maxAttempts: job.maxAttempts,
            input: job.input
          }
        });
        if (circuitEligible) {
          const circuitOpened = await this.openCircuitAfterRepeatedFailure(job, finalMessage);
          if (!circuitOpened) this.notifyJobFailure(code, finalMessage, job, true);
        } else {
          if (job.type === 'download' && job.projectId) {
            this.repeatedFailures.delete(job.projectId);
          }
          this.notifyJobFailure(code, finalMessage, job);
        }
      }
    }
  }
  private async runClip(job: QueueJob, profile: ResourceProfile, signal: AbortSignal): Promise<void> {
    if (!job.itemId || !job.sourceId || !job.projectId) throw new Error('Tác vụ cắt đoạn thiếu dữ liệu.');
    const item = this.items.get(job.itemId);
    const source = this.sources.get(job.sourceId);
    const project = this.projects.get(job.projectId);
    if (!item || !source?.sourceFile || !project)
      throw new Error('Không tìm thấy mục video, nguồn hoặc dự án cho tác vụ cắt đoạn.');
    const path = await this.clips.create(
      job,
      item,
      source.sourceFile,
      project.tempFolder,
      profile,
      signal,
      (p) => this.updateProgress(job.id, p)
    );
    this.items.setClipFile(item.id, path);
  }
  private async runMerge(job: QueueJob, profile: ResourceProfile, signal: AbortSignal): Promise<boolean> {
    if (!job.projectId) throw new Error('Tác vụ ghép thiếu thông tin dự án.');
    const project = this.projects.get(job.projectId);
    if (!project) throw new Error('Dự án không tồn tại.');
    const allItems = this.items.list(project.id).filter((x) => x.enabled && x.validity !== 'invalid');
    const timelineOnly = job.input.timelineOnly === true;
    const inputs = allItems.map((item) => {
      const source = item.sourceId ? this.sources.get(item.sourceId) : null;
      const path = timelineOnly ? source?.sourceFile : (item.clipFile ?? source?.sourceFile);
      if (!path) throw new Error(`Video vị trí ${item.position} chưa sẵn sàng.`);
      return {
        path,
        label: source?.title ?? `Video_${String(item.position).padStart(3, '0')}`,
        note: item.note,
        sourcePath: source?.sourceFile ?? path,
        sourceStartSeconds: item.timestampStartSeconds,
        sourceEndSeconds: item.timestampEndSeconds,
        sourceAudioMode: item.audioMode,
        recoveryIdentity: JSON.stringify([
          item.normalizedUrl,
          item.timestampStartSeconds,
          item.timestampEndSeconds,
          item.audioMode
        ])
      };
    });
    /* TUBMEDIA TIMELINE ONLY QUEUE HOTFIX12 */
    /* TUBMEDIA LEGAL TIMELINE QUEUE STATE HOTFIX12R8 */
    if (timelineOnly) {
      const timeline = await this.merger.createTimelineOnly(job, inputs, profile, signal, (progress) =>
        this.updateProgress(job.id, progress.percent, progress.speed, progress.etaSeconds, 'merging', false, {
          progressStage: progress.stage,
          progressElapsedSeconds: progress.elapsedSeconds,
          progressProcessedSeconds: progress.processedSeconds,
          progressTotalSeconds: progress.totalSeconds,
          progressCurrentItem: progress.currentItem,
          progressItemCount: progress.itemCount
        })
      );
      this.repo.updateInput(job.id, {
        timelineOnly: true,
        productName: project.finalFileName,
        outputPath: null,
        timelineTxt: null,
        exportTimelineTxt: false,
        resultMessage: 'Timeline đã sẵn sàng. Không có video thành phẩm nào được tạo.',
        timelineItemCount: timeline.itemCount,
        totalDuration: timeline.totalDuration,
        timelineRows: timeline.rows
      });
      this.logger.info(
        'merge',
        'TIMELINE_ONLY_READY',
        'Đã tính xong timeline chính xác từ video nguồn; không chạy ghép và không tạo MP4.',
        {
          jobId: job.id,
          projectId: project.id,
          metadata: { itemCount: timeline.itemCount, totalDuration: timeline.totalDuration }
        }
      );
      this.projects.setStatus(project.id, 'completed');
      return false;
    }
    const quality =
      this.settings.profiles().qualities.find((x) => x.id === project.qualityProfileId) ??
      this.settings.profiles().qualities[0]!;
    let previousStage = '';
    let previousBucket = -1;
    const exportTimelineTxt = project.exportTimelineTxt;
    const trustedOutputPath =
      typeof job.input.trustedOutputPath === 'string' ? job.input.trustedOutputPath : null;
    const legacyPendingPaths = Array.isArray(job.input.legacyPendingPaths)
      ? job.input.legacyPendingPaths.filter((value): value is string => typeof value === 'string')
      : [];
    const result = await this.merger.merge(
      job,
      inputs,
      project.outputFolder,
      project.tempFolder,
      project.quarantineFolder,
      project.finalFileName,
      quality,
      profile,
      signal,
      exportTimelineTxt,
      (progress) => {
        this.updateProgress(job.id, progress.percent, progress.speed, progress.etaSeconds, 'merging', false, {
          progressStage: progress.stage,
          progressElapsedSeconds: progress.elapsedSeconds,
          progressProcessedSeconds: progress.processedSeconds,
          progressTotalSeconds: progress.totalSeconds,
          progressCurrentItem: progress.currentItem,
          progressItemCount: progress.itemCount
        });
        const bucket = Math.floor(progress.percent / 10);
        if (progress.stage !== previousStage || bucket !== previousBucket) {
          previousStage = progress.stage;
          previousBucket = bucket;
          this.logger.debug('merge', 'MERGE_PROGRESS', progress.stage, {
            jobId: job.id,
            projectId: project.id,
            metadata: {
              progress: progress.percent,
              speed: progress.speed,
              etaSeconds: progress.etaSeconds,
              elapsedSeconds: progress.elapsedSeconds
            }
          });
        }
      },
      { trustedOutputPath, legacyPendingPaths }
    );
    // Giai đoạn 6 mục 4 (2026-09-24) — Preset xuất theo nền tảng: bước RIÊNG, chạy SAU khi merge() đã
    // commit xong thành phẩm gốc như cũ (không đụng tới merge()/checkpoint/recovery). Tệp gốc vẫn còn
    // nguyên trên đĩa; thành phẩm đã đổi tỉ lệ là tệp MỚI và trở thành outputPath chính của tác vụ vì đó
    // mới là thứ người dùng đã chọn xuất ra.
    let finalVideoPath = result.video;
    if (project.aspectRatio !== 'original') {
      finalVideoPath = await this.merger.applyAspectRatio(
        job.id,
        result.video,
        project.aspectRatio,
        project.outputFolder,
        project.finalFileName,
        signal,
        (progress) => {
          this.updateProgress(job.id, progress.percent, progress.speed, progress.etaSeconds, 'merging', false, {
            progressStage: 'Đang đổi tỉ lệ khung hình (nền mờ kiểu CapCut)',
            progressProcessedSeconds: progress.processedSeconds,
            progressTotalSeconds: progress.totalSeconds
          });
        }
      );
    }
    this.repo.updateInput(job.id, {
      productName: project.finalFileName,
      outputPath: finalVideoPath,
      mergeRecoveryMode: result.recoveryMode,
      reusedExistingOutput: result.reusedExisting,
      resultMessage:
        result.recoveryMode === 'verified-final'
          ? 'Thành phẩm hiện có đã được hậu kiểm đầy đủ và dùng lại; không ghép thêm video.'
          : result.recoveryMode === 'verified-checkpoint'
            ? 'Checkpoint hoàn chỉnh đã được xác minh; quy trình tiếp tục từ bước xuất cuối.'
            : 'Đã ghép mới và hậu kiểm thành phẩm đầy đủ.',
      timelineTxt: result.timeline.txt,
      exportTimelineTxt,
      mergeWarnings: result.warnings,
      mergeVisualBoundaryTransitions: result.visualBoundaryTransitions,
      timelineItemCount: result.timeline.itemCount,
      totalDuration: result.timeline.totalDuration,
      timelineRows: result.timeline.rows
    });
    /* TUBMEDIA VISUAL BOUNDARY UX HOTFIX11 */
    for (const warning of result.warnings) {
      this.logger.warn('merge', 'MERGE_COMPLETED_WITH_WARNING', warning, {
        jobId: job.id,
        projectId: project.id,
        metadata: { visualBoundaryTransitions: result.visualBoundaryTransitions }
      });
    }
    if (result.recoveryMode === 'verified-final') {
      this.logger.info(
        'merge',
        'MERGE_REUSED_VERIFIED_OUTPUT',
        'Thành phẩm hiện có đã vượt qua hậu kiểm đầy đủ; Tubmedia bỏ qua ghép lại.',
        { jobId: job.id, projectId: project.id, metadata: { outputPath: result.video } }
      );
    } else if (result.recoveryMode === 'verified-checkpoint') {
      this.logger.info(
        'merge',
        'MERGE_RESUMED_VERIFIED_CHECKPOINT',
        'Checkpoint ghép hoàn chỉnh đã được xác minh; Tubmedia tiếp tục từ bước xuất cuối.',
        { jobId: job.id, projectId: project.id, metadata: { outputPath: result.video } }
      );
    }
    this.projects.setStatus(project.id, 'completed');
    return result.recoveryMode === 'verified-final';
  }
  public enqueueDownloads(projectId: string): QueueJob[] {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Danh sách tải không tồn tại.');
    const items = this.items
      .list(projectId)
      .filter((x) => x.enabled && x.validity !== 'invalid' && x.sourceId);
    if (!items.length) throw new Error('Danh sách chưa có liên kết hợp lệ.');
    this.projects.setStatus(projectId, 'active');
    const downloadBySource = new Map<string, QueueJob>();
    for (const item of items) {
      if (!item.sourceId || downloadBySource.has(item.sourceId)) continue;
      const source = this.sources.get(item.sourceId);
      downloadBySource.set(
        item.sourceId,
        this.repo.create({
          projectId,
          type: 'download',
          sourceId: item.sourceId,
          input: {
            url: item.normalizedUrl,
            displayName: source?.title ?? item.normalizedUrl ?? item.originalText,
            workflow: 'download-only'
          },
          priority: 100,
          maxAttempts: 3
        })
      );
    }
    this.emit();
    this.logger.info(
      'queue',
      'DOWNLOAD_QUEUE_CREATED',
      `Đã tạo ${downloadBySource.size} tác vụ tải cho danh sách.`,
      { projectId }
    );
    return this.repo.list(projectId);
  }
  public enqueueProject(
    projectId: string,
    options: {
      timelineOnly?: boolean;
      requestSignature?: string;
      trustedOutputPath?: string | null;
      legacyPendingPaths?: string[];
    } = {}
  ): QueueJob[] {
    /* TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12 */
    /* TUBMEDIA TIMELINE ONLY QUEUE HOTFIX12 */
    const timelineOnly = options.timelineOnly === true;
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Dự án không tồn tại.');
    const items = this.items
      .list(projectId)
      .filter((x) => x.enabled && x.validity !== 'invalid' && x.sourceId);
    if (!items.length) throw new Error('Dự án chưa có liên kết hợp lệ.');
    this.projects.setStatus(projectId, 'active');
    const downloadBySource = new Map<string, QueueJob>();
    for (const item of items) {
      if (!item.sourceId || downloadBySource.has(item.sourceId)) continue;
      const source = this.sources.get(item.sourceId);
      downloadBySource.set(
        item.sourceId,
        this.repo.create({
          projectId,
          type: 'download',
          sourceId: item.sourceId,
          input: {
            url: item.normalizedUrl,
            displayName: source?.title ?? item.normalizedUrl ?? item.originalText,
            workflow: 'download-merge'
          },
          priority: 100,
          maxAttempts: 3
        })
      );
    }
    const dependencies: string[] = [];
    for (const item of items) {
      const download = downloadBySource.get(item.sourceId!)!;
      if (
        !timelineOnly &&
        (item.timestampStartSeconds !== null ||
          item.timestampEndSeconds !== null ||
          item.audioMode === 'mute')
      ) {
        const clip = this.repo.create({
          projectId,
          type: 'clip',
          sourceId: item.sourceId,
          itemId: item.id,
          input: { dependsOn: [download.id] },
          priority: 50,
          maxAttempts: 2
        });
        dependencies.push(clip.id);
      } else dependencies.push(download.id);
    }
    this.repo.create({
      projectId,
      type: 'merge',
      input: {
        dependsOn: [...new Set(dependencies)],
        productName: project.finalFileName,
        outputFolder: project.outputFolder,
        exportTimelineTxt: project.exportTimelineTxt,
        timelineOnly,
        mergeRequestSignature: options.requestSignature ?? null,
        trustedOutputPath: options.trustedOutputPath ?? null,
        legacyPendingPaths: options.legacyPendingPaths ?? [],
        progressStage: timelineOnly ? 'Chờ video nguồn để tạo timeline' : 'Chờ video nguồn',
        progressElapsedSeconds: 0,
        progressProcessedSeconds: 0,
        progressTotalSeconds: 0,
        progressCurrentItem: 0,
        progressItemCount: items.length
      },
      priority: 10,
      maxAttempts: 1
    });
    this.emit();
    return this.repo.list(projectId);
  }
  public prepareProject(projectId: string): void {
    this.clearBlockingNoticeKeys(projectId);
    this.repeatedFailures.delete(projectId);
    this.cleanupInProgress.delete(projectId);
    if ([...this.active.values()].some((entry) => entry.job.projectId === projectId)) {
      throw new Error('Danh sách này đang chạy. Hãy tạm dừng hoặc hủy trước khi nhập lại.');
    }
    this.repo.clearProject(projectId);
    this.emit();
  }
  public async pauseProject(projectId: string): Promise<void> {
    /* TUBMEDIA_V132_PAUSE_PROJECT_RACE_SAFE */
    /* TUBMEDIA_V132_PAUSE_PROJECT_TERMINAL_RACE_HOTFIX */
    let pausedJobs = 0;

    for (const snapshot of this.repo.list(projectId)) {
      const current = this.repo.get(snapshot.id);

      if (!current || !PAUSABLE_STATUSES.has(current.status)) {
        continue;
      }

      try {
        await this.pause(current.id, false);

        if (this.repo.get(current.id)?.status === 'paused') {
          pausedJobs += 1;
        }
      } catch (error) {
        const latest = this.repo.get(current.id);

        if (
          error instanceof InvalidInputError &&
          (!latest || TERMINAL_STATUSES.has(latest.status) || !PAUSABLE_STATUSES.has(latest.status))
        ) {
          continue;
        }

        throw error;
      }
    }

    if (pausedJobs > 0) {
      this.projects.setStatus(projectId, 'paused');
      this.logger.info('queue', 'PROJECT_PAUSED', `Đã tạm dừng ${pausedJobs} tác vụ trong danh sách.`, {
        projectId
      });
    } else {
      this.syncProjectStatus(projectId);
      this.logger.info(
        'queue',
        'PROJECT_PAUSE_NOOP',
        'Danh sách không còn tác vụ có thể tạm dừng; tác vụ đã hoàn tất/bỏ qua được giữ nguyên.',
        { projectId }
      );
    }

    this.emit();
  }
  public async resumeProject(projectId: string): Promise<void> {
    const projectJobs = this.repo.list(projectId);
    const diskBlocked = projectJobs.filter(
      (job) => job.errorCode === 'DISK_FULL' && (job.status === 'paused' || job.status === 'interrupted')
    );
    if (diskBlocked.length > 0) {
      const disk = await this.diskSpaceStateForJobs(diskBlocked);
      if (!disk.ready) {
        const folder = disk.folder ?? 'thư mục lưu';
        throw new InvalidInputError(
          `Ổ đĩa chứa ${folder} vẫn chưa đủ dung lượng. Hiện còn ${this.formatDiskBytes(disk.freeBytes)}, cần tối thiểu ${this.formatDiskBytes(disk.requiredBytes)}.`
        );
      }
    }
    this.clearBlockingNoticeKeys(projectId);
    this.repeatedFailures.delete(projectId);
    for (const job of projectJobs) {
      if (job.status === 'paused' || job.status === 'interrupted') await this.resume(job.id, false);
    }
    this.projects.setStatus(projectId, 'active');
    this.logger.info('queue', 'PROJECT_RESUMED', 'Đã tiếp tục toàn bộ danh sách.', { projectId });
    this.emit();
  }
  public cancelProject(projectId: string): void {
    this.projects.setStatus(projectId, 'paused');
    this.logger.warn('queue', 'PROJECT_CANCELLED', 'Đã yêu cầu hủy toàn bộ tác vụ trong danh sách.', {
      projectId
    });
    for (const job of this.repo.list(projectId)) {
      if (!['completed', 'cancelled', 'failed', 'skipped'].includes(job.status)) this.cancel(job.id, false);
    }
    this.emit();
  }
  public clearProjectHistory(projectId: string): number {
    if ([...this.active.values()].some((entry) => entry.job.projectId === projectId)) {
      throw new Error('Danh sách vẫn đang chạy. Hãy tạm dừng hoặc hủy trước khi dọn tiến trình.');
    }
    const removed = this.repo.clearProject(projectId);
    this.repeatedFailures.delete(projectId);
    this.projects.setStatus(projectId, 'draft');
    this.emit();
    return removed;
  }
  public async pauseAll(): Promise<void> {
    /* TUBMEDIA_V132_PAUSE_ALL_TERMINAL_RACE_HOTFIX */
    this.paused = true;
    const projectIds = new Set<string>();

    for (const snapshot of this.repo.list()) {
      const current = this.repo.get(snapshot.id);

      if (!current || !PAUSABLE_STATUSES.has(current.status)) {
        continue;
      }

      try {
        await this.pause(current.id, false);
        const latest = this.repo.get(current.id);

        if (latest?.status === 'paused' && current.projectId) {
          projectIds.add(current.projectId);
        }
      } catch (error) {
        const latest = this.repo.get(current.id);

        if (
          error instanceof InvalidInputError &&
          (!latest || TERMINAL_STATUSES.has(latest.status) || !PAUSABLE_STATUSES.has(latest.status))
        ) {
          continue;
        }

        throw error;
      }
    }

    for (const projectId of projectIds) {
      this.projects.setStatus(projectId, 'paused');
    }

    this.logger.info(
      'queue',
      'ALL_WORKFLOWS_PAUSED',
      'Đã tạm dừng các tác vụ còn có thể tạm dừng; tác vụ terminal được giữ nguyên.'
    );

    this.emit();
  }

  public async resumeAll(): Promise<void> {
    const projectIds = new Set<string>();
    let firstError: Error | null = null;
    for (const job of this.repo.list()) {
      if (!['paused', 'interrupted'].includes(job.status)) continue;
      // Một tác vụ lỗi khi tiếp tục (đã bị xóa/đổi trạng thái, PowerShell resume thất bại...)
      // không được chặn các tác vụ còn lại, và nhất là không được để cờ paused kẹt ở true.
      try {
        await this.resume(job.id, false);
        if (job.projectId) projectIds.add(job.projectId);
      } catch (error) {
        if (error instanceof InvalidInputError) {
          this.logger.warn('queue', 'RESUME_ALL_JOB_SKIPPED', error.message, { jobId: job.id });
        } else {
          firstError ??= error instanceof Error ? error : new Error(String(error));
        }
      }
    }
    this.paused = false;
    for (const projectId of projectIds) this.projects.setStatus(projectId, 'active');
    this.logger.info('queue', 'ALL_WORKFLOWS_RESUMED', 'Đã tiếp tục tất cả danh sách tải và quy trình ghép.');
    this.emit();
    if (firstError) throw firstError;
  }
  public async pause(jobId: string, emitChange = true): Promise<void> {
    /* TUBMEDIA_V132_PAUSE_TERMINAL_NOOP_HOTFIX */
    const before = this.repo.get(jobId);

    if (!before) {
      throw new InvalidInputError('Tác vụ không tồn tại.');
    }

    if (TERMINAL_STATUSES.has(before.status)) {
      if (emitChange) this.emit();
      return;
    }

    if (!PAUSABLE_STATUSES.has(before.status)) {
      throw new InvalidInputError(`Không thể tạm dừng tác vụ ở trạng thái ${before.status}.`);
    }

    const active = this.active.get(jobId);
    if (active) {
      await this.processes.pauseByJob(jobId);
    }

    const current = this.repo.get(jobId);

    if (!current || !PAUSABLE_STATUSES.has(current.status)) {
      if (emitChange) this.emit();
      return;
    }

    this.repo.update(
      jobId,
      { status: 'paused', speed: null, etaSeconds: null },
      this.pauseResumeInput(before)
    );

    if (emitChange) this.emit();
  }
  public async resume(jobId: string, emitChange = true): Promise<void> {
    const active = this.active.get(jobId);
    const current = this.repo.get(jobId);
    if (!current) throw new InvalidInputError('Tác vụ không tồn tại.');
    if (!['paused', 'interrupted'].includes(current.status)) {
      throw new InvalidInputError(`Không thể tiếp tục tác vụ ở trạng thái ${current.status}.`);
    }
    this.clearBlockingNoticeKeys(current.projectId);
    const preserveCookieMarker = isCookieBlockingCode(current.errorCode);
    if (active) {
      await this.resumeActiveJobState(current, active, preserveCookieMarker);
    } else {
      this.repo.update(
        jobId,
        {
          status: 'pending',
          errorCode: preserveCookieMarker ? current.errorCode : null,
          errorMessage: preserveCookieMarker ? current.errorMessage : null
        },
        { resumeStatus: null }
      );
    }
    if (emitChange) this.emit();
  }
  public cancel(jobId: string, emitChange = true): void {
    const current = this.repo.get(jobId);
    if (!current) throw new InvalidInputError('Tác vụ không tồn tại.');
    if (TERMINAL_STATUSES.has(current.status)) return;
    const active = this.active.get(jobId);
    if (active) active.controller.abort();
    else this.repo.update(jobId, { status: 'cancelled', finishedAt: new Date().toISOString() });
    if (emitChange) this.emit();
  }
  public resumeCookieBlockedJobs(): number {
    const resumedProjects = new Set<string>();
    let resumed = 0;
    for (const job of this.repo.list()) {
      if (!isCookieBlockingCode(job.errorCode)) continue;
      if (!['paused', 'failed', 'interrupted'].includes(job.status)) continue;
      const resumedJob = this.repo.update(
        job.id,
        {
          status: 'pending',
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          speed: null,
          etaSeconds: null
        },
        {
          cookieFailureConfirmed: true,
          cookieRetryRequested: true,
          resumeStatus: null,
          progressStage: 'Cookies mới đã được lưu — đang tự tiếp tục'
        }
      );
      this.emitProgress(resumedJob);
      resumed += 1;
      if (job.projectId) resumedProjects.add(job.projectId);
    }
    for (const projectId of resumedProjects) {
      this.clearBlockingNoticeKeys(projectId);
      this.repeatedFailures.delete(projectId);
      this.projects.setStatus(projectId, 'active');
    }
    if (resumed > 0) {
      this.logger.info(
        'cookies',
        'COOKIE_BLOCKS_AUTO_RESUMED',
        `Cookies mới đã được lưu; ${resumed} video bị chặn được tự động đưa lại vào hàng đợi mà không cần dừng danh sách.`,
        { metadata: { resumedJobs: resumed, projects: resumedProjects.size } }
      );
      this.emit();
    }
    return resumed;
  }

  public retry(jobId: string): void {
    const current = this.repo.get(jobId);
    if (!current) throw new InvalidInputError('Tác vụ không tồn tại.');
    if (!['failed', 'interrupted'].includes(current.status)) {
      throw new InvalidInputError(
        `Chỉ có thể thử lại tác vụ failed/interrupted, hiện tại là ${current.status}.`
      );
    }
    this.repo.update(jobId, {
      status: 'pending',
      progress: 0,
      errorCode: null,
      errorMessage: null,
      finishedAt: null
    });
    this.emit();
  }
  public retryFailed(projectId?: string): number {
    this.clearBlockingNoticeKeys(projectId);
    const count = this.repo.retryFailed(projectId);
    this.emit();
    return count;
  }
  public async remove(
    jobId: string,
    deleteOutput = false
  ): Promise<{
    removed: boolean;
    outputDeleted: boolean;
    outputMissing: boolean;
    outputPath: string | null;
  }> {
    const job = this.repo.get(jobId);
    if (!job) {
      return { removed: false, outputDeleted: false, outputMissing: false, outputPath: null };
    }

    if (!TERMINAL_STATUSES.has(job.status)) {
      this.cancel(jobId, false);
      const deadline = Date.now() + 10_000;
      while (this.active.has(jobId) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.active.has(jobId)) {
        throw new Error('Tiến trình chưa dừng hoàn toàn. Hãy chờ vài giây rồi xóa lại.');
      }
    }

    const current = this.repo.get(jobId) ?? job;
    const outputPath =
      typeof current.input.outputPath === 'string' && current.input.outputPath.trim()
        ? current.input.outputPath.trim()
        : null;
    let outputDeleted = false;
    let outputMissing = false;

    if (deleteOutput) {
      if (!outputPath) {
        outputMissing = true;
      } else {
        try {
          const outputInfo = await stat(outputPath);
          if (!outputInfo.isFile()) {
            throw new Error(
              'Đường dẫn đầu ra không phải là một tệp. Tubmedia đã dừng để tránh xóa nhầm thư mục.'
            );
          }
          await rm(outputPath, { force: true });
          outputDeleted = true;
          this.logger.info(
            'queue',
            'QUEUE_OUTPUT_DELETED_BY_USER',
            'Đã xóa tệp đầu ra theo xác nhận của người dùng.',
            {
              ...(current.projectId ? { projectId: current.projectId } : {}),
              jobId,
              metadata: { outputPath }
            }
          );
        } catch (error) {
          const rawCode =
            error && typeof error === 'object' && 'code' in error
              ? (error as { code?: unknown }).code
              : undefined;
          let code = '';
          if (typeof rawCode === 'string') {
            code = rawCode;
          } else if (typeof rawCode === 'number') {
            code = String(rawCode);
          }
          if (code === 'ENOENT') {
            outputMissing = true;
          } else {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Không thể xóa tệp đầu ra. ${message}`);
          }
        }
      }
    }

    if (!TERMINAL_STATUSES.has(current.status)) {
      this.repo.update(jobId, {
        status: 'cancelled',
        speed: null,
        etaSeconds: null,
        errorCode: 'REMOVED_BY_USER',
        errorMessage: 'Tác vụ đã được người dùng xóa khỏi hàng đợi.',
        finishedAt: new Date().toISOString()
      });
    }
    this.repo.remove(jobId);
    this.progressUpdates.delete(jobId);
    this.emit();
    return { removed: true, outputDeleted, outputMissing, outputPath };
  }
  public clearFinished(projectId?: string): number {
    if (projectId) {
      const unfinished = this.repo
        .list(projectId)
        .some((entry) => !['completed', 'skipped', 'cancelled', 'failed'].includes(entry.status));
      if (unfinished) return 0;
      const count = this.repo.clearFinished(projectId);
      this.emit();
      return count;
    }
    const all = this.repo.list();
    const projectIds = [
      ...new Set(
        all.map((entry) => entry.projectId).filter((value): value is string => typeof value === 'string')
      )
    ];
    let count = 0;
    for (const id of projectIds) {
      const projectJobs = all.filter((entry) => entry.projectId === id);
      if (
        projectJobs.every((entry) => ['completed', 'skipped', 'cancelled', 'failed'].includes(entry.status))
      ) {
        count += this.repo.clearFinished(id);
      }
    }
    this.emit();
    return count;
  }
  public async removeProject(projectId: string): Promise<number> {
    this.cancelProject(projectId);
    const deadline = Date.now() + 10_000;
    while (
      [...this.active.values()].some((entry) => entry.job.projectId === projectId) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if ([...this.active.values()].some((entry) => entry.job.projectId === projectId)) {
      throw new Error('Một tiến trình nền chưa dừng hoàn toàn. Hãy chờ vài giây rồi xóa lại.');
    }
    const removed = this.repo.clearProject(projectId);
    this.repeatedFailures.delete(projectId);
    this.emit();
    return removed;
  }
  public async cancelAllAndWait(timeoutMs = 15_000): Promise<number> {
    const wasPaused = this.paused;
    this.paused = true;
    const targets = this.repo.list().filter((job) => !TERMINAL_STATUSES.has(job.status));
    for (const job of targets) this.cancel(job.id, false);
    this.emit();

    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.active.size > 0) {
      // Không để hàng đợi bị "đóng băng" vĩnh viễn chỉ vì lần hủy này hết thời gian chờ.
      this.paused = wasPaused;
      throw new Error('Một số tiến trình nền chưa dừng hoàn toàn. Hãy chờ vài giây rồi thử xóa lại.');
    }

    for (const job of this.repo.list()) {
      if (!TERMINAL_STATUSES.has(job.status)) {
        this.repo.update(job.id, { status: 'cancelled', finishedAt: new Date().toISOString() });
      }
    }
    this.paused = false;
    this.emit();
    return targets.length;
  }

  public clearAllHistory(): number {
    const removed = this.repo.clearAll();
    this.repeatedFailures.clear();
    this.paused = false;
    this.emit();
    return removed;
  }

  public refreshState(): void {
    this.emit();
  }
  public cancelAllActive(): void {
    for (const active of this.active.values()) this.cancel(active.job.id, false);
    this.emit();
  }
  public activeCount(): number {
    return this.active.size;
  }
}
