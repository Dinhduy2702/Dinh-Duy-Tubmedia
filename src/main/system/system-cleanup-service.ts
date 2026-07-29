import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  systemCleanupRequiresAdmin,
  validateSystemCleanupRequest,
  type SystemCleanupRequest,
  type SystemCleanupStatus
} from '@shared/system-cleanup.js';

const TERMINAL_PHASES = new Set(['completed', 'cancelled', 'failed']);

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function initialStatus(runId: string, request: SystemCleanupRequest): SystemCleanupStatus {
  return {
    runId,
    mode: request.mode,
    phase: 'queued',
    progress: 0,
    message: 'Đang chuẩn bị tác vụ dọn dẹp.',
    currentCategory: null,
    processedCategories: 0,
    totalCategories: request.categories.length,
    estimatedBytes: 0,
    removedBytes: 0,
    removedItems: 0,
    skippedItems: 0,
    requiresAdmin: systemCleanupRequiresAdmin(request.categories),
    startedAt: new Date().toISOString(),
    completedAt: null,
    driveBefore: null,
    driveAfter: null,
    results: [],
    errors: []
  };
}

export class SystemCleanupService {
  private activeRunId: string | null = null;
  private activeProcess: ChildProcess | null = null;
  private readonly runRoot = join(app.getPath('userData'), 'system-cleanup-runs');

  public isActive(): boolean {
    return this.activeRunId !== null;
  }

  public async start(rawRequest: unknown): Promise<SystemCleanupStatus> {
    const request = validateSystemCleanupRequest(rawRequest);

    if (this.activeRunId) {
      const active = await this.status(this.activeRunId);

      if (active && !TERMINAL_PHASES.has(active.phase)) {
        throw new Error('Một tác vụ dọn dẹp khác đang chạy.');
      }

      this.activeRunId = null;
      this.activeProcess = null;
    }

    await mkdir(this.runRoot, { recursive: true });
    await this.removeStaleRuns();

    const runId = randomUUID();
    const runDirectory = join(this.runRoot, runId);
    const requestPath = join(runDirectory, 'request.json');
    const statusPath = join(runDirectory, 'status.json');
    const cancelPath = join(runDirectory, 'cancel.requested');
    const launcherPath = join(runDirectory, 'launch-elevated.ps1');
    const helperPath = await this.resolveHelperPath();

    await mkdir(runDirectory, { recursive: true });
    await writeFile(requestPath, JSON.stringify(request, null, 2), 'utf8');

    const status = initialStatus(runId, request);
    await writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8');

    const helperArguments = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      '-RequestPath',
      requestPath,
      '-StatusPath',
      statusPath,
      '-CancelPath',
      cancelPath
    ];

    this.activeRunId = runId;

