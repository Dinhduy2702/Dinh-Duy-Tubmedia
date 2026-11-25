import { spawn } from 'node:child_process';
import { lstat, open, stat, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, parse, relative, resolve } from 'node:path';
import type {
  AppSettings,
  SourceCleanupKeptItem,
  SourceCleanupKeptReason,
  SourceCleanupPreview,
  SourceCleanupResult
} from '@shared/types/domain.js';
import type { ItemRepository } from '../database/repositories/item-repository.js';
import type { MediaSourceRepository } from '../database/repositories/media-source-repository.js';
import type { ProjectRepository } from '../database/repositories/project-repository.js';
import type { QueueRepository } from '../database/repositories/queue-repository.js';
import { defaultAppSettings } from '../settings/defaults.js';
import { formatBytes } from '../media/quarantine-service.js';
import {
  collectCapCutDraftReferencedTexts,
  resolveCleanupEnvironmentPaths,
  type CleanupEnvironmentPaths
} from '../system/cleanup-scanner.js';
import { buildCleanupProtection } from './cleanup-protection.js';
import { removeMergeCaches } from './download-temp-cleanup.js';
import { cleanupTemporaryArtifacts } from './temporary-cleanup.js';

export interface RecycleBinCapacityInfo {
  supported: boolean;
  maxBytes: number;
  reason?: string;
}

export interface PostMergeSourceCleanupDeps {
  projects: ProjectRepository;
  items: Pick<ItemRepository, 'list'> & Partial<Pick<ItemRepository, 'setClipFile'>>;
  sources: MediaSourceRepository;
  queue: Pick<QueueRepository, 'list'>;
  settings?: () => Pick<AppSettings, 'defaultSourceFolder' | 'defaultTempFolder' | 'defaultOutputFolder'>;
  envPaths?: () => CleanupEnvironmentPaths;
  readRecycleBinCapacity?: (folderPath: string) => Promise<RecycleBinCapacityInfo>;
  trashItem?: (filePath: string) => Promise<void>;
}

const TUBMEDIA_LINK_TAG_PATTERN = /\[LINK_[0-9A-F]{12}\]/i;
const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(['completed', 'skipped', 'cancelled', 'failed']);

