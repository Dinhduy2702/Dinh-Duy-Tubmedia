/**
 * GIAI ĐOẠN 4a (2026-09-23): bỏ hẳn PowerShell/Start-Process -Verb RunAs khỏi Dọn dẹp máy — toàn bộ
 * việc quét nay chạy bằng Node.js thuần (src/main/system/cleanup-scanner.ts), trong tiến trình main,
 * không cần quyền quản trị. Trạng thái mỗi lượt chạy được giữ trong bộ nhớ (Map), không còn ghi
 * request.json/status.json ra đĩa như trước.
 *
 * GĐ4a CHỈ quét và phân loại — mode 'clean' bị từ chối ngay với thông báo rõ ràng. Xóa/cách ly/hoàn
 * tác thật sẽ làm ở Giai đoạn 4b sau khi người dùng xem kỹ kết quả quét và duyệt riêng.
 */
import { randomUUID } from 'node:crypto';
import {
  SYSTEM_CLEANUP_CATEGORIES,
  validateSystemCleanupRequest,
  type SystemCleanupCategoryId,
  type SystemCleanupFinding,
  type SystemCleanupRequest,
  type SystemCleanupStatus
} from '@shared/system-cleanup.js';
import {
  categoryTargets,
  resolveCleanupEnvironmentPaths,
  scanTarget,
  scanTubmediaResidue,
  readDriveSpace,
  CleanupScanCancelledError,
  type CleanupEnvironmentPaths,
  type TubmediaResidueRoots
} from './cleanup-scanner.js';

export type TubmediaCleanupRoots = TubmediaResidueRoots;

const TERMINAL_PHASES = new Set<SystemCleanupStatus['phase']>(['completed', 'cancelled', 'failed']);

function categoryLabel(id: SystemCleanupCategoryId): string {
  return SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === id)?.label ?? id;
}

function initialStatus(runId: string, request: SystemCleanupRequest): SystemCleanupStatus {
  return {
    runId,
    mode: request.mode,
    phase: 'queued',
    progress: 0,
    message: 'Đang chuẩn bị quét.',
    currentCategory: null,
    processedCategories: 0,
    totalCategories: request.categories.length,
    estimatedBytes: 0,
    removedBytes: 0,
    removedItems: 0,
    skippedItems: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    driveBefore: null,
    driveAfter: null,
    results: [],
    findings: [],
    safeToDeleteBytes: 0,
    reviewBytes: 0,
    protectedBytes: 0,
    errors: []
  };
}

export class SystemCleanupService {
  private readonly runs = new Map<string, SystemCleanupStatus>();
  private readonly cancelRequested = new Set<string>();
  private activeRunId: string | null = null;

  public constructor(
    private readonly cleanupRoots: () => TubmediaCleanupRoots = () => ({
      sourceFolders: [],
      tempFolders: [],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    }),
    private readonly environment: () => CleanupEnvironmentPaths = resolveCleanupEnvironmentPaths
  ) {}

  public isActive(): boolean {
    if (!this.activeRunId) return false;
    const status = this.runs.get(this.activeRunId);
    return Boolean(status && !TERMINAL_PHASES.has(status.phase));
  }

