import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export type JobCpuCapGroup = 'default' | 'background-encode';

/**
 * Diệt cả cây tiến trình con trên Windows (`taskkill /PID <pid> /T /F`) có giới hạn thời gian an toàn,
 * để không để sót tiến trình con bên trong (ví dụ Python con của PyInstaller `yt-dlp.exe`, `ffmpeg`, `aria2c`).
 */
export async function killProcessTreeBestEffort(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  const pid = child.pid;
  if (!pid || pid <= 0) {
    try {
      child.kill();
    } catch {
      // ignore
    }
    return;
  }
  if (process.platform !== 'win32') {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    return;
  }
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    });
    const timer = setTimeout(() => {
      try {
        killer.kill();
      } catch {
        // ignore
      }
      finish();
    }, timeoutMs);
    timer.unref?.();
    killer.once('error', finish);
    killer.once('close', finish);
  });
}

function buildJobHostPowerShellScript(ownerPid: number): string {
  const safeOwnerPid = Math.max(1, Math.trunc(ownerPid));
  return `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (-not ('Tubmedia.WindowsJobHostNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace Tubmedia {
  public static class WindowsJobHostNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
      public long PerProcessUserTimeLimit;
      public long PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass;
      public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
      public IO_COUNTERS IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_CPU_RATE_CONTROL_INFORMATION {
      public uint ControlFlags;
      public uint CpuRate;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32W {
      public uint dwSize;
      public uint cntUsage;
      public uint th32ProcessID;
      public UIntPtr th32DefaultHeapID;
      public uint th32ModuleID;
      public uint cntThreads;
      public uint th32ParentProcessID;
      public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
      public string szExeFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    public static extern uint GetActiveProcessorCount(ushort groupNumber);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    private static IntPtr hDefaultJob = IntPtr.Zero;
    private static IntPtr hEncodeJob = IntPtr.Zero;

    private static IntPtr CreateKillOnCloseJob() {
      IntPtr hJob = CreateJobObjectW(IntPtr.Zero, null);
      if (hJob == IntPtr.Zero) return IntPtr.Zero;
      var ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      ext.BasicLimitInformation.LimitFlags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (không đặt BREAKAWAY_OK)
      int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
      IntPtr ptr = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(ext, ptr, false);
        SetInformationJobObject(hJob, 9, ptr, (uint)size);
      } finally {
        Marshal.FreeHGlobal(ptr);
      }
      return hJob;
    }

    public static uint Initialize(int ownerPid) {
      IntPtr hOwner = OpenProcess(0x00100000, false, ownerPid); // SYNCHRONIZE
      if (hOwner == IntPtr.Zero) {
        Environment.Exit(0);
      }
      var watcher = new Thread(() => {
        WaitForSingleObject(hOwner, 0xFFFFFFFF);
        Environment.Exit(0);
      });
      watcher.IsBackground = true;
      watcher.Start();

      hDefaultJob = CreateKillOnCloseJob();
      hEncodeJob = CreateKillOnCloseJob();
      uint cpus = GetActiveProcessorCount(0xFFFF);
      return cpus > 0 ? cpus : (uint)Environment.ProcessorCount;
    }

    private static void AssignSinglePid(IntPtr hJob, int pid) {
      if (hJob == IntPtr.Zero || pid <= 0) return;
      IntPtr hProc = OpenProcess(0x0101, false, pid); // PROCESS_SET_QUOTA | PROCESS_TERMINATE
      if (hProc == IntPtr.Zero) return;
      try {
        AssignProcessToJobObject(hJob, hProc);
      } finally {
        CloseHandle(hProc);
      }
    }

    public static void AssignTree(int rootPid, bool encodeGroup) {
      IntPtr targetJob = encodeGroup ? hEncodeJob : hDefaultJob;
      if (targetJob == IntPtr.Zero || rootPid <= 0) return;
      AssignSinglePid(targetJob, rootPid);

      IntPtr snap = CreateToolhelp32Snapshot(0x00000002, 0); // TH32CS_SNAPPROCESS
      if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return;
      try {
        var childrenMap = new Dictionary<int, List<int>>();
        var entry = new PROCESSENTRY32W();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
        if (Process32FirstW(snap, ref entry)) {
          do {
            int pid = (int)entry.th32ProcessID;
            int ppid = (int)entry.th32ParentProcessID;
            if (pid > 0 && ppid > 0 && pid != ppid) {
              List<int> list;
              if (!childrenMap.TryGetValue(ppid, out list)) {
                list = new List<int>();
                childrenMap[ppid] = list;
              }
              list.Add(pid);
            }
          } while (Process32NextW(snap, ref entry));
        }
        var queue = new Queue<int>();
        var visited = new HashSet<int> { rootPid };
        queue.Enqueue(rootPid);
        while (queue.Count > 0) {
          int current = queue.Dequeue();
          List<int> kids;
          if (!childrenMap.TryGetValue(current, out kids)) continue;
          foreach (int kid in kids) {
            if (!visited.Add(kid)) continue;
            AssignSinglePid(targetJob, kid);
            queue.Enqueue(kid);
          }
        }
      } finally {
        CloseHandle(snap);
      }
    }

    public static void SetEncodeCpuCap(uint rateTenThousandths) {
      if (hEncodeJob == IntPtr.Zero) return;
      var info = new JOBOBJECT_CPU_RATE_CONTROL_INFORMATION();
      if (rateTenThousandths > 0 && rateTenThousandths < 10000) {
        info.ControlFlags = 0x00000005; // ENABLE | HARD_CAP
        info.CpuRate = rateTenThousandths;
      } else {
        info.ControlFlags = 0;
        info.CpuRate = 0;
      }
      int size = Marshal.SizeOf(typeof(JOBOBJECT_CPU_RATE_CONTROL_INFORMATION));
      IntPtr ptr = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(info, ptr, false);
        SetInformationJobObject(hEncodeJob, 15, ptr, (uint)size);
      } finally {
        Marshal.FreeHGlobal(ptr);
      }
    }
  }
}
'@
}
$totalCpus = [Tubmedia.WindowsJobHostNative]::Initialize(${safeOwnerPid})
[Console]::Out.WriteLine("READY|$totalCpus")
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim().Split(' ')
  if ($parts.Length -eq 0 -or $parts[0] -eq '') { continue }
  $cmd = $parts[0]
  if ($cmd -eq 'EXIT') { break }
  if ($cmd -eq 'ASSIGN' -and $parts.Length -ge 3) {
    $targetPid = 0
    if ([int]::TryParse($parts[1], [ref]$targetPid) -and $targetPid -gt 0) {
      [Tubmedia.WindowsJobHostNative]::AssignTree($targetPid, ($parts[2] -eq 'ENCODE'))
    }
    $reqId = if ($parts.Length -ge 4) { $parts[3] } else { '' }
    if ($reqId) { [Console]::Out.WriteLine("OK|$reqId") } else { [Console]::Out.WriteLine('OK') }
    [Console]::Out.Flush()
    continue
  }
  if ($cmd -eq 'CAP' -and $parts.Length -ge 2) {
    $rate = [uint32]0
    if ([uint32]::TryParse($parts[1], [ref]$rate)) {
      [Tubmedia.WindowsJobHostNative]::SetEncodeCpuCap($rate)
    }
    continue
  }
}
`;
}