function normKey(filePath: string): string {
  const abs = resolve(filePath);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function isPathInside(rootFolder: string, targetPath: string): boolean {
  const rel = relative(resolve(rootFolder), resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isReferencedInCapCutDrafts(filePath: string, draftTextsLower: readonly string[]): boolean {
  if (draftTextsLower.length === 0) return false;
  const resolved = resolve(filePath).toLowerCase();
  const forward = resolved.replace(/\\/g, '/');
  const escapedBackslash = resolved.replace(/\\/g, '\\\\');
  const nameLower = basename(resolved).toLowerCase();
  for (const text of draftTextsLower) {
    if (
      text.includes(forward) ||
      text.includes(resolved) ||
      text.includes(escapedBackslash) ||
      (nameLower.length >= 16 && text.includes(nameLower))
    ) {
      return true;
    }
  }
  return false;
}

async function defaultTrashItem(filePath: string): Promise<void> {
  const electronModule = await import('electron');
  await electronModule.shell.trashItem(filePath);
}

const RECYCLE_BIN_UNVERIFIED_REASON =
  'Không kiểm tra được sức chứa Thùng rác trên ổ này nên Tubmedia dừng để tránh xóa vĩnh viễn video nguồn';

/**
 * Phân tích kết quả truy vấn `Win32_Volume` + Registry `BitBucket\Volume` theo nguyên tắc fail-closed:
 * nếu chuỗi rỗng, `NO_VOL`, sai định dạng hoặc không tính được hạn mức dương thì trả `supported: false` để không bao giờ xoá nhầm vĩnh viễn.
 */
export function parseWindowsRecycleBinVolumeLine(
  rawLine: string,
  rootDrive: string,
  fallbackFreeBytes = 0
): RecycleBinCapacityInfo {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed === 'NO_VOL' || !trimmed.includes('|')) {
    return {
      supported: false,
      maxBytes: 0,
      reason: RECYCLE_BIN_UNVERIFIED_REASON
    };
  }
  const parts = trimmed.split('|');
  if (parts.length < 6) {
    return {
      supported: false,
      maxBytes: 0,
      reason: RECYCLE_BIN_UNVERIFIED_REASON
    };
  }
  const [dtStr, fsRaw, freeStr, capStr, maxMbStr, nukeStr] = parts;
  const fsName = (fsRaw ?? '').trim().toUpperCase();
  const driveType = Number(dtStr);
  const volFree = Number(freeStr) || fallbackFreeBytes;
  const volCap = Number(capStr) || 0;
  const maxMb = Number(maxMbStr);
  const nuke = Number(nukeStr);

  if (!Number.isFinite(driveType) || !fsName) {
    return {
      supported: false,
      maxBytes: 0,
      reason: RECYCLE_BIN_UNVERIFIED_REASON
    };
  }

  if (nuke === 1) {
    return {
      supported: false,
      maxBytes: 0,
      reason: `Thùng rác trên ổ ${rootDrive} đang bật chế độ "Xóa thẳng không qua Thùng rác". Tubmedia đã dừng để không xóa vĩnh viễn video nguồn.`
    };
  }
  if (driveType !== 3 && driveType !== 2) {
    return {
      supported: false,
      maxBytes: 0,
      reason: `Ổ ${rootDrive} không hỗ trợ Thùng rác Windows nên Tubmedia dừng để bảo vệ video nguồn.`
    };
  }
  if (fsName === 'EXFAT' || fsName === 'FAT' || fsName === 'FAT32') {
    if (driveType === 2) {
      return {
        supported: false,
        maxBytes: 0,
        reason: `Ổ rời ${rootDrive} (${fsName}) không có Thùng rác Windows nên Tubmedia dừng để tránh mất vĩnh viễn tệp nguồn.`
      };
    }
  }
  // Mặc định Windows cấp ~5%–10% dung lượng ổ nếu khoá MaxCapacity chưa ghi tường minh.
  const configuredMaxBytes =
    Number.isFinite(maxMb) && maxMb > 0
      ? maxMb * 1024 * 1024
      : volCap > 0
        ? Math.floor(volCap * 0.05)
        : volFree;
  const effectiveMax = volFree > 0 ? Math.min(configuredMaxBytes, volFree) : configuredMaxBytes;
  if (!(effectiveMax > 0)) {
    return {
      supported: false,
      maxBytes: 0,
      reason: RECYCLE_BIN_UNVERIFIED_REASON
    };
  }
  return { supported: true, maxBytes: effectiveMax };
}

/**
 * Đọc hạn mức thực của Thùng rác (`$Recycle.Bin`) trên ổ chứa `folderPath` (Windows BitBucket\Volume + dung lượng trống ổ).
 * Tuyệt đối không cho phép xoá nếu ổ mạng / exFAT không hỗ trợ Thùng rác, người dùng bật xoá thẳng `NukeOnDelete`,
 * hoặc không đọc được thông tin Thùng rác (fail-closed).
 */
export async function defaultReadRecycleBinCapacity(folderPath: string): Promise<RecycleBinCapacityInfo> {
  const resolved = resolve(folderPath);
  if (resolved.startsWith('\\\\')) {
    return {
      supported: false,
      maxBytes: 0,
      reason: 'Thư mục nguồn nằm trên ổ mạng (UNC) không có Thùng rác Windows nên Tubmedia dừng để tránh mất vĩnh viễn tệp nguồn.'
    };
  }
  let freeBytes = 0;
  try {
    const fsStats = await statfs(resolved);
    freeBytes = fsStats.bavail * fsStats.bsize;
  } catch {
    freeBytes = 0;
  }

  if (process.platform !== 'win32') {
    return { supported: true, maxBytes: freeBytes > 0 ? freeBytes : 10 * 1024 ** 3 };
  }

  const rootDrive = parse(resolved).root.replace(/[\\/]+$/, ''); // vd "E:"
  if (!/^[A-Za-z]:$/.test(rootDrive)) {
    return {
      supported: false,
      maxBytes: 0,
      reason: 'Không xác định được ổ đĩa cục bộ cho Thùng rác nên Tubmedia dừng để bảo vệ tệp nguồn.'
    };
  }

  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$vol = Get-CimInstance Win32_Volume -Filter "DriveLetter='${rootDrive}'"
if (-not $vol) { Write-Output 'NO_VOL'; exit 0 }
$fs = "$($vol.FileSystem)".ToUpperInvariant()
$dt = [int]$vol.DriveType
$free = [int64]$vol.FreeSpace
$cap = [int64]$vol.Capacity
$guidMatch = [regex]::Match("$($vol.DeviceID)", '\\{[0-9a-fA-F\\-]+\\}')
$maxMb = -1
$nuke = 0
if ($guidMatch.Success) {
  $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\$($guidMatch.Value)"
  if (Test-Path -LiteralPath $regPath) {
    $prop = Get-ItemProperty -LiteralPath $regPath
    if ($null -ne $prop.MaxCapacity) { $maxMb = [int64]$prop.MaxCapacity }
    if ($null -ne $prop.NukeOnDelete) { $nuke = [int]$prop.NukeOnDelete }
  }
}
Write-Output "$dt|$fs|$free|$cap|$maxMb|$nuke"
`;

  const rawLine = await new Promise<string>((resolveLine) => {
    let out = '';
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolveLine('');
    }, 8_000);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolveLine('');
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolveLine(out.trim().split(/\r?\n/).at(-1) ?? '');
    });
  });

  return parseWindowsRecycleBinVolumeLine(rawLine, rootDrive, freeBytes);
}

interface InternalCandidate {
  path: string;
  bytes: number;
  sourceIds: string[];
}

interface InternalPlan {
  preview: SourceCleanupPreview;
  candidates: InternalCandidate[];
}

async function buildInternalPlan(projectId: string, deps: PostMergeSourceCleanupDeps): Promise<InternalPlan> {
  const project = deps.projects.get(projectId);
  if (!project) {
    return {
      preview: {
        projectId,
        eligible: false,
        canTrash: false,
        blockedReason: 'Không tìm thấy quy trình ghép.',
        eligibleCount: 0,
        eligibleBytes: 0,
        recycleBinMaxBytes: null,
        keptItems: []
      },
      candidates: []
    };
  }

  const projectJobs = deps.queue.list(projectId);
  if (projectJobs.some((job) => !TERMINAL_JOB_STATUSES.has(job.status))) {
    return {
      preview: {
        projectId,
        eligible: false,
        canTrash: false,
        blockedReason: 'Quy trình này vẫn còn tác vụ đang chạy hoặc tạm dừng nên chưa thể dọn video nguồn.',
        eligibleCount: 0,
        eligibleBytes: 0,
        recycleBinMaxBytes: null,
        keptItems: []
      },
      candidates: []
    };
  }

  const mergeJob = projectJobs.filter((job) => job.type === 'merge').at(-1);
  const timelineOnly = mergeJob?.input.timelineOnly === true;
  const rawOutputPath = typeof mergeJob?.input.outputPath === 'string' ? mergeJob.input.outputPath.trim() : '';
  const rawTimelineTxt = typeof mergeJob?.input.timelineTxt === 'string' ? mergeJob.input.timelineTxt.trim() : '';
  let verifiedFinalExists = false;
  if (mergeJob && (mergeJob.status === 'completed' || mergeJob.status === 'skipped') && !timelineOnly && rawOutputPath) {
    try {
      const outStat = await stat(rawOutputPath);
      verifiedFinalExists = outStat.isFile() && outStat.size > 0;
    } catch {
      verifiedFinalExists = false;
    }
  }

  if (!verifiedFinalExists) {
    return {
      preview: {
        projectId,
        eligible: false,
        canTrash: false,
        blockedReason: timelineOnly
          ? 'Chế độ "Chỉ tạo Timeline (không ghép video)" không tạo video thành phẩm MP4 nên Tubmedia giữ nguyên toàn bộ video nguồn.'
          : 'Quy trình này chưa có tệp video thành phẩm ghép hoàn tất trên ổ đĩa nên chưa thể dọn video nguồn.',
        eligibleCount: 0,
        eligibleBytes: 0,
        recycleBinMaxBytes: null,
        keptItems: []
      },
      candidates: []
    };
  }

  const protectedExactKeys = new Set<string>();
  if (rawOutputPath) protectedExactKeys.add(normKey(rawOutputPath));
  if (rawTimelineTxt) protectedExactKeys.add(normKey(rawTimelineTxt));

  // Thư mục riêng của thành phẩm V13 (<outputFolder>\<tên>\<tên>.mp4) phải được loại trừ cứng nếu sourceFolder === outputFolder.
  const outputParent = rawOutputPath ? resolve(dirname(rawOutputPath)) : '';
  const dedicatedProductFolder =
    outputParent && normKey(outputParent) !== normKey(project.outputFolder) && normKey(dirname(outputParent)) === normKey(project.outputFolder)
      ? outputParent
      : null;

  const allProjects = deps.projects.list(true);
  const otherIncompleteProjectIds = new Set<string>();
  const sourceIdsUsedByOtherIncomplete = new Set<string>();
  for (const other of allProjects) {
    if (other.id === projectId) continue;
    const otherJobs = deps.queue.list(other.id);
    const otherMergeJob = otherJobs.filter((j) => j.type === 'merge').at(-1);
    const otherIsStandaloneOrTimelineOnly =
      !otherMergeJob || otherMergeJob.input.timelineOnly === true;
    const otherCompleted =
      other.status === 'completed' &&
      otherJobs.length > 0 &&
      otherJobs.every((j) => j.status === 'completed' || j.status === 'skipped');
    if (!otherCompleted || otherIsStandaloneOrTimelineOnly) {
      otherIncompleteProjectIds.add(other.id);
      for (const item of deps.items.list(other.id)) {
        if (item.sourceId) sourceIdsUsedByOtherIncomplete.add(item.sourceId);
      }
    }
  }

  const envPaths = (deps.envPaths ?? resolveCleanupEnvironmentPaths)();
  const capcutDraftTexts = await collectCapCutDraftReferencedTexts(envPaths);

  const items = deps.items.list(projectId);
  const byFileKey = new Map<string, { path: string; sourceIds: Set<string> }>();
  for (const item of items) {
    if (!item.sourceId) continue;
    const source = deps.sources.get(item.sourceId);
    if (!source?.sourceFile) continue;
    const key = normKey(source.sourceFile);
    const existing = byFileKey.get(key);
    if (existing) {
      existing.sourceIds.add(source.id);
    } else {
      byFileKey.set(key, { path: resolve(source.sourceFile), sourceIds: new Set([source.id]) });
    }
  }

  const candidates: InternalCandidate[] = [];
  const keptItems: SourceCleanupKeptItem[] = [];

  const pushKept = (filePath: string, bytes: number, reason: SourceCleanupKeptReason, reasonLabel: string): void => {
    keptItems.push({
      path: filePath,
      name: basename(filePath),
      bytes,
      reason,
      reasonLabel
    });
  };

  for (const [fileKey, entry] of byFileKey.entries()) {
    let info;
    try {
      info = await lstat(entry.path);
    } catch {
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink()) continue;

    // Hàng rào 1: loại trừ tuyệt đối thành phẩm / timeline / thư mục thành phẩm V13, ngoài sourceFolder hoặc không mang thẻ [LINK_<12 hex>].
    if (
      protectedExactKeys.has(fileKey) ||
      (dedicatedProductFolder && isPathInside(dedicatedProductFolder, entry.path))
    ) {
      continue;
    }
    if (!isPathInside(project.sourceFolder, entry.path)) {
      continue;
    }
    if (!TUBMEDIA_LINK_TAG_PATTERN.test(basename(entry.path))) {
      // Tệp cá nhân do người dùng chép tay không mang thẻ [LINK_<12 hex>]: tự động bảo vệ thầm lặng, không đụng tới.
      continue;
    }

    // Gom tất cả bản ghi media_sources cùng trỏ tới tệp vật lý này (để cả kiểm tra dùng chung lẫn clearFileCache đều trọn vẹn).
    const firstSourceId = [...entry.sourceIds][0]!;
    for (const otherSource of deps.sources.othersUsingFile(entry.path, firstSourceId)) {
      entry.sourceIds.add(otherSource.id);
    }

    // Hàng rào 2: giữ nguyên nếu bất kỳ danh sách khác chưa hoàn tất đang tham chiếu tới tệp này.
    const usedByIncomplete = [...entry.sourceIds].some((sid) => sourceIdsUsedByOtherIncomplete.has(sid));
    if (usedByIncomplete && otherIncompleteProjectIds.size > 0) {
      pushKept(
        entry.path,
        info.size,
        'shared_incomplete_project',
        'Đang là video nguồn của một danh sách khác chưa hoàn tất'
      );
      continue;
    }

    // Hàng rào 3: giữ nguyên nếu xuất hiện trong bất kỳ tệp nháp dự án CapCut nào.
    if (isReferencedInCapCutDrafts(entry.path, capcutDraftTexts)) {
      pushKept(entry.path, info.size, 'capcut_draft_reference', 'Đang được sử dụng trong dự án nháp CapCut');
      continue;
    }

    candidates.push({
      path: entry.path,
      bytes: info.size,
      sourceIds: [...entry.sourceIds]
    });
  }

  const eligibleBytes = candidates.reduce((sum, c) => sum + c.bytes, 0);
  if (candidates.length === 0) {
    return {
      preview: {
        projectId,
        eligible: true,
        canTrash: false,
        blockedReason:
          keptItems.length > 0
            ? 'Tất cả video nguồn của danh sách này đều đang được giữ lại tự động (đang dùng ở danh sách khác hoặc trong dự án CapCut).'
            : 'Không còn video nguồn nào cần dọn trong thư mục nguồn của danh sách này.',
        eligibleCount: 0,
        eligibleBytes: 0,
        recycleBinMaxBytes: null,
        keptItems
      },
      candidates: []
    };
  }

  // Hàng rào 4: kiểm hạn mức Thùng rác trước khi xoá — tuyệt đối không tự rơi về xoá vĩnh viễn.
  const readCap = deps.readRecycleBinCapacity ?? defaultReadRecycleBinCapacity;
  const binCap = await readCap(project.sourceFolder);
  if (!binCap.supported) {
    return {
      preview: {
        projectId,
        eligible: true,
        canTrash: false,
        blockedReason:
          binCap.reason ??
          'Ổ đĩa chứa thư mục nguồn không hỗ trợ Thùng rác an toàn nên Tubmedia đã dừng trước khi xóa.',
        eligibleCount: candidates.length,
        eligibleBytes,
        recycleBinMaxBytes: binCap.maxBytes,
        keptItems
      },
      candidates
    };
  }
  if (eligibleBytes > binCap.maxBytes) {
    return {
      preview: {
        projectId,
        eligible: true,
        canTrash: false,
        blockedReason:
          `Tổng dung lượng video nguồn cần dọn (${formatBytes(eligibleBytes)}) vượt sức chứa hiện tại của Thùng rác trên ổ đĩa (${formatBytes(binCap.maxBytes)}). ` +
          'Tubmedia đã dừng trước khi xóa để không làm mất vĩnh viễn tệp nguồn; hãy làm trống bớt Thùng rác hoặc mở rộng hạn mức Thùng rác rồi thử lại.',
        eligibleCount: candidates.length,
        eligibleBytes,
        recycleBinMaxBytes: binCap.maxBytes,
        keptItems
      },
      candidates
    };
  }

  return {
    preview: {
      projectId,
      eligible: true,
      canTrash: true,
      blockedReason: null,
      eligibleCount: candidates.length,
      eligibleBytes,
      recycleBinMaxBytes: binCap.maxBytes,
      keptItems
    },
    candidates
  };
}

export async function planPostMergeSourceCleanup(
  projectId: string,
  deps: PostMergeSourceCleanupDeps
): Promise<SourceCleanupPreview> {
  const plan = await buildInternalPlan(projectId, deps);
  return plan.preview;
}

export async function executePostMergeSourceCleanup(
  projectId: string,
  deps: PostMergeSourceCleanupDeps
): Promise<SourceCleanupResult> {
  const plan = await buildInternalPlan(projectId, deps);
  const keptItems: SourceCleanupKeptItem[] = [...plan.preview.keptItems];
  if (!plan.preview.eligible || !plan.preview.canTrash || plan.candidates.length === 0) {
    return {
      projectId,
      trashedCount: 0,
      trashedBytes: 0,
      keptItems,
      blockedReason: plan.preview.blockedReason
    };
  }

  const trash = deps.trashItem ?? defaultTrashItem;
  let trashedCount = 0;
  let trashedBytes = 0;

  for (const candidate of plan.candidates) {
    // Kiểm tra lại ngay trước lúc chuyển Thùng rác để tránh tệp vừa bị ứng dụng khác (CapCut / trình phát / AV) mở khoá.
    let busyLock = false;
    try {
      const info = await lstat(candidate.path);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const handle = await open(candidate.path, 'r+');
      await handle.close();
    } catch (error) {
      const rawCode =
        error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
      const code = typeof rawCode === 'string' ? rawCode : '';
      if (code === 'ENOENT') continue;
      busyLock = true;
    }

    if (busyLock) {
      keptItems.push({
        path: candidate.path,
        name: basename(candidate.path),
        bytes: candidate.bytes,
        reason: 'locked_or_busy',
        reasonLabel: 'Tệp đang được mở bởi ứng dụng khác nên được giữ lại'
      });
      continue;
    }

    try {
      await trash(candidate.path);
      trashedCount += 1;
      trashedBytes += candidate.bytes;
      for (const sid of candidate.sourceIds) {
        deps.sources.clearFileCache(sid);
      }
    } catch {
      keptItems.push({
        path: candidate.path,
        name: basename(candidate.path),
        bytes: candidate.bytes,
        reason: 'locked_or_busy',
        reasonLabel: 'Không thể chuyển vào Thùng rác (tệp đang bận) nên được giữ lại an toàn'
      });
    }
  }

  // Hàng rào 5: dọn kèm bản đệm chuẩn hoá/remux và clip tạm của quy trình này nếu không còn quy trình dở nào dùng chung tempFolder.
  const project = deps.projects.get(projectId);
  if (project) {
    const allProjects = deps.projects.list(true);
    const sameTempHasUnfinished = allProjects.some((other) => {
      if (other.id === projectId || normKey(other.tempFolder) !== normKey(project.tempFolder)) return false;
      const jobs = deps.queue.list(other.id);
      return other.status !== 'completed' || jobs.some((j) => !['completed', 'skipped'].includes(j.status));
    });
    const protection = buildCleanupProtection({
      projects: allProjects,
      settings: deps.settings ? deps.settings() : defaultAppSettings,
      jobs: deps.queue.list(),
      sourceFiles: deps.sources.listSourceFiles()
    });
    if (!sameTempHasUnfinished) {
      await removeMergeCaches(project.tempFolder, {
        protectedFolders: protection.protectedFolders,
        protectedFiles: protection.protectedFiles
      }).catch(() => 0);
    }
    const projectItems = deps.items.list(projectId);
    const trackedClips = projectItems
      .map((item) => item.clipFile)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    await cleanupTemporaryArtifacts(project.tempFolder, trackedClips, false, protection).catch(() => undefined);
    for (const item of projectItems) {
      if (!item.clipFile) continue;
      const stillExists = await stat(item.clipFile).then(() => true).catch(() => false);
      if (!stillExists) {
        deps.items.setClipFile?.(item.id, null);
      }
    }
  }

  return {
    projectId,
    trashedCount,
    trashedBytes,
    keptItems,
    blockedReason: null
  };
}
