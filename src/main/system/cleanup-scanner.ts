/**
 * Bộ quét Dọn dẹp máy — GIAI ĐOẠN 4a (2026-09-23). Thay thế hoàn toàn phần quét của
 * resources/system-cleanup-helper.ps1 (đã xóa) bằng Node.js thuần: không PowerShell, không
 * Start-Process -Verb RunAs, không cần quyền quản trị. Chỉ đọc (thống kê dung lượng), KHÔNG xóa gì —
 * việc xóa/cách ly/hoàn tác thật sẽ làm ở Giai đoạn 4b.
 *
 * An toàn (kế thừa nguyên vẹn từ Assert-SafeTarget/Test-TubmediaOwnershipMarker/Test-TubmediaResidueName
 * trong bản PowerShell cũ, chỉ đổi ngôn ngữ triển khai):
 * - assertSafeCleanupPath(): chặn tuyệt đối các thư mục gốc quá rộng (ổ đĩa, Windows, Users, hồ sơ
 *   người dùng, ProgramData/ProgramFiles) và chặn "Zalo Received Files".
 * - Mọi mục (file lẫn thư mục) đều được lstat() trước khi tính hoặc đi vào — bỏ qua symlink/reparse
 *   point để không bao giờ đi lạc ra ngoài phạm vi cho phép.
 * - tubmediaResidue chỉ quét rộng thư mục tạm khi có file đánh dấu sở hữu .tubmedia-owned.json hợp lệ;
 *   tên file phải khớp đúng mẫu nhận diện của Tubmedia (LINK_/QD-/clip-/concat-/.pending); chỉ tính
 *   file cũ hơn 7 ngày.
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { SystemCleanupCategoryId, SystemCleanupFinding } from '@shared/system-cleanup.js';

export interface CleanupEnvironmentPaths {
  tempDir: string;
  localAppData: string;
  roamingAppData: string;
}

export function resolveCleanupEnvironmentPaths(): CleanupEnvironmentPaths {
  return {
    tempDir: process.env.TEMP ?? process.env.TMP ?? tmpdir(),
    localAppData: process.env.LOCALAPPDATA ?? '',
    roamingAppData: process.env.APPDATA ?? ''
  };
}

export interface TubmediaResidueRoots {
  sourceFolders: string[];
  tempFolders: string[];
  trackedTempFiles: string[];
  quickOutputFolders: string[];
  quickTempRoots: string[];
}

export interface CleanupTarget {
  path: string;
  /** Mẫu tên file (hỗ trợ '*'); nếu có, chỉ quét một cấp (không đệ quy). Không có nghĩa là quét toàn bộ, đệ quy. */
  patterns?: string[];
}

export class CleanupScanCancelledError extends Error {
  public constructor() {
    super('Đã dừng quét theo yêu cầu.');
    this.name = 'CleanupScanCancelledError';
  }
}

export interface ScanOptions {
  shouldCancel?: () => boolean;
}

const MAX_RECURSION_DEPTH = 64;

// shouldCancel() chỉ đọc một Set (rẻ) nên kiểm tra ở MỌI mục thay vì theo chu kỳ N mục — tránh việc
// một thư mục nhỏ (ít hơn một chu kỳ) không bao giờ thấy yêu cầu dừng.
function checkCancelled(options: ScanOptions): void {
  if (options.shouldCancel?.()) {
    throw new CleanupScanCancelledError();
  }
}

interface FoundFile {
  path: string;
  bytes: number;
  mtimeMs: number;
}

