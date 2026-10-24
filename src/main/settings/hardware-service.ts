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

/**
 * #5 (khám phá bản cài 2026-10-05): os.cpus() trên Windows chỉ đếm MỘT nhóm bộ xử lý (processor group) —
 * máy 2 × Xeon 18 nhân/36 luồng báo 36 thay vì 72. Cộng NumberOfLogicalProcessors/NumberOfCores của MỌI CPU
 * mà WMI trả về; WMI lỗi thì lùi về os.cpus() như trước. Không bao giờ báo ít luồng hơn số Node đã thấy.
 */
export function cpuCountsFromWmi(
  rows: Array<Record<string, unknown>>,
  osLogicalCount: number
): { logical: number; physical: number } {
  const osLogical = Math.max(1, osLogicalCount);
  const wmiLogical = rows.reduce((sum, row) => sum + Math.max(0, numberValue(row.NumberOfLogicalProcessors)), 0);
  const wmiPhysical = rows.reduce((sum, row) => sum + Math.max(0, numberValue(row.NumberOfCores)), 0);
  return {
    logical: Math.max(osLogical, wmiLogical),
    physical: wmiPhysical > 0 ? wmiPhysical : Math.max(1, Math.floor(osLogical / 2))
  };
}

type DiskType = HardwareProfile['disks'][number]['type'];

/**
 * 2026-10-24 (nguyên tắc tự dò theo máy): trước đây mọi ổ luôn ghi loại 'unknown', nên lời khuyên HDD/SSD của bảng đề xuất
 * không bao giờ chạy. Loại ổ của một ký tự ổ lấy từ ổ vật lý chứa phân vùng đó (Get-Partition → Get-PhysicalDisk):
 * MediaType HDD → hdd; SSD/SCM → ssd; không rõ mà nối qua NVMe → ssd (NVMe luôn là bộ nhớ thể rắn). Còn lại (ổ mạng, ổ ảo,
 * Storage Spaces, USB không báo loại…) giữ 'unknown' — không đoán.
 */
export function diskTypeOf(mediaType: unknown, busType: unknown): DiskType {
  const media = stringValue(mediaType).trim().toLowerCase();
  // Một số bản PowerShell trả số của MSFT_PhysicalDisk.MediaType thay vì tên: 3 = HDD, 4 = SSD, 5 = SCM.
  if (media === 'hdd' || media === '3') return 'hdd';
  if (media === 'ssd' || media === 'scm' || media === '4' || media === '5') return 'ssd';
  const bus = stringValue(busType).trim().toLowerCase();
  if (bus === 'nvme' || bus === '17') return 'ssd';
  return 'unknown';
}

/** { "C" → loại ổ } từ kết quả dò phân vùng; ký tự ổ viết hoa, bỏ dòng thiếu ký tự ổ. */
export function diskTypesByDriveLetter(rows: Array<Record<string, unknown>>): Map<string, DiskType> {
  const types = new Map<string, DiskType>();
  for (const row of rows) {
    const letter = stringValue(row.DriveLetter).trim().toUpperCase();
    if (!/^[A-Z]$/.test(letter)) continue;
    types.set(letter, diskTypeOf(row.MediaType, row.BusType));
  }
  return types;
}

/**
 * Mã cố định cho hồ sơ đề xuất tự động: áp dụng lại chỉ ghi đè đúng một hồ sơ. Trước đây mỗi lần áp dụng
 * lưu thêm `resource-auto-<thời điểm>` cùng tên, dồn thành nhiều hồ sơ trùng tên (khám phá bản cài #6).
 */
export const AUTO_RESOURCE_PROFILE_ID = 'resource-auto';
export const AUTO_RESOURCE_PROFILE_NAME = 'Tự động theo máy';

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
    const [coreData, gpuData, diskData, diskTypeData] = await Promise.all([
      powershellJson(
        'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors'
      ),
      powershellJson(
        'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion'
      ),
      powershellJson(
        'Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,Size,SizeRemaining,DriveType'
      ),
      // Chỉ đọc: ký tự ổ → ổ vật lý chứa nó (loại ổ + chuẩn nối). Lỗi/không có quyền thì mọi ổ giữ 'unknown' như trước.
      powershellJson(
        "Get-Partition | Where-Object DriveLetter | ForEach-Object { $physical = Get-PhysicalDisk | Where-Object DeviceId -eq ([string]$_.DiskNumber) | Select-Object -First 1; [pscustomobject]@{ DriveLetter = [string]$_.DriveLetter; MediaType = [string]$physical.MediaType; BusType = [string]$physical.BusType } }"
      )
    ]);

    const cores = asRows(coreData);
    const gpus = asRows(gpuData);
    const disks = asRows(diskData);
    const diskTypes = diskTypesByDriveLetter(asRows(diskTypeData));
    const cpuModel = stringValue(cores[0]?.Name, cpuList[0]?.model ?? 'Bộ xử lý không xác định');
    const cpuCounts = cpuCountsFromWmi(cores, cpuList.length);

    return {
      platform: quick.platform,
      release: quick.release,
      architecture: quick.architecture,
      hostname: quick.hostname,
      physicalCpuCount: cpuCounts.physical,
      logicalCpuCount: cpuCounts.logical,
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
          type: diskTypes.get(driveLetter.toUpperCase()) ?? 'unknown',
          totalBytes: numberValue(disk.Size),
          freeBytes: numberValue(disk.SizeRemaining)
        };
      }),
      detectedAt: new Date().toISOString()
    };
  }

  public recommend(profile: HardwareProfile): ResourceProfile {
    const logical = profile.logicalCpuCount;
    const totalRamGb = profile.totalMemoryBytes / 1024 ** 3;
    // VẤN ĐỀ 2 mục 4 (2026-09-22): số worker/luồng dựa theo RAM CÒN TRỐNG lúc bấm "Tạo đề xuất tự động",
    // khớp với recommendDownloadConcurrency (cùng dùng freeMemoryBytes) — tránh đề xuất như máy đang
    // rảnh khi RAM thực tế đang bị việc khác chiếm phần lớn.
    const ramGb = profile.freeMemoryBytes / 1024 ** 3;
    const workstation = logical >= 32 && ramGb >= 64;
    const low = logical <= 8 || ramGb <= 16;
    const concurrency = recommendDownloadConcurrency(profile);

    const hasNvidiaGpu = profile.gpuAdapters.some((adapter) => /nvidia|geforce|quadro|rtx|gtx/i.test(adapter.name));
    const normalizeWorkers = low ? 1 : workstation ? 3 : logical >= 16 && ramGb >= 24 ? 2 : 1;

    return {
      id: AUTO_RESOURCE_PROFILE_ID,
      name: AUTO_RESOURCE_PROFILE_NAME,
      description: `${concurrency.summary} Phát hiện ${logical} logical processors, ${Math.round(totalRamGb)} GB RAM (còn trống ${Math.round(ramGb)} GB lúc quét)${hasNvidiaGpu ? ' và GPU NVIDIA' : ''}. Chỉ dùng GPU khi FFmpeg kiểm tra encoder thành công; nếu lỗi sẽ tự quay về CPU.`,
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
