import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import extract from 'extract-zip';
import { UpdateFailedError, RollbackFailedError } from '@shared/errors/app-errors.js';
import type { ToolStatus, ToolUpdateCheck } from '@shared/types/domain.js';
import type { ToolManager, ToolName } from '../tools/tool-manager.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessManager } from '../processes/process-manager.js';

type ToolPackage = 'yt-dlp' | 'ffmpeg-suite' | 'aria2c';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
  updated_at?: string;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  published_at: string | null;
  assets: GitHubAsset[];
}

interface PackageMetadata {
  releaseId: number;
  version: string;
  installedAt: string;
  sourceUrl: string;
}

interface ToolMetadata {
  packages: Partial<Record<ToolPackage, PackageMetadata>>;
}

interface PackageSource {
  packageName: ToolPackage;
  release: GitHubRelease;
  asset: GitHubAsset;
  version: string;
  archive: 'none' | 'zip';
  executableNames: string[];
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Video-Download-Merge-Studio-Pro'
};
const RELEASE_REQUEST_TIMEOUT_MS = 45_000;
const TOOL_DOWNLOAD_TIMEOUT_MS = 20 * 60_000;

function packageForTool(name: ToolName): ToolPackage {
  if (name === 'yt-dlp') return 'yt-dlp';
  if (name === 'aria2c') return 'aria2c';
  return 'ffmpeg-suite';
}

function toolsForPackage(name: ToolPackage): ToolName[] {
  if (name === 'yt-dlp') return ['yt-dlp'];
  if (name === 'aria2c') return ['aria2c'];
  return ['ffmpeg', 'ffprobe', 'ffplay'];
}

function cleanVersion(release: GitHubRelease): string {
  return (release.name || release.tag_name || String(release.id)).trim();
}

export class ToolUpdateService {
  public constructor(
    private readonly tools: ToolManager,
    private readonly settings: SettingsService,
    private readonly managedFolder: string,
    private readonly logger: Logger,
    private readonly processes: ProcessManager
  ) {}