async function collectFilesRecursively(
  root: string,
  out: FoundFile[],
  options: ScanOptions,
  depth = 0
): Promise<void> {
  if (depth > MAX_RECURSION_DEPTH) {
    return;
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    checkCancelled(options);

    const fullPath = join(root, entry.name);
    let info;
    try {
      info = await lstat(fullPath);
    } catch {
      continue;
    }

    if (info.isSymbolicLink()) {
      continue;
    }

    if (info.isDirectory()) {
      await collectFilesRecursively(fullPath, out, options, depth + 1);
      continue;
    }

    if (info.isFile()) {
      out.push({ path: fullPath, bytes: info.size, mtimeMs: info.mtimeMs });
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const BLOCKED_ENV_KEYS = [
  'SystemDrive',
  'WINDIR',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)'
] as const;

function normalizeForCompare(path: string): string {
  return resolve(path).replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Chặn tuyệt đối các thư mục gốc quá rộng/nguy hiểm (ổ đĩa, Windows, hồ sơ người dùng, Users,
 * ProgramData/ProgramFiles) và "Zalo Received Files" — cổng an toàn cuối cùng trước khi quét bất kỳ
 * đường dẫn nào, độc lập với việc đường dẫn đó đến từ đâu (cấu hình cứng hay TubmediaCleanupRoots).
 */
export function assertSafeCleanupPath(path: string): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('Đường dẫn dọn dẹp không hợp lệ.');
  }

  const resolved = resolve(path);
  const normalized = normalizeForCompare(resolved);

  const blocked = new Set<string>();
  for (const key of BLOCKED_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      blocked.add(normalizeForCompare(value));
    }
  }
  const systemDrive = process.env.SystemDrive;
  if (systemDrive) {
    blocked.add(normalizeForCompare(join(systemDrive, 'Users')));
  }

  if (blocked.has(normalized)) {
    throw new Error(`Đã chặn đường dẫn quá rộng/nguy hiểm: ${resolved}`);
  }

  if (/zalo received files/i.test(resolved)) {
    throw new Error('Đã chặn Zalo Received Files.');
  }

  return resolved;
}

async function listProfileDirectories(browserRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(browserRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || entry.name.startsWith('Profile ')))
    .map((entry) => join(browserRoot, entry.name));
}

/** Danh sách vị trí quét cho một hạng mục — tương đương Get-CacheTargets trong bản PowerShell cũ. */
export async function categoryTargets(
  category: SystemCleanupCategoryId,
  env: CleanupEnvironmentPaths
): Promise<CleanupTarget[]> {
  switch (category) {
    case 'userTemp':
      return [{ path: env.tempDir }, { path: join(env.localAppData, 'Temp') }];

    case 'thumbnailCache':
      return [
        {
          path: join(env.localAppData, 'Microsoft', 'Windows', 'Explorer'),
          patterns: ['thumbcache_*.db', 'iconcache_*.db']
        }
      ];

    case 'crashReports':
      // Chỉ CrashDumps riêng của người dùng hiện tại — đã bỏ ProgramData\Microsoft\Windows\WER và
      // %WINDIR%\Minidump vì cần quyền quản trị (quyết định người dùng 2026-09-23).
      return [{ path: join(env.localAppData, 'CrashDumps') }];

    case 'browserCache': {
      const roots = [
        join(env.localAppData, 'Google', 'Chrome', 'User Data'),
        join(env.localAppData, 'Microsoft', 'Edge', 'User Data')
      ];
      const targets: CleanupTarget[] = [];
      for (const browserRoot of roots) {
        const profiles = await listProfileDirectories(browserRoot);
        for (const profile of profiles) {
          for (const relative of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache']) {
            targets.push({ path: join(profile, relative) });
          }
        }
      }
      return targets;
    }

    case 'capcutCache':
      return [
        join(env.localAppData, 'CapCut', 'User Data', 'Cache'),
        join(env.localAppData, 'CapCut', 'User Data', 'Code Cache'),
        join(env.localAppData, 'CapCut', 'User Data', 'GPUCache'),
        join(env.localAppData, 'CapCut', 'User Data', 'ShaderCache'),
        join(env.localAppData, 'CapCut', 'Cache'),
        join(env.localAppData, 'CapCut', 'Temp'),
        join(env.localAppData, 'CapCut', 'Logs'),
        join(env.localAppData, 'CapCut', 'Crashpad'),
        join(env.roamingAppData, 'CapCut', 'Cache'),
        join(env.roamingAppData, 'CapCut', 'Temp'),
        join(env.roamingAppData, 'CapCut', 'Logs'),
        join(env.localAppData, 'ByteDance', 'Cache'),
        join(env.localAppData, 'ByteDance', 'Temp'),
        join(env.localAppData, 'ByteDance', 'Logs'),
        join(env.tempDir, 'CapCut'),
        join(env.tempDir, 'ByteDance')
      ].map((path) => ({ path }));

    case 'zaloCache':
      return [
        join(env.localAppData, 'Zalo', 'Cache'),
        join(env.localAppData, 'Zalo', 'Temp'),
        join(env.localAppData, 'Zalo', 'Logs'),
        join(env.roamingAppData, 'Zalo', 'Cache'),
        join(env.roamingAppData, 'Zalo', 'Temp'),
        join(env.roamingAppData, 'Zalo', 'Logs'),
        join(env.localAppData, 'Programs', 'Zalo', 'temp'),
        join(env.localAppData, 'Programs', 'Zalo', 'logs'),
        join(env.localAppData, 'ZaloPC', 'Cache'),
        join(env.localAppData, 'ZaloPC', 'temp'),
        join(env.localAppData, 'ZaloPC', 'logs'),
        join(env.roamingAppData, 'ZaloPC', 'Cache'),
        join(env.roamingAppData, 'ZaloPC', 'temp'),
        join(env.roamingAppData, 'ZaloPC', 'logs')
      ].map((path) => ({ path }));

    case 'tubmediaResidue':
      return [];

    default:
      return [];
  }
}

