import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ProcessPriority } from '@shared/types/domain.js';
import { ProcessCancelledError, ProcessSpawnError, ProcessTimeoutError } from '@shared/errors/app-errors.js';
import type { Logger } from '../logging/logger.js';

export interface ProcessRunOptions {
  jobId: string;
  projectId?: string | null;
  tool: string;
  executablePath: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  priority?: ProcessPriority;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}
export interface ProcessResult { code: number; stdoutTail: string; stderrTail: string; durationMs: number; }
interface Managed {
  id: string;
  jobId: string;
  tool: string;
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  priority: ProcessPriority;
  suspended: boolean;
  controlTail: Promise<void>;
}

export const TRANSIENT_WINDOWS_PROCESS_ERRORS = [87, 1168] as const;
export const TRANSIENT_WINDOWS_PROCESS_NTSTATUS = [
  -1073741813, // 0xC000000B — STATUS_INVALID_CID: PID vừa biến mất.
  -1073741558 // 0xC000010A — STATUS_PROCESS_IS_TERMINATING.
] as const;

export function isTransientWindowsProcessNtStatus(status: number): boolean {
  return TRANSIENT_WINDOWS_PROCESS_NTSTATUS.includes(
    status as (typeof TRANSIENT_WINDOWS_PROCESS_NTSTATUS)[number]
  );
}

export function buildWindowsProcessControlScript(
  pid: number,
  action: 'pause' | 'resume'
): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`PID Windows không hợp lệ: ${pid}`);
  }

  const nativeMethod = action === 'pause' ? 'NtSuspendProcess' : 'NtResumeProcess';
  const operation = action === 'pause' ? 'tạm dừng' : 'tiếp tục';
  const reverseForResume = action === 'resume' ? '$targets.Reverse()' : '';
  const transientWindowsErrors = TRANSIENT_WINDOWS_PROCESS_ERRORS.join(', ');
  const transientNtStatus = TRANSIENT_WINDOWS_PROCESS_NTSTATUS.join(', ');

  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$transientWindowsErrors = @(${transientWindowsErrors})