function setStreamRef(stream: unknown, ref: boolean): void {
  if (typeof stream === 'object' && stream !== null) {
    const key = ref ? 'ref' : 'unref';
    if (key in stream) {
      const fn = (stream as Record<string, unknown>)[key];
      if (typeof fn === 'function') (fn as () => void).call(stream);
    }
  }
}

/**
 * 1.7.7 (việc C + A): Quản lý Windows Job Object dùng chung cho tiến trình con của Tubmedia:
 * - `KILL_ON_JOB_CLOSE`: khi tiến trình chủ bị tắt ngang (Task Manager End Task, sập, `app.exit`), Windows tự đóng
 *   các cây tiến trình con (`yt-dlp`, `ffmpeg`, `ffprobe`, `aria2c`) trong vài chục mili-giây mà không đụng tệp `.part`
 *   và không ảnh hưởng trình cài đặt NSIS chạy độc lập bên ngoài `ProcessManager`.
 * - `JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP`: giới hạn cứng % CPU động có sàn cho nhóm mã hoá nền (`background-encode`).
 */
export class WindowsJobHost {
  private child: ChildProcess | null = null;
  private readyPromise: Promise<void> | null = null;
  private systemLogicalCpus = 0;
  private nextReqId = 1;
  private readonly pendingAcks = new Map<number, () => void>();
  private desiredCap: { percentOfAppCpus: number | null; appLogicalCpus: number } = {
    percentOfAppCpus: null,
    appLogicalCpus: 0
  };
  private appliedCapRate = 0;
  private disposed = false;

  public constructor(
    private readonly enabled = process.platform === 'win32' &&
      (!process.env.VITEST || process.env.TUBMEDIA_ENABLE_JOB_HOST === '1')
  ) {}

  public isEnabled(): boolean {
    return this.enabled && !this.disposed;
  }

  public ensureReady(): Promise<void> {
    if (!this.enabled || this.disposed) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        if (this.pendingAcks.size === 0) {
          setStreamRef(this.child?.stdout, false);
        }
        resolve();
      };
      const startupTimer = setTimeout(finish, 4_000);