export interface ScanTargetResult {
  estimatedBytes: number;
  findings: SystemCleanupFinding[];
}

const MAX_SAMPLE_FINDINGS = 20;

/** Quét một vị trí (đệ quy nếu không chỉ định mẫu tên) — chỉ đọc, không xóa gì. */
export async function scanTarget(target: CleanupTarget, options: ScanOptions = {}): Promise<ScanTargetResult> {
  const safePath = assertSafeCleanupPath(target.path);

  let rootStat;
  try {
    rootStat = await lstat(safePath);
  } catch {
    return { estimatedBytes: 0, findings: [] };
  }

  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { estimatedBytes: 0, findings: [] };
  }

  const files: FoundFile[] = [];

  if (target.patterns && target.patterns.length > 0) {
    const matchers = target.patterns.map(globToRegExp);
    let entries: Dirent[];
    try {
      entries = await readdir(safePath, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isFile() || !matchers.some((re) => re.test(entry.name))) {
        continue;
      }

      const fullPath = join(safePath, entry.name);
      try {
        const info = await lstat(fullPath);
        if (info.isSymbolicLink()) continue;
        files.push({ path: fullPath, bytes: info.size, mtimeMs: info.mtimeMs });
      } catch {
        // Tệp có thể vừa bị xóa/khóa giữa lúc quét — bỏ qua.
      }
    }
  } else {
    await collectFilesRecursively(safePath, files, options);
  }

  const estimatedBytes = files.reduce((total, file) => total + file.bytes, 0);
  const findings: SystemCleanupFinding[] = files
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_SAMPLE_FINDINGS)
    .map((file) => ({
      path: file.path,
      bytes: file.bytes,
      classification: 'safe-to-delete',
      reason: 'Nằm trong vị trí cache hoặc tệp tạm đã được Tubmedia cho phép.'
    }));

  return { estimatedBytes, findings };
}

const RESIDUE_CUTOFF_DAYS = 7;
const MAX_RESIDUE_FINDINGS = 80;

function isOldEnough(mtimeMs: number, now: number): boolean {
  return now - mtimeMs >= RESIDUE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
}

function matchesDownloadResidueName(name: string): boolean {
  return (
    /\[(?:LINK_[A-F0-9]{12}|QD-[A-F0-9-]+)\].*\.(?:part|ytdl|aria2)$/i.test(name) ||
    /\[(?:LINK_[A-F0-9]{12}|QD-[A-F0-9-]+)\].*\.frag\d+$/i.test(name)
  );
}

function matchesTempResidueName(name: string): boolean {
  return (
    /^clip-\d+-[a-z0-9-]+\.mp4(?:\.pending\.mp4)?$/i.test(name) ||
    /^concat-[a-f0-9-]+\.txt$/i.test(name) ||
    /\.pending(?:\.[a-z0-9]+)?$/i.test(name)
  );
}

async function hasTubmediaOwnershipMarker(root: string): Promise<boolean> {
  try {
    const raw = await readFile(join(root, '.tubmedia-owned.json'), 'utf8');
    const marker = JSON.parse(raw) as { owner?: unknown; version?: unknown };
    return marker.owner === 'Tubmedia' && marker.version === 1;
  } catch {
    return false;
  }
}

function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = normalizeForCompare(path);
  const resolvedRoot = normalizeForCompare(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep);
}

export interface ResidueScanResult {
  estimatedBytes: number;
  findings: SystemCleanupFinding[];
  errors: string[];
}

/**
 * Quét dữ liệu tải dở/tạm của riêng Tubmedia — tương đương Invoke-TubmediaResidueCleanup trong bản
 * PowerShell cũ (đọc-only, không xóa). `now` cho phép truyền mốc thời gian giả khi viết test.
 */
