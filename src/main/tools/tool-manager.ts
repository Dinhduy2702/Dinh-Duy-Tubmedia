import type { BrowserWindow } from 'electron';
import { constants } from 'node:fs';
import { access, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppSettings, ToolStatus } from '@shared/types/domain.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { Logger } from '../logging/logger.js';
import { IPC } from '@shared/contracts/channels.js';

export const TOOL_NAMES = ['yt-dlp', 'ffmpeg', 'ffprobe', 'ffplay', 'aria2c'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const REQUIRED_TOOL_NAMES = ['yt-dlp', 'ffmpeg', 'ffprobe'] as const satisfies readonly ToolName[];
export const OPTIONAL_TOOL_NAMES = ['ffplay', 'aria2c'] as const satisfies readonly ToolName[];

const versionArgs: Record<ToolName, string[]> = {
  'yt-dlp': ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  ffplay: ['-version'],
  aria2c: ['-v']
};

function firstLine(text: string): string | null {
  return text.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? null;
}

function parseVersion(name: ToolName, text: string): string | null {
  const line = firstLine(text);
  if (!line) return null;
  if (name === 'yt-dlp') return /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?/.exec(line)?.[0] ?? line;
  if (name === 'aria2c') return /aria2 version ([\w.-]+)/i.exec(text)?.[1] ?? null;
  return /(?:ffmpeg|ffprobe|ffplay) version\s+([^\s]+)/i.exec(text)?.[1] ?? null;
}

function uniqueCandidates<T extends { path: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = process.platform === 'win32' ? value.path.toLowerCase() : value.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedConfiguredPath(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1').trim();
}

export function verifiedCapabilities(
  name: Exclude<ToolName, 'ffmpeg'>,
  helpText = ''
): string[] {
  const text = helpText.toLowerCase();
  if (name === 'yt-dlp') {
    return [
      'ytdlp_download',
      ...(text.includes('--dump-json') || text.includes('--print-json') ? ['ytdlp_metadata'] : []),
      ...(text.includes('--progress-template') ? ['ytdlp_progress'] : []),
      ...(text.includes('--ffmpeg-location') ? ['ytdlp_ffmpeg_bridge'] : [])
    ];
  }
  if (name === 'ffprobe') {
    return [
      'ffprobe_analysis',
      ...(text.includes('-show_streams') ? ['ffprobe_streams'] : []),
      ...(text.includes('-print_format') || text.includes('-of ') ? ['ffprobe_json'] : [])
    ];
  }
  if (name === 'ffplay') {
    return [
      'ffplay_preview',
      ...(text.includes('-autoexit') ? ['ffplay_autoexit'] : [])
    ];
  }
  return [
    'aria2_download',
    ...(text.includes('--max-connection-per-server') || text.includes('-x,') ? ['aria2_multiconnection'] : [])
  ];
}

export class ToolManager {
  private window: BrowserWindow | null = null;
  private healthCheckTail: Promise<void> = Promise.resolve();
  private requiredReadyTail: Promise<void> = Promise.resolve();
  private requiredRepairHandler: (() => Promise<ToolStatus[]>) | null = null;
  private readonly wingetCandidateCache = new Map<ToolName, string[]>();
  private statuses: ToolStatus[] = TOOL_NAMES.map((name) => ({
    name,
    available: false,
    executablePath: null,
    version: null,
    source: null,
    capabilities: [],
    health: 'broken',
    error: 'Đang tự động kết nối khi ứng dụng khởi động',
    lastCheckedAt: null
  }));

  public constructor(
    private readonly processes: ProcessManager,
    private readonly logger: Logger,
    private readonly getSettings: () => AppSettings,
    private readonly resourcesPath: string,
    private readonly userDataPath: string,
    private readonly appPath: string,
    private readonly packaged: boolean
  ) {}

  public setWindow(window: BrowserWindow): void { this.window = window; }

  public setRequiredRepairHandler(handler: () => Promise<ToolStatus[]>): void {
    this.requiredRepairHandler = handler;
  }

  private requiredMissing(statuses: ToolStatus[]): ToolStatus[] {
    return REQUIRED_TOOL_NAMES
      .map((name) => statuses.find((status) => status.name === name))
      .filter((status): status is ToolStatus => Boolean(status))
      .filter((status) => !status.available || status.health === 'broken' || !status.executablePath);
  }

  /**
   * Bảo đảm ba công cụ bắt buộc sẵn sàng trước khi tạo tác vụ. Mọi lời gọi
   * đồng thời được xếp hàng để chỉ có một lượt tải/sửa công cụ chạy tại một
   * thời điểm. Nếu lần tự sửa thất bại, trạng thái cuối vẫn được health-check
   * lại để UI hiển thị đúng nguyên nhân thay vì tạo hàng loạt job lỗi.
   */
  public ensureRequiredReady(): Promise<ToolStatus[]> {
    const operation = this.requiredReadyTail.then(async () => {
      let statuses = await this.healthCheckRequired();
      if (this.requiredMissing(statuses).length === 0) return statuses;

      if (!this.requiredRepairHandler) {
        this.logger.warn('tools', 'TOOLS_REQUIRED_REPAIR_HANDLER_MISSING', 'Chưa đăng ký bộ tự sửa công cụ bắt buộc.');
        return statuses;
      }

      const missingNames = this.requiredMissing(statuses).map((status) => status.name).join(', ');
      this.logger.warn('tools', 'TOOLS_REQUIRED_REPAIR_ON_DEMAND', `Đang tự tải/sửa công cụ bắt buộc: ${missingNames}.`);
      try {
        statuses = await this.requiredRepairHandler();
      } catch (error) {
        this.logger.warn(
          'tools',
          'TOOLS_REQUIRED_REPAIR_ON_DEMAND_FAILED',
          `Tự sửa công cụ chưa hoàn tất: ${error instanceof Error ? error.message : String(error)}`
        );
        statuses = await this.healthCheckRequired();
      }
      return statuses;
    });
    this.requiredReadyTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private notifyChanged(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(IPC.events.toolsChanged, this.list());
  }

  public list(): ToolStatus[] {
    return structuredClone(this.statuses);
  }

  public get(name: ToolName): ToolStatus {
    return this.statuses.find((status) => status.name === name)!;
  }

  public requiredReady(): boolean {
    return REQUIRED_TOOL_NAMES.every((name) => {
      const status = this.get(name);
      return status.available && status.health !== 'broken' && Boolean(status.executablePath);
    });
  }

  public executableName(name: ToolName): string {
    return process.platform === 'win32' ? `${name}.exe` : name;
  }

  /**
   * Source/dev: update directly in <project>\tool so the folder is portable and easy to repair.
   * Installed app: update in userData\tools\current because Program Files/resources may be read-only.
   */
  public writableToolFolder(): string {
    return this.packaged
      ? join(this.userDataPath, 'tools', 'current')
      : join(this.appPath, 'tool');
  }

  public async ensureWritableToolFolder(): Promise<string> {
    const folder = this.writableToolFolder();
    await mkdir(folder, { recursive: true });
    await access(folder, constants.R_OK | constants.W_OK);
    return folder;
  }

  private configuredPath(name: ToolName): string {
    const settings = this.getSettings();
    if (name === 'yt-dlp') return normalizedConfiguredPath(settings.ytdlpPath);
    if (name === 'ffmpeg') return normalizedConfiguredPath(settings.ffmpegPath);
    if (name === 'ffprobe') return normalizedConfiguredPath(settings.ffprobePath);
    if (name === 'aria2c') return normalizedConfiguredPath(settings.aria2cPath);
    // ffplay is shipped together with FFmpeg. If FFmpeg is configured, prefer its sibling ffplay.exe.
    const ffmpegPath = normalizedConfiguredPath(settings.ffmpegPath);
    return ffmpegPath ? join(dirname(ffmpegPath), this.executableName('ffplay')) : '';
  }

  private async canAccess(path: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async findExecutableBelow(root: string, executable: string, depth: number): Promise<string[]> {
    if (depth < 0) return [];
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const matches: string[] = [];
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) {
        matches.push(path);
      } else if (entry.isDirectory() && depth > 0) {
        matches.push(...await this.findExecutableBelow(path, executable, depth - 1));
      }
    }
    return matches;
  }

  private async wingetPackageCandidates(name: ToolName, executable: string): Promise<string[]> {
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return [];
    const cached = this.wingetCandidateCache.get(name);
    if (cached) return cached;

    const root = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    const prefixes = name === 'yt-dlp'
      ? ['yt-dlp.yt-dlp']
      : name === 'aria2c'
        ? ['aria2.aria2']
        : ['Gyan.FFmpeg', 'BtbN.FFmpeg'];
    const packageFolders = await readdir(root, { withFileTypes: true }).catch(() => []);
    const matches: string[] = [];
    for (const entry of packageFolders) {
      if (!entry.isDirectory() || !prefixes.some((prefix) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))) continue;
      matches.push(...await this.findExecutableBelow(join(root, entry.name), executable, 5));
    }
    const unique = [...new Set(matches)];
    this.wingetCandidateCache.set(name, unique);
    return unique;
  }

  private async resolveCandidates(name: ToolName): Promise<Array<{ path: string; source: ToolStatus['source'] }>> {
    const executable = this.executableName(name);
    const configured = this.configuredPath(name);
    const candidates: Array<{ path: string; source: ToolStatus['source'] }> = [];
    const addFromEnvironment = (folder: string | undefined, ...parts: string[]): void => {
      if (folder) candidates.push({ path: join(folder, ...parts, executable), source: 'local' });
    };

    if (configured) candidates.push({ path: configured, source: 'local' });

    // The user's portable folder: <project>\tool\yt-dlp.exe, ffmpeg.exe, ffprobe.exe, ffplay.exe...
    candidates.push({ path: join(this.appPath, 'tool', executable), source: 'local' });
    candidates.push({ path: join(this.appPath, 'tools', executable), source: 'local' });
    candidates.push({ path: join(process.cwd(), 'tool', executable), source: 'local' });
    candidates.push({ path: join(process.cwd(), 'tools', executable), source: 'local' });

    // Portable builds are often placed beside the Electron executable instead
    // of inside app.asar. Check both direct and nested tool folders.
    const executableFolder = dirname(process.execPath);
    candidates.push({ path: join(executableFolder, executable), source: 'local' });
    candidates.push({ path: join(executableFolder, 'tool', executable), source: 'local' });
    candidates.push({ path: join(executableFolder, 'tools', executable), source: 'local' });

    // Updates for an installed application are stored here so they do not require admin rights.
    candidates.push({ path: join(this.userDataPath, 'tools', 'current', executable), source: 'managed' });

    // Installer-bundled tools. Support both singular "tool" and legacy "tools" directories.
    candidates.push({ path: join(this.resourcesPath, 'tool', executable), source: 'bundled' });
    candidates.push({ path: join(this.resourcesPath, 'tools', executable), source: 'bundled' });

    // Common Windows package-manager shims. PATH is still checked last, but
    // explicit paths make discovery reliable when Electron inherited an old
    // PATH before winget/Scoop/Chocolatey changed it.
    addFromEnvironment(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links');
    for (const path of await this.wingetPackageCandidates(name, executable)) {
      candidates.push({ path, source: 'local' });
    }
    addFromEnvironment(process.env.USERPROFILE, 'scoop', 'shims');
    addFromEnvironment(process.env.ChocolateyInstall, 'bin');
    addFromEnvironment(process.env.ProgramData, 'chocolatey', 'bin');

    const accessible: Array<{ path: string; source: ToolStatus['source'] }> = [];
    for (const candidate of uniqueCandidates(candidates)) {
      if (await this.canAccess(candidate.path)) accessible.push(candidate);
    }
    // PATH remains the final fallback even though access() cannot resolve command names.
    accessible.push({ path: name, source: 'path' });
    return accessible;
  }

  private enqueueHealthCheck(targets: readonly ToolName[]): Promise<ToolStatus[]> {
    const operation = this.healthCheckTail.then(() => this.performHealthCheck(targets));
    this.healthCheckTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  public healthCheck(name?: ToolName): Promise<ToolStatus[]> {
    return this.enqueueHealthCheck(name ? [name] : TOOL_NAMES);
  }

  public healthCheckRequired(): Promise<ToolStatus[]> {
    return this.enqueueHealthCheck(REQUIRED_TOOL_NAMES);
  }

  public healthCheckOptional(): Promise<ToolStatus[]> {
    return this.enqueueHealthCheck(OPTIONAL_TOOL_NAMES);
  }

  private async performHealthCheck(targets: readonly ToolName[]): Promise<ToolStatus[]> {
    for (const tool of targets) {
      const checkedAt = new Date().toISOString();
      const candidates = await this.resolveCandidates(tool);
      const failures: string[] = [];
      let healthy: ToolStatus | null = null;

      for (const candidate of candidates) {
        try {
          const result = await this.processes.run({
            jobId: `health-${tool}`,
            tool,
            executablePath: candidate.path,
            args: versionArgs[tool],
            timeoutMs: 15_000,
            priority: 'below_normal'
          });
          const merged = `${result.stdoutTail}\n${result.stderrTail}`;
          const version = result.code === 0 ? parseVersion(tool, merged) : null;
          if (result.code !== 0 || !version) {
            throw new Error(`Kiểm tra phiên bản thất bại (exit ${result.code}).`);
          }
          let capabilities: string[];
          try {
            capabilities = await this.toolCapabilities(tool, candidate.path);
          } catch (error) {
            capabilities = tool === 'ffmpeg' ? [] : verifiedCapabilities(tool);
            this.logger.warn(
              'tools',
              'TOOL_CAPABILITY_CHECK_FAILED',
              `${tool} đã chạy được và đọc được phiên bản, nhưng bước nhận diện khả năng chi tiết chưa hoàn tất: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          healthy = {
            name: tool,
            available: true,
            executablePath: candidate.path,
            version,
            source: candidate.source,
            capabilities,
            health: tool === 'ffmpeg' && !capabilities.includes('libx264') ? 'warning' : 'healthy',
            error: null,
            lastCheckedAt: checkedAt
          };
          break;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          failures.push(`${candidate.path}: ${detail}`);
        }
      }

      const status: ToolStatus = healthy ?? {
        name: tool,
        available: false,
        executablePath: candidates[0]?.path ?? tool,
        version: null,
        source: candidates[0]?.source ?? 'path',
        capabilities: [],
        health: 'broken',
        error: failures.join(' | ') || 'Không tìm thấy hoặc không thể chạy công cụ.',
        lastCheckedAt: checkedAt
      };
      this.statuses = this.statuses.map((current) => current.name === tool ? status : current);
      if (!healthy) this.logger.warn('tools', 'TOOL_HEALTH_FAILED', `${tool}: ${status.error}`);
    }
    this.notifyChanged();
    return this.list();
  }

  private async toolCapabilities(name: ToolName, path: string): Promise<string[]> {
    if (name === 'ffmpeg') return this.ffmpegCapabilities(path);
    const helpArgs = name === 'aria2c' ? ['--help=#all'] : ['-h'];
    const result = await this.processes.run({
      jobId: `health-${name}-capabilities`,
      tool: name,
      executablePath: path,
      args: helpArgs,
      timeoutMs: 20_000,
      priority: 'below_normal'
    });
    const text = `${result.stdoutTail}\n${result.stderrTail}`;
    return verifiedCapabilities(name, result.code === 0 ? text : '');
  }

  private async ffmpegCapabilities(path: string): Promise<string[]> {
    const [encoders, filters, muxers] = await Promise.all([
      this.processes.run({ jobId: 'health-ffmpeg-encoders', tool: 'ffmpeg', executablePath: path, args: ['-hide_banner', '-encoders'], timeoutMs: 20_000 }),
      this.processes.run({ jobId: 'health-ffmpeg-filters', tool: 'ffmpeg', executablePath: path, args: ['-hide_banner', '-filters'], timeoutMs: 20_000 }),
      this.processes.run({ jobId: 'health-ffmpeg-muxers', tool: 'ffmpeg', executablePath: path, args: ['-hide_banner', '-muxers'], timeoutMs: 20_000 })
    ]);
    const text = `${encoders.stdoutTail}\n${encoders.stderrTail}\n${filters.stdoutTail}\n${filters.stderrTail}\n${muxers.stdoutTail}\n${muxers.stderrTail}`;
    const capabilityNames = ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'aac', 'zscale', 'tonemap', 'concat', 'mp4'];
    const capabilities = capabilityNames.filter((capability) => text.includes(capability));
    for (const encoder of ['h264_nvenc', 'hevc_nvenc'] as const) {
      if (!capabilities.includes(encoder)) continue;
      const test = await this.processes.run({
        jobId: `health-${encoder}-encode`,
        tool: 'ffmpeg',
        executablePath: path,
        args: ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-'],
        timeoutMs: 20_000,
        priority: 'below_normal'
      });
      if (test.code !== 0) {
        capabilities.splice(capabilities.indexOf(encoder), 1);
        capabilities.push(`${encoder}_unavailable`);
      }
    }
    if (capabilities.includes('libx264')) capabilities.push('cpu_auto');
    return capabilities;
  }
}