      try {
        const encoded = Buffer.from(buildJobHostPowerShellScript(process.pid), 'utf16le').toString('base64');
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
          {
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'ignore']
          }
        );
        this.child = child;
        child.unref();
        setStreamRef(child.stdin, false);

        child.stdin?.on('error', () => undefined);
        if (child.stdout) {
          const rl = createInterface({ input: child.stdout });
          rl.on('line', (rawLine) => {
            const line = rawLine.trim();
            if (line.startsWith('READY|')) {
              const parsedCpus = Number(line.slice('READY|'.length));
              this.systemLogicalCpus = Number.isFinite(parsedCpus) && parsedCpus > 0 ? parsedCpus : 0;
              this.syncEncodeCapToHost();
              finish();
              return;
            }
            if (line.startsWith('OK|')) {
              const reqId = Number(line.slice('OK|'.length));
              const ack = this.pendingAcks.get(reqId);
              if (ack) {
                this.pendingAcks.delete(reqId);
                ack();
              }
              return;
            }
            if (line === 'OK') {
              const first = this.pendingAcks.entries().next().value;
              if (first) {
                this.pendingAcks.delete(first[0]);
                first[1]();
              }
            }
          });
        }
        const onDead = (): void => {
          if (this.child === child) {
            this.child = null;
            this.readyPromise = null;
            this.appliedCapRate = 0;
          }
          for (const ack of this.pendingAcks.values()) {
            ack();
          }
          this.pendingAcks.clear();
          finish();
        };
        child.once('error', onDead);
        child.once('exit', onDead);
      } catch {
        this.child = null;
        this.readyPromise = null;
        finish();
      }
    });

    return this.readyPromise;
  }

  public async assignProcess(pid: number, group: JobCpuCapGroup = 'default'): Promise<void> {
    if (!this.enabled || this.disposed || !Number.isSafeInteger(pid) || pid <= 0) return;
    await this.ensureReady();
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;

    const reqId = this.nextReqId++;
    await new Promise<void>((resolve) => {
      let done = false;
      const complete = (): void => {
        if (done) return;
        done = true;
        clearTimeout(ackTimer);
        this.pendingAcks.delete(reqId);
        if (this.pendingAcks.size === 0) {
          setStreamRef(this.child?.stdout, false);
        }
        resolve();
      };
      const ackTimer = setTimeout(() => {
        complete();
      }, 1_500);

      this.pendingAcks.set(reqId, complete);
      setStreamRef(this.child?.stdout, true);
      const tag = group === 'background-encode' ? 'ENCODE' : 'DEFAULT';
      try {
        stdin.write(`ASSIGN ${pid} ${tag} ${reqId}\n`);
      } catch {
        complete();
      }
    });
  }

  /**
   * Đặt trần cứng CPU cho toàn bộ tiến trình thuộc nhóm `background-encode`, tính theo % số luồng logic
   * mà ứng dụng đang sử dụng (`null` hoặc `>= 100` để gỡ trần).
   */
  public setEncodeCpuCapPercent(percentOfAppCpus: number | null, appLogicalCpus: number): void {
    this.desiredCap = { percentOfAppCpus, appLogicalCpus };
    if (!this.enabled || this.disposed) return;
    if (percentOfAppCpus !== null && percentOfAppCpus > 0 && percentOfAppCpus < 100 && !this.child) {
      void this.ensureReady();
      return;
    }
    this.syncEncodeCapToHost();
  }

  public dispose(): void {
    this.disposed = true;
    for (const ack of this.pendingAcks.values()) {
      ack();
    }
    this.pendingAcks.clear();
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.appliedCapRate = 0;
    if (!child) return;
    try {
      child.stdin?.write('EXIT\n');
      child.stdin?.end();
    } catch {
      // ignore
    }
    if (child.exitCode === null) {
      const killTimer = setTimeout(() => {
        try {
          if (child.exitCode === null) child.kill();
        } catch {
          // ignore
        }
      }, 300);
      killTimer.unref?.();
    }
  }

  private syncEncodeCapToHost(): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    const { percentOfAppCpus, appLogicalCpus } = this.desiredCap;
    let rate = 0;
    if (percentOfAppCpus !== null && Number.isFinite(percentOfAppCpus) && percentOfAppCpus > 0 && percentOfAppCpus < 100) {
      const totalCpus = this.systemLogicalCpus > 0 ? this.systemLogicalCpus : Math.max(1, appLogicalCpus);
      const scale = Math.min(1, Math.max(1, appLogicalCpus) / Math.max(1, totalCpus));
      rate = Math.max(1, Math.min(9_999, Math.round(percentOfAppCpus * 100 * scale)));
    }
    if (rate === this.appliedCapRate) return;
    this.appliedCapRate = rate;
    try {
      stdin.write(`CAP ${rate}\n`);
    } catch {
      // ignore
    }
  }
}

export const defaultWindowsJobHost = new WindowsJobHost();
