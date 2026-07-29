import { execFile } from 'node:child_process';
import { arch, cpus, freemem, hostname, platform, release, totalmem } from 'node:os';
import { promisify } from 'node:util';
import type { HardwareProfile, ResourceProfile } from '@shared/types/domain.js';
import { recommendDownloadConcurrency } from '@shared/utils/hardware-recommendation.js';

const execFileAsync = promisify(execFile);

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(stringValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function powershellJson(script: string): Promise<unknown> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `${script} | ConvertTo-Json -Compress -Depth 5`
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 2_000_000 }
    );
    return JSON.parse(stdout.trim()) as unknown;
  } catch {
    return null;
  }
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    );
  }
  return typeof value === 'object' && value !== null
    ? [value as Record<string, unknown>]
    : [];
}

export class HardwareService {
  public quickSnapshot(): HardwareProfile {
    const cpuList = cpus();
    return {
      platform: platform(),
      release: release(),
      architecture: arch(),
      hostname: hostname(),
      physicalCpuCount: Math.max(1, Math.floor(cpuList.length / 2)),
      logicalCpuCount: cpuList.length,
      cpuModel: cpuList[0]?.model ?? 'Bộ xử lý không xác định',
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      gpuAdapters: [],
      disks: [],
      detectedAt: new Date().toISOString()
    };
  }

  public async detect(): Promise<HardwareProfile> {
    const quick = this.quickSnapshot();
    const cpuList = cpus();
    const [coreData, gpuData, diskData] = await Promise.all([
      powershellJson(
        'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors'
      ),
      powershellJson(
        'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion'
      ),
      powershellJson(
        'Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,Size,SizeRemaining,DriveType'
      )
    ]);

    const cores = asRows(coreData);
    const gpus = asRows(gpuData);
    const disks = asRows(diskData);
    const cpuModel = stringValue(cores[0]?.Name, cpuList[0]?.model ?? 'Bộ xử lý không xác định');

    return {
      platform: quick.platform,
      release: quick.release,
      architecture: quick.architecture,
      hostname: quick.hostname,
      physicalCpuCount:
        cores.reduce((sum, item) => sum + numberValue(item.NumberOfCores), 0) ||
        Math.max(1, Math.floor(cpuList.length / 2)),
      logicalCpuCount: cpuList.length,
      cpuModel,
      totalMemoryBytes: quick.totalMemoryBytes,
      freeMemoryBytes: quick.freeMemoryBytes,
      gpuAdapters: gpus.map((gpu) => ({
        name: stringValue(gpu.Name, 'Bộ xử lý đồ họa không xác định'),
        memoryBytes: gpu.AdapterRAM === undefined ? null : numberValue(gpu.AdapterRAM),
        driverVersion: stringValue(gpu.DriverVersion) || null
      })),
      disks: disks.map((disk) => {
        const driveLetter = stringValue(disk.DriveLetter, '?');
        return {
          device: `${driveLetter}:`,
          mount: `${driveLetter}:\\`,
          type: 'unknown' as const,
          totalBytes: numberValue(disk.Size),
          freeBytes: numberValue(disk.SizeRemaining)
        };
      }),
      detectedAt: new Date().toISOString()
    };
  }

  public recommend(profile: HardwareProfile): ResourceProfile {
    const logical = profile.logicalCpuCount;
    const ramGb = profile.totalMemoryBytes / 1024 ** 3;
    const workstation = logical >= 32 && ramGb >= 64;
    const low = logical <= 8 || ramGb <= 16;
    const concurrency = recommendDownloadConcurrency(profile);

    const hasNvidiaGpu = profile.gpuAdapters.some((adapter) => /nvidia|geforce|quadro|rtx|gtx/i.test(adapter.name));
    const normalizeWorkers = low ? 1 : workstation ? 3 : logical >= 16 && ramGb >= 24 ? 2 : 1;

    return {
      id: `resource-auto-${Date.now()}`,
      name: 'Tự động theo máy',
      description: `${concurrency.summary} Phát hiện ${logical} logical processors, ${Math.round(ramGb)} GB RAM${hasNvidiaGpu ? ' và GPU NVIDIA' : ''}. Chỉ dùng GPU khi FFmpeg kiểm tra encoder thành công; nếu lỗi sẽ tự quay về CPU.`,
      downloadWorkers: concurrency.recommendedPerListWorkers,
      analyzeWorkers: low ? 1 : 2,
      normalizeWorkers,
      remuxWorkers: workstation ? 4 : normalizeWorkers >= 2 ? 2 : 1,
      clipWorkers: 1,
      ffmpegThreads: low
        ? Math.max(2, Math.floor(logical / 2))
        : workstation
          ? 8
          : Math.min(6, Math.max(4, Math.floor(logical / 3))),
      filterThreads: low ? 1 : workstation ? 4 : 3,
      filterComplexThreads: low ? 1 : workstation ? 4 : 3,
      processPriority: 'below_normal',
      cpuSoftLimitPercent: 88,
      memoryFreeMinimumBytes:
        Math.min(8, Math.max(4, Math.floor(ramGb * 0.08))) * 1024 ** 3,
      diskFreeMinimumBytes: 20 * 1024 ** 3,
      gpuJobs: hasNvidiaGpu ? (workstation ? 2 : 1) : 0,
      builtIn: false
    };
  }
}