$transientNtStatus = @(${transientNtStatus})
if (-not ('Tubmedia.NativeProcessControl' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Tubmedia {
  public static class NativeProcessControl {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
    [DllImport("ntdll.dll")]
    public static extern int NtSuspendProcess(IntPtr processHandle);
    [DllImport("ntdll.dll")]
    public static extern int NtResumeProcess(IntPtr processHandle);
  }
}
'@
}
$allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$targets = New-Object 'System.Collections.Generic.List[int]'
$controlledTargets = New-Object 'System.Collections.Generic.List[int]'
$rootUnavailable = $false
$rootFailureMessage = $null
function Add-TubmediaProcessTree([int]$currentProcessId) {
  foreach ($childProcess in $allProcesses | Where-Object { [int]$_.ParentProcessId -eq $currentProcessId }) {
    Add-TubmediaProcessTree ([int]$childProcess.ProcessId)
  }
  [void]$targets.Add($currentProcessId)
}
Add-TubmediaProcessTree ${pid}
${reverseForResume}
foreach ($targetProcessId in $targets) {
  $handle = [Tubmedia.NativeProcessControl]::OpenProcess(0x0800, $false, $targetProcessId)
  if ($handle -eq [IntPtr]::Zero) {
    $openError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($transientWindowsErrors -contains $openError) {
      if ($targetProcessId -eq ${pid}) {
        $rootUnavailable = $true
      }
      continue
    }
    if ($targetProcessId -eq ${pid}) {
      $rootFailureMessage = "Không thể mở tiến trình PID ${pid} để ${operation}. Mã Windows: $openError"
    }
    continue
  }
  try {
    $result = [Tubmedia.NativeProcessControl]::${nativeMethod}($handle)
    if ($result -eq 0) {
      [void]$controlledTargets.Add($targetProcessId)
      continue
    }
    if ($transientNtStatus -contains $result) {
      if ($targetProcessId -eq ${pid}) {
        $rootUnavailable = $true
      }
      continue
    }
    if ($targetProcessId -eq ${pid}) {
      $rootFailureMessage = "Windows không thể ${operation} PID $targetProcessId. Mã NTSTATUS: $result"
    }
  } finally {
    [void][Tubmedia.NativeProcessControl]::CloseHandle($handle)
  }
}
${action === 'pause'
    ? `if ($rootUnavailable -or $null -ne $rootFailureMessage) {
  # Tiến trình cha đã kết thúc trong lúc duyệt cây. Hoàn tác các tiến trình con
  # vừa tạm dừng để không để lại FFmpeg/aria2c bị treo mồ côi.
  foreach ($controlledProcessId in $controlledTargets) {
    if ($controlledProcessId -eq ${pid}) {
      continue
    }
    $rollbackHandle = [Tubmedia.NativeProcessControl]::OpenProcess(0x0800, $false, $controlledProcessId)
    if ($rollbackHandle -eq [IntPtr]::Zero) {
      continue
    }
    try {
      [void][Tubmedia.NativeProcessControl]::NtResumeProcess($rollbackHandle)
    } finally {
      [void][Tubmedia.NativeProcessControl]::CloseHandle($rollbackHandle)
    }
  }
}`
    : ''}
if ($null -ne $rootFailureMessage) {
  throw $rootFailureMessage
}
`;
}

export function processEnvironmentFor(
  tool: string,
  overrides?: NodeJS.ProcessEnv,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...inherited,
    ...(tool === 'yt-dlp'
      ? {
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        }
      : {}),
    ...overrides
  };
}

class RingLines {
  private readonly lines: string[] = [];
  public constructor(private readonly max = 400) {}
  public push(line: string): void { this.lines.push(line); if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max); }
  public text(): string { return this.lines.join('\n'); }
}
function lineConsumer(stream: NodeJS.ReadableStream, callback: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n|\r/);
      buffer = lines.pop() ?? '';
      for (const line of lines) callback(line);
    });
    stream.on('end', () => { if (buffer) callback(buffer); resolve(); });
    stream.on('error', reject);
  });
}
export class ProcessManager {
  private readonly active = new Map<string, Managed>();
  public constructor(private readonly logger: Logger) {}
  public count(): number { return this.active.size; }
  public isToolActive(tool: string): boolean { return [...this.active.values()].some((item) => item.tool === tool); }
  public async run(options: ProcessRunOptions): Promise<ProcessResult> {
    const id = randomUUID();
    const startedAt = Date.now();
    const stdout = new RingLines(); const stderr = new RingLines();
    const child = spawn(options.executablePath, options.args, {
      cwd: options.cwd,
      env: processEnvironmentFor(options.tool, options.env),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdin.end();
    const managed: Managed = {
      id,
      jobId: options.jobId,
      tool: options.tool,
      process: child,
      startedAt,
      priority: options.priority ?? 'below_normal',
      suspended: false,
      controlTail: Promise.resolve()
    };
    this.active.set(id, managed);
    this.logger.info('process', 'PROCESS_STARTED', `${options.tool} PID ${child.pid ?? 0} đã bắt đầu.`, { jobId: options.jobId, ...(options.projectId ? { projectId: options.projectId } : {}), metadata: { executable: options.executablePath, argsCount: options.args.length } });
    if (child.pid && process.platform === 'win32') void this.setPriority(child.pid, managed.priority);
    let cancelled = false;
    const abort = (): void => {
      cancelled = true;
      void this.kill(id).catch((error) => {
        this.logger.error('process', 'PROCESS_CANCEL_FAILED', `Không thể hủy cây tiến trình ${options.tool}: ${error instanceof Error ? error.message : String(error)}`, {
          jobId: options.jobId,
          ...(options.projectId ? { projectId: options.projectId } : {})
        });
      });
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      this.logger.warn('process', 'PROCESS_TIMEOUT', `${options.tool} quá thời gian.`, { jobId: options.jobId });
      void this.kill(id).catch((error) => {
        this.logger.error('process', 'PROCESS_TIMEOUT_KILL_FAILED', `Không thể kết thúc cây tiến trình quá hạn: ${error instanceof Error ? error.message : String(error)}`, { jobId: options.jobId });
      });
    }, options.timeoutMs) : null;
    let stdoutCallbackEnabled = true;
    let stderrCallbackEnabled = true;
    const outPromise = lineConsumer(child.stdout, (line) => {
      stdout.push(line);
      if (!stdoutCallbackEnabled || !options.onStdoutLine) return;
      try {
        options.onStdoutLine(line);
      } catch (error) {
        stdoutCallbackEnabled = false;
        this.logger.warn(
          'process',
          'PROCESS_STDOUT_CALLBACK_DISABLED',
          'Đã bỏ qua lỗi đọc tiến trình stdout để tiến trình media tiếp tục an toàn.',
          {
            jobId: options.jobId,
            ...(options.projectId ? { projectId: options.projectId } : {}),
            metadata: {
              tool: options.tool,
              error: error instanceof Error ? error.message : String(error),
              line: line.slice(-500)
            }
          }
        );
      }
    });
    const errPromise = lineConsumer(child.stderr, (line) => {
      stderr.push(line);
      if (!stderrCallbackEnabled || !options.onStderrLine) return;
      try {
        options.onStderrLine(line);
      } catch (error) {
        stderrCallbackEnabled = false;
        this.logger.warn(
          'process',
          'PROCESS_STDERR_CALLBACK_DISABLED',
          'Đã bỏ qua lỗi đọc tiến trình stderr để tiến trình media tiếp tục an toàn.',
          {
            jobId: options.jobId,
            ...(options.projectId ? { projectId: options.projectId } : {}),
            metadata: {
              tool: options.tool,
              error: error instanceof Error ? error.message : String(error),
              line: line.slice(-500)
            }
          }
        );
      }
    });
    let code: number;
    try {
      code = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode) => resolve(exitCode ?? -1));
      });
    } catch (error) {
      await Promise.allSettled([outPromise, errPromise]);
      throw new ProcessSpawnError(options.tool, error instanceof Error ? error.message : String(error));
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      this.active.delete(id);
    }
    await Promise.allSettled([outPromise, errPromise]);
    const result = { code, stdoutTail: stdout.text(), stderrTail: stderr.text(), durationMs: Date.now() - startedAt };
    this.logger.info('process', 'PROCESS_FINISHED', `${options.tool} kết thúc với mã ${code}.`, { jobId: options.jobId, ...(options.projectId ? { projectId: options.projectId } : {}), metadata: { durationMs: result.durationMs } });
    if (timedOut) throw new ProcessTimeoutError(options.tool, options.timeoutMs ?? 0);
    if (cancelled) throw new ProcessCancelledError();
    return result;
  }
  public async setPriority(pid: number, priority: ProcessPriority): Promise<void> {
    if (process.platform !== 'win32') return;
    const map: Record<ProcessPriority, string> = { idle: 'Idle', below_normal: 'BelowNormal', normal: 'Normal', above_normal: 'AboveNormal', high: 'High' };
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pid} -ErrorAction Stop | ForEach-Object { $_.PriorityClass='${map[priority]}' }`], { shell: false, windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
  }
  public async pauseByJob(jobId: string): Promise<void> { for (const [id, p] of this.active) if (p.jobId === jobId) await this.pause(id); }
  public async resumeByJob(jobId: string): Promise<void> { for (const [id, p] of this.active) if (p.jobId === jobId) await this.resume(id); }
  private async pause(id: string): Promise<void> {
    await this.setSuspended(id, true);
  }
  private async resume(id: string): Promise<void> {
    await this.setSuspended(id, false);
  }
  public async kill(id: string): Promise<void> {
    const m = this.active.get(id); if (!m?.process.pid) return;
    if (process.platform === 'win32') {
      const child = spawn('taskkill.exe', ['/PID', String(m.process.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => code === 0 || code === 128
          ? resolve()
          : reject(new Error(`taskkill thất bại với mã ${code ?? -1}.`)));
      });
    } else m.process.kill('SIGKILL');
  }
  public async killByJob(jobId: string): Promise<void> { for (const [id, p] of this.active) if (p.jobId === jobId) await this.kill(id); }
  public async shutdown(): Promise<void> { await Promise.all([...this.active.keys()].map((id) => this.kill(id))); }

  private async setSuspended(id: string, suspended: boolean): Promise<void> {
    const managed = this.active.get(id);
    if (!managed?.process.pid) return;

    const requestedControl = managed.controlTail.then(async () => {
      if (this.active.get(id) !== managed || !managed.process.pid) return;
      if (managed.suspended === suspended) return;

      if (process.platform === 'win32') {
        await this.controlWindowsProcessTree(
          managed.process.pid,
          suspended ? 'pause' : 'resume'
        );
      } else {
        managed.process.kill(suspended ? 'SIGSTOP' : 'SIGCONT');
      }

      managed.suspended = suspended;
    });

    managed.controlTail = requestedControl.catch(() => undefined);
    await requestedControl;
  }

  private async controlWindowsProcessTree(pid: number, action: 'pause' | 'resume'): Promise<void> {
    const operation = action === 'pause' ? 'tạm dừng' : 'tiếp tục';
    await this.runPowerShell(
      buildWindowsProcessControlScript(pid, action),
      `Không thể ${operation} tiến trình nền`
    );
  }

  private async runPowerShell(command: string, failureMessage: string): Promise<void> {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const detail = stderr.trim();
        reject(new Error(detail ? `${failureMessage}: ${detail}` : `${failureMessage} (mã ${code ?? -1}).`));
      });
    });
  }
}