  private async githubLatest(repository: string): Promise<GitHubRelease> {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: GITHUB_HEADERS,
      signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new UpdateFailedError(`Không đọc được bản phát hành ${repository}: HTTP ${response.status}.`);
    }
    const value = await response.json() as Partial<GitHubRelease>;
    if (!value.id || !value.tag_name || !Array.isArray(value.assets)) {
      throw new UpdateFailedError(`Dữ liệu bản phát hành ${repository} không hợp lệ.`);
    }
    return value as GitHubRelease;
  }

  private selectAsset(release: GitHubRelease, predicate: (asset: GitHubAsset) => boolean, label: string): GitHubAsset {
    const asset = release.assets.find(predicate);
    if (!asset) throw new UpdateFailedError(`Không tìm thấy gói Windows x64 cho ${label}.`);
    return asset;
  }

  private async sourceForViaApi(packageName: ToolPackage): Promise<PackageSource> {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new UpdateFailedError('Bộ cập nhật tích hợp hiện hỗ trợ Windows x64. Hệ khác vẫn có thể cấu hình đường dẫn công cụ thủ công.');
    }

    if (packageName === 'yt-dlp') {
      const repository = this.settings.get().toolUpdateChannel === 'beta'
        ? 'yt-dlp/yt-dlp-nightly-builds'
        : 'yt-dlp/yt-dlp';
      const release = await this.githubLatest(repository);
      const asset = this.selectAsset(release, (item) => item.name === 'yt-dlp.exe', 'yt-dlp');
      return {
        packageName,
        release,
        asset,
        version: cleanVersion(release),
        archive: 'none',
        executableNames: ['yt-dlp.exe']
      };
    }

    if (packageName === 'ffmpeg-suite') {
      const release = await this.githubLatest('BtbN/FFmpeg-Builds');
      const asset = this.selectAsset(
        release,
        (item) => item.name === 'ffmpeg-master-latest-win64-gpl.zip',
        'FFmpeg/ffprobe/ffplay'
      );
      return {
        packageName,
        release,
        asset,
        version: cleanVersion(release),
        archive: 'zip',
        executableNames: ['ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe']
      };
    }

    const release = await this.githubLatest('aria2/aria2');
    const asset = this.selectAsset(
      release,
      (item) => /^aria2-.*-win-64bit-build\d+\.zip$/i.test(item.name),
      'aria2c'
    );
    return {
      packageName,
      release,
      asset,
      version: cleanVersion(release),
      archive: 'zip',
      executableNames: ['aria2c.exe']
    };
  }

  private directFallbackSource(packageName: ToolPackage): PackageSource | null {
    if (packageName === 'yt-dlp') {
      const asset: GitHubAsset = {
        name: 'yt-dlp.exe',
        browser_download_url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
        size: 0
      };
      return {
        packageName,
        release: { id: -1001, tag_name: 'latest-direct', name: 'latest-direct', published_at: null, assets: [asset] },
        asset,
        version: 'latest-direct',
        archive: 'none',
        executableNames: ['yt-dlp.exe']
      };
    }
    if (packageName === 'ffmpeg-suite') {
      const asset: GitHubAsset = {
        name: 'ffmpeg-master-latest-win64-gpl.zip',
        browser_download_url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
        size: 0
      };
      return {
        packageName,
        release: { id: -1002, tag_name: 'latest-direct', name: 'latest-direct', published_at: null, assets: [asset] },
        asset,
        version: 'latest-direct',
        archive: 'zip',
        executableNames: ['ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe']
      };
    }
    return null;
  }

  private async sourceFor(packageName: ToolPackage): Promise<PackageSource> {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new UpdateFailedError('Bộ cập nhật tích hợp hiện hỗ trợ Windows x64. Hệ khác vẫn có thể cấu hình đường dẫn công cụ thủ công.');
    }
    try {
      return await this.sourceForViaApi(packageName);
    } catch (error) {
      const fallback = this.directFallbackSource(packageName);
      if (!fallback) throw error;
      const technical = error instanceof Error ? error.message : String(error);
      this.logger.info(
        'update',
        'TOOL_RELEASE_API_DIRECT_FALLBACK',
        `GitHub API tạm thời không phản hồi cho ${packageName}; Tubmedia đã tự chuyển sang đường tải chính thức trực tiếp. Không cần xử lý.`,
        { metadata: { technical, fallbackUrl: fallback.asset.browser_download_url } }
      );
      return fallback;
    }
  }

  private metadataPath(folder: string): string {
    return join(folder, '.vdmsp-tool-metadata.json');
  }

  private async readMetadata(folder: string): Promise<ToolMetadata> {
    try {
      const parsed = JSON.parse(await readFile(this.metadataPath(folder), 'utf8')) as ToolMetadata;
      return parsed && typeof parsed === 'object' && parsed.packages ? parsed : { packages: {} };
    } catch {
      return { packages: {} };
    }
  }

  private async writeMetadata(folder: string, metadata: ToolMetadata): Promise<void> {
    await writeFile(this.metadataPath(folder), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  }

  public async check(): Promise<ToolUpdateCheck[]> {
    await this.tools.healthCheck();
    const folder = await this.tools.ensureWritableToolFolder();
    const metadata = await this.readMetadata(folder);
    const sources = await Promise.all([
      this.sourceFor('yt-dlp'),
      this.sourceFor('ffmpeg-suite'),
      this.sourceFor('aria2c')
    ]);

    return this.tools.list().map((status) => {
      const packageName = packageForTool(status.name);
      const remote = sources.find((source) => source.packageName === packageName)!;
      const installed = metadata.packages[packageName];
      return {
        name: status.name,
        currentVersion: status.version,
        latestVersion: remote.version,
        available: !status.available || installed?.releaseId !== remote.release.id,
        source: remote.asset.browser_download_url,
        publishedAt: remote.release.published_at
      };
    });
  }

  private async download(asset: GitHubAsset, path: string): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await rm(path, { force: true });
        const response = await fetch(asset.browser_download_url, {
          headers: GITHUB_HEADERS,
          redirect: 'follow',
          signal: AbortSignal.timeout(TOOL_DOWNLOAD_TIMEOUT_MS)
        });
        if (!response.ok || !response.body) {
          throw new UpdateFailedError(`Tải ${asset.name} thất bại: HTTP ${response.status}.`);
        }
        await mkdir(dirname(path), { recursive: true });
        await finished(Readable.fromWeb(response.body as never).pipe(createWriteStream(path)));
        const fileStat = await stat(path);
        if (fileStat.size <= 0) throw new UpdateFailedError(`${asset.name} tải về bị rỗng.`);
        if (asset.size > 0 && fileStat.size !== asset.size) {
          throw new UpdateFailedError(`Dung lượng ${asset.name} không khớp (${fileStat.size}/${asset.size} byte).`);
        }
        return;
      } catch (error) {
        lastError = error;
        await rm(path, { force: true });
        if (attempt < 3) {
          const waitMs = attempt * 2_000;
          this.logger.warn(
            'update',
            'TOOL_DOWNLOAD_RETRY',
            `Tải ${asset.name} chưa thành công (lần ${attempt}/3). Thử lại sau ${waitMs / 1_000} giây: ${error instanceof Error ? error.message : String(error)}`
          );
          await delay(waitMs);
        }
      }
    }
    throw new UpdateFailedError(
      `Không thể tải ${asset.name} sau 3 lần thử. ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  private async sha256(path: string): Promise<string> {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  }

  private async verifyDigest(asset: GitHubAsset, packagePath: string): Promise<void> {
    const digest = asset.digest?.toLowerCase();
    if (!digest?.startsWith('sha256:')) {
      throw new UpdateFailedError(
        `${asset.name} không có SHA-256 được công bố. Từ chối cài đặt để bảo vệ chuỗi cung ứng.`
      );
    }
    const expected = digest.slice('sha256:'.length);
    const actual = await this.sha256(packagePath);
    if (actual !== expected) throw new UpdateFailedError(`SHA-256 của ${asset.name} không khớp.`);
  }

  private async findFile(root: string, filename: string): Promise<string | null> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return path;
      if (entry.isDirectory()) {
        const nested = await this.findFile(path, filename);
        if (nested) return nested;
      }
    }
    return null;
  }

  private async clearWindowsInternetMark(path: string): Promise<void> {
    if (process.platform !== 'win32') return;
    // NTFS stores Mark-of-the-Web in the Zone.Identifier alternate data stream.
    // copyFile normally drops ADS, but explicitly removing it keeps updates safe
    // across Windows versions and archive extractors that preserve the mark.
    await rm(`${path}:Zone.Identifier`, { force: true }).catch(() => undefined);
  }

  private async validateCandidate(name: ToolName, executablePath: string): Promise<void> {
    const args = name === 'yt-dlp' ? ['--version'] : name === 'aria2c' ? ['-v'] : ['-version'];
    try {
      const result = await this.processes.run({
        jobId: `tool-update-validate-${name}`,
        tool: `update-${name}`,
        executablePath,
        args,
        timeoutMs: 30_000,
        priority: 'below_normal'
      });
      if (result.code !== 0) {
        throw new UpdateFailedError(`${name} mới không chạy được (mã thoát ${result.code}). ${result.stderrTail || result.stdoutTail}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/application control policy|smart app control|blocked this file/i.test(detail)) {
        throw new UpdateFailedError(
          `Windows Application Control đã chặn ${name}. Hãy chọn một bản công cụ đã được Windows/đơn vị quản trị phê duyệt trong Trung tâm công cụ hoặc dùng installer Tubmedia đã ký số. Chi tiết: ${detail}`
        );
      }
      throw error;
    }
  }

  private assertPackageIdle(packageName: ToolPackage): void {
    for (const name of toolsForPackage(packageName)) {
      if (this.processes.isToolActive(name)) {
        throw new UpdateFailedError(`${name} đang được sử dụng. Hãy tạm dừng hoặc hoàn tất tác vụ trước khi cập nhật.`);
      }
    }
  }

  private async updatePackage(packageName: ToolPackage, requiredOnly = false): Promise<void> {
    this.assertPackageIdle(packageName);
    const source = await this.sourceFor(packageName);
    const targetFolder = await this.tools.ensureWritableToolFolder();
    const staging = join(this.managedFolder, '_staging', `${packageName}-${randomUUID()}`);
    const extracted = join(staging, 'extracted');
    const packagePath = join(staging, source.asset.name || `${packageName}.package`);
    await mkdir(extracted, { recursive: true });

    try {
      this.logger.info('update', 'TOOL_DOWNLOAD_STARTED', `Đang tải ${source.asset.name}.`);
      await this.download(source.asset, packagePath);
      await this.verifyDigest(source.asset, packagePath);
      await this.clearWindowsInternetMark(packagePath);

      if (source.archive === 'zip') await extract(packagePath, { dir: extracted });
      else await copyFile(packagePath, join(extracted, source.executableNames[0]!));

      const candidates = new Map<string, string>();
      for (const executableName of source.executableNames) {
        const candidate = await this.findFile(extracted, executableName);
        if (!candidate) throw new UpdateFailedError(`Gói ${source.asset.name} thiếu ${executableName}.`);
        await this.clearWindowsInternetMark(candidate);
        // Do not execute a freshly downloaded binary from the staging folder.
        // Install it atomically first, remove Mark-of-the-Web at the final path,
        // then validate. This avoids Application Control treating a temp path as
        // an untrusted one-off executable and keeps rollback deterministic.
        candidates.set(executableName, candidate);
      }

      const backupFolder = join(targetFolder, '.backups', `${packageName}-${Date.now()}`);
      await mkdir(backupFolder, { recursive: true });
      const installed: string[] = [];

      try {
        for (const [executableName, candidate] of candidates) {
          const destination = join(targetFolder, executableName);
          try {
            await access(destination, constants.R_OK);
            await copyFile(destination, join(backupFolder, executableName));
          } catch {
            // First installation: no old file to back up.
          }

          const temporary = `${destination}.new-${randomUUID()}`;
          await copyFile(candidate, temporary);
          await this.clearWindowsInternetMark(temporary);
          await rm(destination, { force: true });
          await rename(temporary, destination);
          await this.clearWindowsInternetMark(destination);
          installed.push(executableName);

          const toolName = executableName.replace(/\.exe$/i, '') as ToolName;
          if (!requiredOnly || toolName !== 'ffplay') {
            await this.validateCandidate(toolName, destination);
          }
        }

        const validationTools = requiredOnly && packageName === 'ffmpeg-suite'
          ? (['ffmpeg', 'ffprobe'] as ToolName[])
          : toolsForPackage(packageName);
        for (const toolName of validationTools) await this.tools.healthCheck(toolName);
        const broken = validationTools.filter((toolName) => !this.tools.get(toolName).available);
        if (broken.length > 0) {
          throw new UpdateFailedError(`Kiểm tra sau cập nhật thất bại: ${broken.join(', ')}.`);
        }

        const metadata = await this.readMetadata(targetFolder);
        metadata.packages[packageName] = {
          releaseId: source.release.id,
          version: source.version,
          installedAt: new Date().toISOString(),
          sourceUrl: source.asset.browser_download_url
        };
        await this.writeMetadata(targetFolder, metadata);
        this.logger.info('update', 'TOOL_UPDATED', `${packageName} đã cập nhật vào ${targetFolder}.`);
      } catch (error) {
        for (const executableName of installed) {
          const destination = join(targetFolder, executableName);
          const backup = join(backupFolder, executableName);
          await rm(destination, { force: true });
          try { await copyFile(backup, destination); } catch { /* File did not exist before update. */ }
        }
        await this.tools.healthCheck();
        throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  public async update(name: ToolName): Promise<void> {
    await this.updatePackage(packageForTool(name));
  }

  public async updateAll(): Promise<ToolStatus[]> {
    await this.updatePackage('yt-dlp');
    await this.updatePackage('ffmpeg-suite');
    await this.updatePackage('aria2c');
    return this.tools.healthCheck();
  }

  public async repairAll(): Promise<ToolStatus[]> {
    const current = await this.tools.healthCheck();
    const packages = new Set<ToolPackage>();
    for (const status of current) {
      if (!status.available || status.health === 'broken') packages.add(packageForTool(status.name));
    }
    for (const packageName of packages) await this.updatePackage(packageName);
    return this.tools.healthCheck();
  }

  public async repairRequired(): Promise<ToolStatus[]> {
    const current = await this.tools.healthCheck();
    const required = new Set<ToolName>(['yt-dlp', 'ffmpeg', 'ffprobe']);
    const packages = new Set<ToolPackage>();
    for (const status of current) {
      if (required.has(status.name) && (!status.available || status.health === 'broken')) {
        packages.add(packageForTool(status.name));
      }
    }
    for (const packageName of packages) await this.updatePackage(packageName, true);
    return this.tools.healthCheck();
  }

  public async rollback(name: ToolName): Promise<void> {
    const packageName = packageForTool(name);
    this.assertPackageIdle(packageName);
    const targetFolder = await this.tools.ensureWritableToolFolder();
    const backupRoot = join(targetFolder, '.backups');
    const entries = await readdir(backupRoot, { withFileTypes: true }).catch(() => {
      throw new RollbackFailedError('Không có phiên bản sao lưu để khôi phục.');
    });
    const backups = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${packageName}-`))
      .sort((a, b) => b.name.localeCompare(a.name));
    const latest = backups[0];
    if (!latest) throw new RollbackFailedError('Không có phiên bản sao lưu để khôi phục.');

    const backupFolder = join(backupRoot, latest.name);
    for (const toolName of toolsForPackage(packageName)) {
      const executableName = this.tools.executableName(toolName);
      const backup = join(backupFolder, executableName);
      try {
        await access(backup, constants.R_OK);
      } catch {
        continue;
      }
      const destination = join(targetFolder, executableName);
      const temporary = `${destination}.rollback-${randomUUID()}`;
      await copyFile(backup, temporary);
      await rm(destination, { force: true });
      await rename(temporary, destination);
    }
    await this.tools.healthCheck();
    const broken = toolsForPackage(packageName).filter((toolName) => !this.tools.get(toolName).available);
    if (broken.length > 0) throw new RollbackFailedError(`Đã khôi phục phiên bản trước nhưng bước kiểm tra vẫn lỗi: ${broken.join(', ')}.`);
  }
}