export async function scanTubmediaResidue(
  roots: TubmediaResidueRoots,
  now: number = Date.now(),
  options: ScanOptions = {}
): Promise<ResidueScanResult> {
  const seen = new Set<string>();
  const findings: SystemCleanupFinding[] = [];
  const errors: string[] = [];
  let estimatedBytes = 0;

  const rootSpecs: { path: string; kind: 'download' | 'temp' | 'quick-temp' }[] = [
    ...roots.sourceFolders.filter(Boolean).map((path) => ({ path, kind: 'download' as const })),
    ...roots.quickOutputFolders.filter(Boolean).map((path) => ({ path, kind: 'download' as const })),
    ...roots.tempFolders.filter(Boolean).map((path) => ({ path, kind: 'temp' as const })),
    ...roots.quickTempRoots.filter(Boolean).map((path) => ({ path, kind: 'quick-temp' as const }))
  ];

  for (const spec of rootSpecs) {
    let safeRoot: string;
    try {
      safeRoot = assertSafeCleanupPath(spec.path);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    let rootStat;
    try {
      rootStat = await lstat(safeRoot);
    } catch {
      continue;
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      continue;
    }

    if (spec.kind === 'temp' && !(await hasTubmediaOwnershipMarker(safeRoot))) {
      // Thư mục tạm tùy chọn có thể chứa file cá nhân — chỉ quét rộng khi có dấu sở hữu hợp lệ.
      continue;
    }

    const files: FoundFile[] = [];
    await collectFilesRecursively(safeRoot, files, options);

    for (const file of files) {
      if (spec.kind === 'quick-temp') {
        const relative = file.path.slice(safeRoot.length).replace(/^[\\/]+/, '');
        const firstSegment = relative.split(/[\\/]/)[0] ?? '';
        if (!/^[a-f0-9]{12}$/i.test(firstSegment)) continue;
      } else {
        const name = file.path.split(/[\\/]/).pop() ?? '';
        const matches = spec.kind === 'temp' ? matchesTempResidueName(name) : matchesDownloadResidueName(name);
        if (!matches) continue;
      }

      if (!isOldEnough(file.mtimeMs, now)) continue;

      const key = normalizeForCompare(file.path);
      if (seen.has(key)) continue;
      seen.add(key);

      estimatedBytes += file.bytes;
      if (findings.length < MAX_RESIDUE_FINDINGS) {
        const reason =
          spec.kind === 'quick-temp'
            ? 'Thư mục tạm Tải nhanh do Tubmedia tạo đã quá 7 ngày.'
            : spec.kind === 'temp'
              ? 'Clip/checkpoint tạm do Tubmedia tạo đã quá 7 ngày.'
              : 'Phần tải dở có dấu nhận diện LINK/QD của Tubmedia đã quá 7 ngày.';
        findings.push({ path: file.path, bytes: file.bytes, classification: 'safe-to-delete', reason });
      }
    }
  }

  for (const trackedPath of roots.trackedTempFiles) {
    if (!trackedPath) continue;

    const resolvedFile = resolve(trackedPath);
    const insideKnownTempRoot = roots.tempFolders
      .filter(Boolean)
      .some((tempRoot) => isPathInsideRoot(resolvedFile, tempRoot));

    if (!insideKnownTempRoot) continue;

    const key = normalizeForCompare(resolvedFile);
    if (seen.has(key)) continue;

    try {
      const info = await lstat(resolvedFile);
      if (info.isSymbolicLink() || !info.isFile()) continue;
      if (!isOldEnough(info.mtimeMs, now)) continue;

      seen.add(key);
      estimatedBytes += info.size;
      if (findings.length < MAX_RESIDUE_FINDINGS) {
        findings.push({
          path: resolvedFile,
          bytes: info.size,
          classification: 'safe-to-delete',
          reason: 'Clip tạm cũ vẫn được cơ sở dữ liệu Tubmedia theo dõi chính xác.'
        });
      }
    } catch {
      continue;
    }
  }

  return { estimatedBytes, findings, errors };
}

export interface DriveSpaceInfo {
  freeBytes: number;
  totalBytes: number;
}

/** Đọc dung lượng trống/tổng của ổ chứa `path`. Trả về null nếu môi trường không hỗ trợ statfs. */
export async function readDriveSpace(path: string): Promise<DriveSpaceInfo | null> {
  try {
    const stats = await statfs(path);
    return {
      freeBytes: stats.bavail * stats.bsize,
      totalBytes: stats.blocks * stats.bsize
    };
  } catch {
    return null;
  }
}
