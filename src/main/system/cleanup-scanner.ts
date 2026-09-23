/**
 * Bộ quét Dọn dẹp máy — GIAI ĐOẠN 4a/4b (2026-09-23). Thay thế hoàn toàn phần quét/xóa của
 * resources/system-cleanup-helper.ps1 (đã xóa) bằng Node.js thuần: không PowerShell, không
 * Start-Process -Verb RunAs, không cần quyền quản trị.
 *
 * GĐ4a: chỉ đọc (thống kê dung lượng), không xóa gì.
 * GĐ4b: thêm listCategoryFiles()/listResidueFiles() — trả về ĐẦY ĐỦ danh sách file khớp (không giới
 * hạn mẫu như scanTarget()/scanTubmediaResidue() dùng để hiển thị UI) — SystemCleanupService dùng
 * đúng hai hàm này để cách ly THẬT, đảm bảo số lượng/dung lượng xóa khớp chính xác với số đã quét.
 *
 * An toàn (kế thừa nguyên vẹn từ Assert-SafeTarget/Test-TubmediaOwnershipMarker/Test-TubmediaResidueName
 * trong bản PowerShell cũ, chỉ đổi ngôn ngữ triển khai):
 * - assertSafeCleanupPath(): chặn tuyệt đối các thư mục gốc quá rộng (ổ đĩa, Windows, Users, hồ sơ
 *   người dùng, ProgramData/ProgramFiles), MỌI gốc ổ đĩa trần (ví dụ "D:\", không chỉ ổ hệ thống), và
 *   chặn "Zalo Received Files".
 * - Mọi mục (file lẫn thư mục) đều được lstat() trước khi tính hoặc đi vào — bỏ qua symlink/reparse
 *   point (bao gồm junction) để không bao giờ đi lạc ra ngoài phạm vi cho phép hay theo vòng lặp.
 * - tubmediaResidue chỉ quét rộng thư mục tạm khi có file đánh dấu sở hữu .tubmedia-owned.json hợp lệ;
 *   tên file phải khớp đúng mẫu nhận diện của Tubmedia (LINK_/QD-/clip-/concat-/.pending); chỉ tính
 *   file cũ hơn 7 ngày.
 * - GĐ4b: SystemCleanupService gọi lại assertSafeCleanupPath() + lstat() một lần NỮA ngay trước khi
 *   cách ly từng file thật (không tin tưởng kết quả quét cũ) — chống thay đổi giữa lúc quét và lúc xóa.
 */
import type { Dirent } from 'node:fs';
import { copyFile, lstat, readdir, readFile, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

export interface FoundFile {
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

  let entries: Dirent[];
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
      // Bỏ qua symlink VÀ junction (Windows báo junction là reparse point / symbolic link qua lstat)
      // — không bao giờ đi theo, tránh thoát phạm vi cho phép hoặc rơi vào vòng lặp.
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

const BARE_DRIVE_ROOT_PATTERN = /^[a-z]:$/i;

/**
 * Chặn tuyệt đối các thư mục gốc quá rộng/nguy hiểm (ổ đĩa, Windows, hồ sơ người dùng, Users,
 * ProgramData/ProgramFiles), MỌI gốc ổ đĩa trần (không chỉ ổ hệ thống — ví dụ "D:\" hay "E:") và
 * "Zalo Received Files" — cổng an toàn cuối cùng trước khi quét HOẶC xóa bất kỳ đường dẫn nào, độc
 * lập với việc đường dẫn đó đến từ đâu (cấu hình cứng hay TubmediaCleanupRoots do người dùng cấu hình).
 */
export function assertSafeCleanupPath(path: string): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('Đường dẫn dọn dẹp không hợp lệ.');
  }

  const resolved = resolve(path);
  const normalized = normalizeForCompare(resolved);

  if (BARE_DRIVE_ROOT_PATTERN.test(normalized)) {
    throw new Error(`Đã chặn gốc ổ đĩa: ${resolved}`);
  }

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

/**
 * Toàn bộ file khớp một vị trí quét, KHÔNG giới hạn số lượng — dùng cho cả ước tính (scanTarget lấy
 * mẫu 20 file lớn nhất từ đây) lẫn cách ly thật ở GĐ4b (cần đúng từng file, không chỉ mẫu hiển thị).
 */
export async function listCategoryFiles(target: CleanupTarget, options: ScanOptions = {}): Promise<FoundFile[]> {
  const safePath = assertSafeCleanupPath(target.path);

  let rootStat;
  try {
    rootStat = await lstat(safePath);
  } catch {
    return [];
  }

  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return [];
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

  return files;
}

export interface ScanTargetResult {
  matchedItems: number;
  estimatedBytes: number;
  findings: SystemCleanupFinding[];
}

const MAX_SAMPLE_FINDINGS = 20;

/** Quét một vị trí để HIỂN THỊ (mẫu tối đa 20 file lớn nhất) — chỉ đọc, không xóa gì. */
export async function scanTarget(target: CleanupTarget, options: ScanOptions = {}): Promise<ScanTargetResult> {
  const files = await listCategoryFiles(target, options);

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

  return { matchedItems: files.length, estimatedBytes, findings };
}

const RESIDUE_CUTOFF_DAYS = 7;

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
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + '\\') || resolvedPath.startsWith(`${resolvedRoot}/`);
}

