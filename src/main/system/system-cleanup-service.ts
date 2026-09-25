/**
 * GIAI ĐOẠN 4a/4b (2026-09-23): bỏ hẳn PowerShell/Start-Process -Verb RunAs khỏi Dọn dẹp máy — toàn bộ
 * việc quét/xóa nay chạy bằng Node.js thuần (src/main/system/cleanup-scanner.ts +
 * cleanup-quarantine.ts), trong tiến trình main, không cần quyền quản trị. Trạng thái mỗi lượt chạy
 * được giữ trong bộ nhớ (Map), không còn ghi request.json/status.json ra đĩa như trước.
 *
 * GĐ4a: mode 'estimate' — chỉ quét và phân loại, không xóa gì.
 * GĐ4b: mode 'clean' — quét LẠI một lần nữa ngay tại lúc xóa (không tin tưởng số liệu ước tính cũ, dù
 * cách nhau bao lâu), rồi cách ly (quarantine) THẬT từng file khớp qua QuarantineStore. Không có bước
 * "xóa vĩnh viễn ngay" — file luôn đi qua khu cách ly trước, có thể hoàn tác trong
 * QUARANTINE_RETENTION_DAYS ngày trước khi bị dọn vĩnh viễn.
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
  listCategoryFiles,
  listResidueFiles,
  scanTarget,
  scanTubmediaResidue,
  readDriveSpace,
  CleanupScanCancelledError,
  type CleanupEnvironmentPaths,
  type FoundFile,
  type TubmediaResidueRoots
} from './cleanup-scanner.js';
import { QUARANTINE_RETENTION_DAYS, type QuarantineStore } from './cleanup-quarantine.js';

export type TubmediaCleanupRoots = TubmediaResidueRoots;

const TERMINAL_PHASES = new Set<SystemCleanupStatus['phase']>(['completed', 'cancelled', 'failed']);

interface RunSnapshot {
  estimatedBytes: number;
  removedBytes: number;
  removedItems: number;
  skippedItems: number;
  safeToDeleteBytes: number;
  findings: SystemCleanupFinding[];
  results: SystemCleanupStatus['results'];
  errors: string[];
}

function categoryLabel(id: SystemCleanupCategoryId): string {
  return SYSTEM_CLEANUP_CATEGORIES.find((item) => item.id === id)?.label ?? id;
}

function initialStatus(runId: string, request: SystemCleanupRequest): SystemCleanupStatus {
  return {
    runId,
    mode: request.mode,
    phase: 'queued',
    progress: 0,
    message: request.mode === 'clean' ? 'Đang chuẩn bị dọn dẹp.' : 'Đang chuẩn bị quét.',
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
    private readonly cleanupRoots: () => TubmediaCleanupRoots,
    private readonly environment: () => CleanupEnvironmentPaths,
    private readonly quarantine: QuarantineStore
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
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const runId = randomUUID();
    const status = initialStatus(runId, request);
    this.runs.set(runId, status);
    this.activeRunId = runId;
    this.cancelRequested.delete(runId);

    const run = request.mode === 'clean' ? this.runClean(runId, request) : this.runEstimate(runId, request);

    void run.catch((error: unknown) => {
      this.patch(runId, {
        phase: 'failed',
        message: error instanceof Error ? error.message : 'Dọn dẹp thất bại không rõ nguyên nhân.',
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

    const snapshot: RunSnapshot = {
      estimatedBytes: 0,
      removedBytes: 0,
      removedItems: 0,
      skippedItems: 0,
      safeToDeleteBytes: 0,
      findings: [],
      results: [],
      errors: []
    };
    let processed = 0;

    const shouldCancel = (): boolean => this.cancelRequested.has(runId);

    for (const categoryId of request.categories) {
      if (shouldCancel()) {
        this.finishCancelled(runId, snapshot);
        return;
      }

      this.patch(runId, { currentCategory: categoryId, message: `Đang quét: ${categoryLabel(categoryId)}` });

      let categoryBytes = 0;
      let categoryMatchedItems = 0;
      let categoryFindings: SystemCleanupFinding[] = [];
      const categoryErrors: string[] = [];
      let cancelled = false;

      try {
        if (categoryId === 'tubmediaResidue') {
          const outcome = await scanTubmediaResidue(roots, Date.now(), { shouldCancel });
          categoryBytes = outcome.estimatedBytes;
          categoryMatchedItems = outcome.matchedItems;
          categoryFindings = outcome.findings;
          categoryErrors.push(...outcome.errors);
        } else {
          const targets = await categoryTargets(categoryId, env);

          for (const target of targets) {
            try {
              const outcome = await scanTarget(target, { shouldCancel });
              categoryBytes += outcome.estimatedBytes;
              categoryMatchedItems += outcome.matchedItems;
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

      snapshot.estimatedBytes += categoryBytes;
      snapshot.safeToDeleteBytes += categoryBytes;
      snapshot.findings.push(...categoryFindings);
      snapshot.errors.push(...categoryErrors);
      snapshot.results.push({
        matchedItems: categoryMatchedItems,
        id: categoryId,
        estimatedBytes: categoryBytes,
        removedBytes: 0,
        removedItems: 0,
        skippedItems: 0,
        errors: categoryErrors,
        findings: categoryFindings
      });

      if (cancelled) {
        this.finishCancelled(runId, snapshot);
        return;
      }

      processed += 1;
      this.patch(runId, {
        processedCategories: processed,
        progress: Math.round((processed / request.categories.length) * 100),
        estimatedBytes: snapshot.estimatedBytes,
        safeToDeleteBytes: snapshot.safeToDeleteBytes,
        findings: snapshot.findings.slice(0, 200),
        results: snapshot.results
      });
    }

    this.patch(runId, {
      phase: 'completed',
      message: 'Quét dung lượng hoàn tất',
      progress: 100,
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

  private async runClean(runId: string, request: SystemCleanupRequest): Promise<void> {
    const env = this.environment();
    const roots = this.cleanupRoots();
    const driveBefore = await readDriveSpace(env.tempDir);

    this.patch(runId, { phase: 'cleaning', message: 'Đang dọn dẹp...', driveBefore });

    const snapshot: RunSnapshot = {
      estimatedBytes: 0,
      removedBytes: 0,
      removedItems: 0,
      skippedItems: 0,
      safeToDeleteBytes: 0,
      findings: [],
      results: [],
      errors: []
    };
    let processed = 0;

    const shouldCancel = (): boolean => this.cancelRequested.has(runId);

    for (const categoryId of request.categories) {
      if (shouldCancel()) {
        this.finishCancelled(runId, snapshot);
        return;
      }

      this.patch(runId, { currentCategory: categoryId, message: `Đang dọn: ${categoryLabel(categoryId)}` });

      let categoryEstimated = 0;
      let categoryRemovedBytes = 0;
      let categoryRemovedItems = 0;
      let categorySkipped = 0;
      const categoryFindings: SystemCleanupFinding[] = [];
      const categoryErrors: string[] = [];
      let cancelled = false;

      try {
        // Luôn quét LẠI ngay lúc xóa — không tin tưởng một lượt ước tính cũ, dù cách đây bao lâu.
        let files: FoundFile[];

        if (categoryId === 'tubmediaResidue') {
          const outcome = await listResidueFiles(roots, Date.now(), { shouldCancel });
          files = outcome.matches;
          categoryErrors.push(...outcome.errors);
        } else {
          const targets = await categoryTargets(categoryId, env);
          const collected: FoundFile[] = [];

          for (const target of targets) {
            try {
              collected.push(...(await listCategoryFiles(target, { shouldCancel })));
            } catch (targetError) {
              if (targetError instanceof CleanupScanCancelledError) {
                throw targetError;
              }
              categoryErrors.push(targetError instanceof Error ? targetError.message : String(targetError));
            }
          }
          files = collected;
        }

        for (const file of files) {
          if (shouldCancel()) {
            throw new CleanupScanCancelledError();
          }

          categoryEstimated += file.bytes;

          // Kiểm tra lại an toàn NGAY trước khi cách ly từng file — quarantineFile() tự gọi lại
          // assertSafeCleanupPath()+lstat() một lần nữa bên trong, không tin kết quả quét ở trên.
          const outcome = await this.quarantine.quarantineFile(file.path, categoryId, runId);

          if (outcome.ok) {
            categoryRemovedBytes += outcome.entry.bytes;
            categoryRemovedItems += 1;
            categoryFindings.push({
              path: outcome.entry.originalPath,
              bytes: outcome.entry.bytes,
              classification: 'safe-to-delete',
              reason: `Đã chuyển vào khu cách ly — có thể hoàn tác trong ${QUARANTINE_RETENTION_DAYS} ngày.`
            });
          } else {
            categorySkipped += 1;
            categoryErrors.push(`${file.path}: ${outcome.reason}`);
          }
        }
      } catch (categoryError) {
        if (categoryError instanceof CleanupScanCancelledError) {
          cancelled = true;
        } else {
          categoryErrors.push(categoryError instanceof Error ? categoryError.message : String(categoryError));
        }
      }

      snapshot.estimatedBytes += categoryEstimated;
      snapshot.removedBytes += categoryRemovedBytes;
      snapshot.removedItems += categoryRemovedItems;
      snapshot.skippedItems += categorySkipped;
      snapshot.safeToDeleteBytes += categoryEstimated;
      snapshot.findings.push(...categoryFindings);
      snapshot.errors.push(...categoryErrors);
      snapshot.results.push({
        matchedItems: categoryRemovedItems + categorySkipped,
        id: categoryId,
        estimatedBytes: categoryEstimated,
        removedBytes: categoryRemovedBytes,
        removedItems: categoryRemovedItems,
        skippedItems: categorySkipped,
        errors: categoryErrors,
        findings: categoryFindings
      });

      if (cancelled) {
        this.finishCancelled(runId, snapshot);
        return;
      }

      processed += 1;
      this.patch(runId, {
        processedCategories: processed,
        progress: Math.round((processed / request.categories.length) * 100),
        estimatedBytes: snapshot.estimatedBytes,
        removedBytes: snapshot.removedBytes,
        removedItems: snapshot.removedItems,
        skippedItems: snapshot.skippedItems,
        safeToDeleteBytes: snapshot.safeToDeleteBytes,
        findings: snapshot.findings.slice(0, 200),
        results: snapshot.results
      });
    }

    const driveAfter = await readDriveSpace(env.tempDir);

    this.patch(runId, {
      phase: 'completed',
      message: 'Dọn dẹp hoàn tất',
      progress: 100,
      currentCategory: null,
      completedAt: new Date().toISOString(),
      estimatedBytes: snapshot.estimatedBytes,
      removedBytes: snapshot.removedBytes,
      removedItems: snapshot.removedItems,
      skippedItems: snapshot.skippedItems,
      safeToDeleteBytes: snapshot.safeToDeleteBytes,
      driveAfter,
      findings: snapshot.findings.slice(0, 200),
      results: snapshot.results,
      errors: snapshot.errors
    });
    this.releaseRun(runId);
  }

  private finishCancelled(runId: string, snapshot: RunSnapshot): void {
    this.patch(runId, {
      phase: 'cancelled',
      message: 'Đã dừng theo yêu cầu.',
      currentCategory: null,
      completedAt: new Date().toISOString(),
      estimatedBytes: snapshot.estimatedBytes,
      removedBytes: snapshot.removedBytes,
      removedItems: snapshot.removedItems,
      skippedItems: snapshot.skippedItems,
      safeToDeleteBytes: snapshot.safeToDeleteBytes,
      findings: snapshot.findings.slice(0, 200),
      results: snapshot.results,
      errors: snapshot.errors
    });
    this.releaseRun(runId);
  }
}