    if (status.requiresAdmin) {
      const argumentArray = helperArguments.map(quotePowerShellLiteral).join(', ');

      const launcher = [
        "$ErrorActionPreference = 'Stop'",
        'try {',
        `  $process = Start-Process -FilePath ${quotePowerShellLiteral(
          this.powerShellPath()
        )} -ArgumentList @(${argumentArray}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
        '  exit $process.ExitCode',
        '} catch {',
        '  Write-Error $_',
        '  exit 1223',
        '}',
        ''
      ].join('\r\n');

      await writeFile(launcherPath, launcher, 'utf8');
      await this.patchStatus(statusPath, {
        phase: 'waiting-admin',
        message: 'Đang chờ người dùng xác nhận quyền quản trị Windows.'
      });

      this.activeProcess = spawn(
        this.powerShellPath(),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherPath],
        {
          windowsHide: true,
          stdio: 'ignore'
        }
      );
    } else {
      this.activeProcess = spawn(this.powerShellPath(), helperArguments, {
        windowsHide: true,
        stdio: 'ignore'
      });
    }

    const child = this.activeProcess;

    child.once('error', async (error) => {
      await this.failIfNotTerminal(statusPath, `Không thể khởi chạy tiến trình dọn dẹp: ${error.message}`);
      this.releaseRun(runId);
    });

    child.once('close', async (code) => {
      if (code !== 0) {
        await this.failIfNotTerminal(
          statusPath,
          code === 1223
            ? 'Yêu cầu quyền quản trị đã bị hủy.'
            : `Tiến trình dọn dẹp kết thúc với mã ${String(code)}.`
        );
      }

      this.releaseRun(runId);
    });

    return (await this.status(runId)) ?? status;
  }

  public async status(runId: string): Promise<SystemCleanupStatus | null> {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) {
      return null;
    }

    const statusPath = join(this.runRoot, runId, 'status.json');

    if (!existsSync(statusPath)) {
      return null;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const parsed = JSON.parse(await readFile(statusPath, 'utf8')) as SystemCleanupStatus;

        if (parsed.runId !== runId) {
          return null;
        }

        return parsed;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }

    return null;
  }

  public async cancel(runId: string): Promise<SystemCleanupStatus | null> {
    const current = await this.status(runId);

    if (!current || TERMINAL_PHASES.has(current.phase)) {
      return current;
    }

    const cancelPath = join(this.runRoot, runId, 'cancel.requested');
    await writeFile(cancelPath, new Date().toISOString(), 'utf8');

    await this.patchStatus(join(this.runRoot, runId, 'status.json'), {
      message: 'Đã gửi yêu cầu dừng. Tác vụ hệ thống đang chạy sẽ kết thúc an toàn trước khi dừng.'
    });

    return this.status(runId);
  }

  private releaseRun(runId: string): void {
    if (this.activeRunId === runId) {
      this.activeRunId = null;
      this.activeProcess = null;
    }
  }

  private powerShellPath(): string {
    return join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
  }

  private async resolveHelperPath(): Promise<string> {
    const candidates = [
      join(process.resourcesPath, 'system-cleanup-helper.ps1'),
      join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'system-cleanup-helper.ps1'),
      join(app.getAppPath(), 'resources', 'system-cleanup-helper.ps1')
    ];

    const source = candidates.find((candidate) => existsSync(candidate));

    if (!source) {
      throw new Error('Thiếu system-cleanup-helper.ps1 trong gói ứng dụng.');
    }

    const localHelperDirectory = join(app.getPath('userData'), 'system-cleanup-helper');
    const localHelperPath = join(localHelperDirectory, 'system-cleanup-helper.ps1');

    await mkdir(localHelperDirectory, { recursive: true });
    await copyFile(source, localHelperPath);

    return localHelperPath;
  }

  private async patchStatus(statusPath: string, patch: Partial<SystemCleanupStatus>): Promise<void> {
    try {
      const current = JSON.parse(await readFile(statusPath, 'utf8')) as SystemCleanupStatus;

      await writeFile(statusPath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf8');
    } catch {
      // Helper có thể đang ghi cùng lúc; lần polling kế tiếp sẽ đọc lại.
    }
  }

  private async failIfNotTerminal(statusPath: string, message: string): Promise<void> {
    try {
      const current = JSON.parse(await readFile(statusPath, 'utf8')) as SystemCleanupStatus;

      if (TERMINAL_PHASES.has(current.phase)) {
        return;
      }

      await writeFile(
        statusPath,
        JSON.stringify(
          {
            ...current,
            phase: 'failed',
            message,
            completedAt: new Date().toISOString(),
            errors: [...current.errors, message]
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // Không còn status file để cập nhật.
    }
  }

  private async removeStaleRuns(): Promise<void> {
    // Chỉ xóa namespace riêng do Tubmedia tạo, không quét thư mục Temp chung.
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    try {
      const { readdir, stat } = await import('node:fs/promises');
      const entries = await readdir(this.runRoot, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const fullPath = join(this.runRoot, entry.name);
        const info = await stat(fullPath);

        if (info.mtimeMs < cutoff) {
          await rm(fullPath, { recursive: true, force: true });
        }
      }
    } catch {
      // Dọn stale là best-effort.
    }
  }
}