  // Không đánh dấu async: hàm này chỉ ném lỗi ĐỒNG BỘ khi kiểm tra đầu vào, và Promise.reject() bên
  // dưới đảm bảo lỗi luôn đến tay caller dưới dạng Promise bị từ chối (đúng hợp đồng IPC), không bao
  // giờ ném lỗi đồng bộ ra ngoài — quan trọng vì handle() trong register-ipc.ts và các bài test đều
  // gọi start() rồi .catch()/await/expect(...).rejects, không bọc try/catch đồng bộ quanh lời gọi.
  public start(rawRequest: unknown): Promise<SystemCleanupStatus> {
    let request: SystemCleanupRequest;

    try {
      request = validateSystemCleanupRequest(rawRequest);

      if (this.isActive()) {
        throw new Error('Một tác vụ dọn dẹp khác đang chạy.');
      }

      if (request.mode === 'clean') {
        throw new Error(
          'Xóa thật chưa có ở bản này (Giai đoạn 4a chỉ quét và phân loại) — sẽ có ở Giai đoạn 4b sau khi bạn xem kỹ và duyệt.'
        );
      }
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const runId = randomUUID();
    const status = initialStatus(runId, request);
    this.runs.set(runId, status);
    this.activeRunId = runId;
    this.cancelRequested.delete(runId);

    void this.runEstimate(runId, request).catch((error: unknown) => {
      this.patch(runId, {
        phase: 'failed',
        message: error instanceof Error ? error.message : 'Quét dọn dẹp thất bại không rõ nguyên nhân.',
        completedAt: new Date().toISOString()
      });
      this.releaseRun(runId);
    });

    return Promise.resolve(status);
  }

  public status(runId: string): Promise<SystemCleanupStatus | null> {
    return Promise.resolve(this.runs.get(runId) ?? null);
  }

  public cancel(runId: string): Promise<SystemCleanupStatus | null> {
    const current = this.runs.get(runId);

    if (!current || TERMINAL_PHASES.has(current.phase)) {
      return Promise.resolve(current ?? null);
    }

    this.cancelRequested.add(runId);
    this.patch(runId, { message: 'Đã gửi yêu cầu dừng. Đang kết thúc an toàn...' });

    return Promise.resolve(this.runs.get(runId) ?? null);
  }

  private patch(runId: string, partial: Partial<SystemCleanupStatus>): void {
    const current = this.runs.get(runId);
    if (!current) return;
    this.runs.set(runId, { ...current, ...partial });
  }

  private releaseRun(runId: string): void {
    if (this.activeRunId === runId) {
      this.activeRunId = null;
    }
    this.cancelRequested.delete(runId);
  }

  private async runEstimate(runId: string, request: SystemCleanupRequest): Promise<void> {
    const env = this.environment();
    const roots = this.cleanupRoots();
    const driveBefore = await readDriveSpace(env.tempDir);

    this.patch(runId, { phase: 'scanning', message: 'Đang quét...', driveBefore });

    let estimatedBytes = 0;
    let safeToDeleteBytes = 0;
    const allFindings: SystemCleanupFinding[] = [];
    const results: SystemCleanupStatus['results'] = [];
    const errors: string[] = [];
    let processed = 0;

    const shouldCancel = (): boolean => this.cancelRequested.has(runId);

    for (const categoryId of request.categories) {
      if (shouldCancel()) {
        this.finishCancelled(runId, { estimatedBytes, safeToDeleteBytes, findings: allFindings, results, errors });
        return;
      }

      this.patch(runId, {
        currentCategory: categoryId,
        message: `Đang quét: ${categoryLabel(categoryId)}`
      });

      let categoryBytes = 0;
      let categoryFindings: SystemCleanupFinding[] = [];
      const categoryErrors: string[] = [];
      let cancelled = false;

      try {
        if (categoryId === 'tubmediaResidue') {
          const outcome = await scanTubmediaResidue(roots, Date.now(), { shouldCancel });
          categoryBytes = outcome.estimatedBytes;
          categoryFindings = outcome.findings;
          categoryErrors.push(...outcome.errors);
        } else {
          const targets = await categoryTargets(categoryId, env);

          for (const target of targets) {
            try {
              const outcome = await scanTarget(target, { shouldCancel });
              categoryBytes += outcome.estimatedBytes;
              categoryFindings.push(...outcome.findings);
            } catch (targetError) {
              if (targetError instanceof CleanupScanCancelledError) {
                throw targetError;
              }
              categoryErrors.push(targetError instanceof Error ? targetError.message : String(targetError));
            }
          }
        }
      } catch (categoryError) {
        if (categoryError instanceof CleanupScanCancelledError) {
          cancelled = true;
        } else {
          categoryErrors.push(categoryError instanceof Error ? categoryError.message : String(categoryError));
        }
      }

      estimatedBytes += categoryBytes;
      safeToDeleteBytes += categoryBytes;
      allFindings.push(...categoryFindings);
      errors.push(...categoryErrors);
      results.push({
        id: categoryId,
        estimatedBytes: categoryBytes,
        removedBytes: 0,
        removedItems: 0,
        skippedItems: 0,
        errors: categoryErrors,
        findings: categoryFindings
      });

      if (cancelled) {
        this.finishCancelled(runId, { estimatedBytes, safeToDeleteBytes, findings: allFindings, results, errors });
        return;
      }

      processed += 1;
      this.patch(runId, {
        processedCategories: processed,
        progress: Math.round((processed / request.categories.length) * 100),
        estimatedBytes,
        safeToDeleteBytes,
        findings: allFindings.slice(0, 200),
        results
      });
    }

    this.patch(runId, {
      phase: 'completed',
      message: 'Quét dung lượng hoàn tất',
      progress: 100,
      currentCategory: null,
      completedAt: new Date().toISOString(),
      estimatedBytes,
      safeToDeleteBytes,
      findings: allFindings.slice(0, 200),
      results,
      errors
    });
    this.releaseRun(runId);
  }

  private finishCancelled(
    runId: string,
    snapshot: {
      estimatedBytes: number;
      safeToDeleteBytes: number;
      findings: SystemCleanupFinding[];
      results: SystemCleanupStatus['results'];
      errors: string[];
    }
  ): void {
    this.patch(runId, {
      phase: 'cancelled',
      message: 'Đã dừng theo yêu cầu.',
      currentCategory: null,
      completedAt: new Date().toISOString(),
      estimatedBytes: snapshot.estimatedBytes,
      safeToDeleteBytes: snapshot.safeToDeleteBytes,
      findings: snapshot.findings.slice(0, 200),
      results: snapshot.results,
      errors: snapshot.errors
    });
    this.releaseRun(runId);
  }
}
