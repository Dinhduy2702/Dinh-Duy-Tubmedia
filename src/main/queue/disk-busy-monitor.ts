import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Đề xuất A (2026-10-24): đo độ bận THẬT của các ổ đang nhận video, để bộ tự tăng tốc lùi lại khi ổ lưu của người dùng nghẽn
 * — bất kể ổ đó là C, D, E, SSD, HDD hay ổ ngoài; không đoán theo loại ổ.
 *
 * Chỉ đọc: một tiến trình PowerShell ẩn đọc lớp WMI Win32_PerfFormattedData_PerfDisk_PhysicalDisk mỗi 5 s (tên lớp WMI không
 * đổi theo ngôn ngữ Windows, khác với tên bộ đếm của typeperf/Get-Counter). Chỉ chạy khi đang có video tải; ngoài Windows
 * hoặc lỗi → không có số đo (bộ tự tăng tốc vẫn chạy theo tốc độ thật, chỉ thiếu tín hiệu ổ).
 */
/** Vòng đo tự thoát khi tiến trình app (ownerPid) không còn — app có đóng đột ngột cũng không để lại tiến trình mồ côi. */
function pollScript(ownerPid: number): string {
  return (
    "$ErrorActionPreference = 'SilentlyContinue'; " +
    `while (Get-Process -Id ${Math.trunc(ownerPid)}) { ` +
    "$rows = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object Name -ne '_Total' | " +
    'Select-Object Name,PercentIdleTime; ConvertTo-Json -Compress -InputObject @($rows); Start-Sleep -Seconds 5 }'
  );
}

/** Số đo cũ hơn chừng này coi như không có (tiến trình đo bị treo/chết). */
const STALE_MS = 20_000;

/**
 * Một dòng JSON của POLL_SCRIPT → { ký tự ổ → độ bận % }. Tên ổ vật lý dạng "0 E:" hoặc "1 C: D:" (nhiều phân vùng chung một
 * ổ — cùng độ bận). Ổ không có ký tự (chưa gán, gắn vào thư mục) bị bỏ qua.
 */
export function parseDiskBusyLine(line: string): Map<string, number> {
  const busy = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return busy;
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const rawName = (row as Record<string, unknown>).Name;
    const name = typeof rawName === 'string' ? rawName : '';
    const idle = Number((row as Record<string, unknown>).PercentIdleTime);
    if (!Number.isFinite(idle)) continue;
    const value = Math.max(0, Math.min(100, 100 - idle));
    for (const match of name.matchAll(/([A-Za-z]):/g)) busy.set(match[1]!.toUpperCase(), value);
  }
  return busy;
}

export class DiskBusyMonitor {
  private child: ChildProcess | null = null;
  private latest = new Map<string, number>();
  private latestAt = 0;

  /** Mặc định chỉ chạy trên Windows; tắt khi chạy bài kiểm vitest (mỗi QueueManager trong bài kiểm sẽ mở một PowerShell). */
  public constructor(private readonly enabled = process.platform === 'win32' && process.env.VITEST === undefined) {}

  /** Bắt đầu đo nếu chưa chạy (gọi mỗi lượt có video tải — rẻ). */
  public ensureRunning(): void {
    if (!this.enabled || this.child) return;
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', pollScript(process.pid)], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      this.child = child;
      if (child.stdout) {
        createInterface({ input: child.stdout }).on('line', (line) => this.accept(line, Date.now()));
      }
      child.on('error', () => this.reset(child));
      child.on('exit', () => this.reset(child));
    } catch {
      this.child = null;
    }
  }

  /** Dừng đo (hết video tải, hoặc app đóng). Chỉ dừng đúng tiến trình mình tạo. */
  public stop(): void {
    const child = this.child;
    this.child = null;
    this.latest = new Map();
    this.latestAt = 0;
    if (child && child.exitCode === null) child.kill();
  }

  /** Độ bận cao nhất trong các ổ đã cho; null nếu không đo được ổ nào (ổ mạng, chưa có số đo, ngoài Windows). */
  public busiestOf(letters: Iterable<string>, now = Date.now()): number | null {
    if (!this.latestAt || now - this.latestAt > STALE_MS) return null;
    let busiest: number | null = null;
    for (const letter of letters) {
      const value = this.latest.get(letter.toUpperCase());
      if (value !== undefined) busiest = busiest === null ? value : Math.max(busiest, value);
    }
    return busiest;
  }

  /** Nhận một dòng số đo (tách riêng để bài kiểm đưa số đo vào mà không cần chạy PowerShell). */
  public accept(line: string, at: number): void {
    const parsed = parseDiskBusyLine(line);
    if (!parsed.size) return;
    this.latest = parsed;
    this.latestAt = at;
  }

  private reset(child: ChildProcess): void {
    if (this.child === child) this.child = null;
  }
}