export interface ResidueMatch extends FoundFile {
  reason: string;
}

export interface ResidueListResult {
  matches: ResidueMatch[];
  errors: string[];
}

/**
 * Toàn bộ file dữ liệu tải dở/tạm của Tubmedia khớp mẫu nhận diện, KHÔNG giới hạn số lượng — dùng cho
 * cả ước tính (scanTubmediaResidue lấy mẫu 80 file từ đây) lẫn cách ly thật ở GĐ4b.
 */
export async function listResidueFiles(
  roots: TubmediaResidueRoots,
  now: number = Date.now(),
  options: ScanOptions = {}
): Promise<ResidueListResult> {
  const seen = new Set<string>();
  const matches: ResidueMatch[] = [];
  const errors: string[] = [];

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
        const matchesName = spec.kind === 'temp' ? matchesTempResidueName(name) : matchesDownloadResidueName(name);
        if (!matchesName) continue;
      }

      if (!isOldEnough(file.mtimeMs, now)) continue;

      const key = normalizeForCompare(file.path);
      if (seen.has(key)) continue;
      seen.add(key);

      const reason =
        spec.kind === 'quick-temp'
          ? 'Thư mục tạm Tải nhanh do Tubmedia tạo đã quá 7 ngày.'
          : spec.kind === 'temp'
            ? 'Clip/checkpoint tạm do Tubmedia tạo đã quá 7 ngày.'
            : 'Phần tải dở có dấu nhận diện LINK/QD của Tubmedia đã quá 7 ngày.';
      matches.push({ ...file, reason });
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
      matches.push({
        path: resolvedFile,
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        reason: 'Clip tạm cũ vẫn được cơ sở dữ liệu Tubmedia theo dõi chính xác.'
      });
    } catch {
      continue;
    }
  }

  return { matches, errors };
}

const MAX_RESIDUE_FINDINGS = 80;

export interface ResidueScanResult {
  matchedItems: number;
  estimatedBytes: number;
  findings: SystemCleanupFinding[];
  errors: string[];
}

/** Quét dữ liệu tải dở/tạm của Tubmedia để HIỂN THỊ (mẫu tối đa 80 file) — chỉ đọc, không xóa gì. */
export async function scanTubmediaResidue(
  roots: TubmediaResidueRoots,
  now: number = Date.now(),
  options: ScanOptions = {}
): Promise<ResidueScanResult> {
  const { matches, errors } = await listResidueFiles(roots, now, options);

  const estimatedBytes = matches.reduce((total, match) => total + match.bytes, 0);
  const findings: SystemCleanupFinding[] = matches.slice(0, MAX_RESIDUE_FINDINGS).map((match) => ({
    path: match.path,
    bytes: match.bytes,
    classification: 'safe-to-delete',
    reason: match.reason
  }));

  return { matchedItems: matches.length, estimatedBytes, findings, errors };
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

/**
 * Sao chép rồi xác minh đúng kích thước trước khi coi là thành công — dùng khi di chuyển file khác ổ
 * đĩa (rename() báo lỗi EXDEV). KHÔNG tự xóa file gốc — gọi nơi dùng hàm này chịu trách nhiệm xóa gốc
 * sau khi xác nhận bản sao đúng, để không bao giờ mất dữ liệu giữa chừng nếu sao chép thất bại.
 */
export async function copyFileVerified(sourcePath: string, destinationPath: string): Promise<void> {
  await copyFile(sourcePath, destinationPath);

  const [sourceStat, destinationStat] = await Promise.all([lstat(sourcePath), lstat(destinationPath)]);

  if (sourceStat.size !== destinationStat.size) {
    await rm(destinationPath, { force: true });
    throw new Error('Sao chép không khớp kích thước — đã hủy, giữ nguyên file gốc.');
  }
}
