import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * 2026-11-05 (người dùng duyệt, sửa B): đo CPU THẬT của các ffmpeg mã hoá nền do chính app chạy, để bộ điều tiết tải không coi
 * phần đó là "máy đang bận" — đo giả lập máy 4 luồng: 1 bản mã hoá chiếm 93% CPU → bộ điều tiết chặn mọi video tải mới.
 *
 * Chỉ đọc, cùng cách DiskBusyMonitor: một PowerShell ẩn đọc lớp WMI Win32_PerfFormattedData_PerfProc_Process (tên lớp không
 * đổi theo ngôn ngữ Windows) cho các tiến trình tên ffmpeg mỗi 3 s. PercentProcessorTime tính theo MỘT luồng (4 luồng chạy
 * hết = 400). Chỉ chạy khi đang có bản mã hoá; ngoài Windows hoặc lỗi → 0 (không trừ gì, bộ điều tiết như cũ).
 */
function pollScript(ownerPid: number): string {
  return (
    "$ErrorActionPreference = 'SilentlyContinue'; " +
    `while (Get-Process -Id ${Math.trunc(ownerPid)}) { ` +
    "$rows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter \"Name LIKE 'ffmpeg%'\" | " +
    'Select-Object IDProcess,PercentProcessorTime; ConvertTo-Json -Compress -InputObject @($rows); Start-Sleep -Seconds 3 }'
  );
}

/** Số đo cũ hơn chừng này coi như không có (tiến trình đo bị treo/chết). */
const STALE_MS = 20_000;

/** Một dòng JSON của pollScript → { PID → % CPU tính theo một luồng }. Dòng hỏng / thiếu số bị bỏ qua. */
export function parseProcessCpuLine(line: string): Map<number, number> {
  const cpu = new Map<number, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return cpu;
  }
  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    if (typeof row !== 'object' || row === null) continue;
    const pid = (row as Record<string, unknown>).IDProcess;
    const percent = (row as Record<string, unknown>).PercentProcessorTime;
    if (typeof pid !== 'number' || typeof percent !== 'number' || !Number.isFinite(percent)) continue;
    cpu.set(pid, Math.max(0, percent));
  }
  return cpu;
}

export class EncodeCpuMonitor {
  private child: ChildProcess | null = null;
  private latest = new Map<number, number>();
  private latestAt = 0;

  /** Mặc định chỉ chạy trên Windows; tắt khi chạy bài kiểm vitest. */
  public constructor(private readonly enabled = process.platform === 'win32' && process.env.VITEST === undefined) {}

  public ensureRunning(): void {
    if (!this.enabled || this.child) return;
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', pollScript(process.pid)], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      this.child = child;
      if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => this.accept(line, Date.now()));
      child.on('error', () => this.reset(child));
      child.on('exit', () => this.reset(child));
    } catch {
      this.child = null;
    }
  }

  /** Dừng đo (hết bản mã hoá, hoặc app đóng). Chỉ dừng đúng tiến trình mình tạo. */
  public stop(): void {
    const child = this.child;
    this.child = null;
    this.latest = new Map();
    this.latestAt = 0;
    if (child && child.exitCode === null) child.kill();
  }

  /** Tổng CPU của các PID đã cho, quy về % toàn máy (0–100). Không có số đo mới → 0. */
  public machinePercentOf(pids: Iterable<number>, logicalCpus: number, now = Date.now()): number {
    if (!this.latestAt || now - this.latestAt > STALE_MS) return 0;
    let sum = 0;
    for (const pid of pids) sum += this.latest.get(pid) ?? 0;
    return Math.min(100, sum / Math.max(1, logicalCpus));
  }

  /** Nhận một dòng số đo (tách riêng để bài kiểm đưa số đo vào mà không cần chạy PowerShell). */
  public accept(line: string, at: number): void {
    const parsed = parseProcessCpuLine(line);
    if (!parsed.size && line.trim() !== '[]') return;
    this.latest = parsed;
    this.latestAt = at;
  }

  private reset(child: ChildProcess): void {
    if (this.child === child) this.child = null;
  }
}
