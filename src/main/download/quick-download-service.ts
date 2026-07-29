import { app, shell } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validateQuickDownloadRequest, type QuickDownloadStatus } from '@shared/quick-download.js';
import { buildQuickDownloadArguments } from './quick-download-command.js';

interface ActiveQuickTask {
  status: QuickDownloadStatus;
  process: ChildProcessWithoutNullStreams;
  tempDirectory: string;
  outputToken: string;
  stdoutBuffer: string;
  stderrBuffer: string;
  recentLines: string[];
}

const TERMINAL_PHASES = new Set(['completed', 'cancelled', 'failed']);

function cloneStatus(status: QuickDownloadStatus): QuickDownloadStatus {
  return {
    ...status,
    warnings: [...status.warnings]
  };
}

function parseByteValue(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseProgressPercent(value: string): number {
  const parsed = Number.parseFloat(value.replace('%', '').trim());

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(99.5, parsed));
}

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve({
          stdout: String(stdout),
          stderr: String(stderr)
        });
      }
    );
  });
}

export class QuickDownloadService {
  private activeTask: ActiveQuickTask | null = null;
  private readonly statuses = new Map<string, QuickDownloadStatus>();

  public isActive(): boolean {
    return Boolean(this.activeTask && !TERMINAL_PHASES.has(this.activeTask.status.phase));
  }

  public defaultOutputDirectory(): string {
    return app.getPath('downloads');
  }

  public async start(rawRequest: unknown): Promise<QuickDownloadStatus> {
    const request = validateQuickDownloadRequest(rawRequest);

    if (this.activeTask && !TERMINAL_PHASES.has(this.activeTask.status.phase)) {
      throw new Error(
        'MÃƒÂ¡Ã‚Â»Ã¢â€žÂ¢t video Ãƒâ€žÃ¢â‚¬Ëœang Ãƒâ€žÃ¢â‚¬ËœÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£c tÃƒÂ¡Ã‚ÂºÃ‚Â£i nhanh. HÃƒÆ’Ã‚Â£y chÃƒÂ¡Ã‚Â»Ã‚Â hoÃƒÆ’Ã‚Â n tÃƒÂ¡Ã‚ÂºÃ‚Â¥t hoÃƒÂ¡Ã‚ÂºÃ‚Â·c hÃƒÂ¡Ã‚Â»Ã‚Â§y tÃƒÆ’Ã‚Â¡c vÃƒÂ¡Ã‚Â»Ã‚Â¥ hiÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡n tÃƒÂ¡Ã‚ÂºÃ‚Â¡i.'
      );
    }

    await this.assertWritableDirectory(request.outputDirectory);

    const tools = this.resolveTools();
    const taskId = randomUUID();
    const outputToken = taskId.replaceAll('-', '').slice(0, 12);
    const runToken = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}` + `-${outputToken}`;
    const tempDirectory = join(app.getPath('temp'), 'TubmediaQuickDownload', taskId);

    await mkdir(tempDirectory, { recursive: true });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: dirname(tools.ffmpeg),
      tempDirectory,
      runToken
    });

    const status: QuickDownloadStatus = {
      taskId,
      mode: request.mode,
      phase: 'preparing',
      progress: 0,
      title: '',
      message:
        request.mode === 'range'
          ? 'Ãƒâ€žÃ‚Âang chuÃƒÂ¡Ã‚ÂºÃ‚Â©n bÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹ tÃƒÂ¡Ã‚ÂºÃ‚Â£i Ãƒâ€žÃ¢â‚¬ËœoÃƒÂ¡Ã‚ÂºÃ‚Â¡n video.'
          : 'Ãƒâ€žÃ‚Âang chuÃƒÂ¡Ã‚ÂºÃ‚Â©n bÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹ tÃƒÂ¡Ã‚ÂºÃ‚Â£i toÃƒÆ’Ã‚Â n bÃƒÂ¡Ã‚Â»Ã¢â€žÂ¢ video.',
      speed: '',
      eta: '',
      downloadedBytes: 0,
      totalBytes: 0,
      outputPath: null,
      outputDirectory: request.outputDirectory,
      requestedStartSeconds: request.startSeconds,
      requestedEndSeconds: request.endSeconds,
      actualDurationSeconds: null,
      accurateCut: request.accurateCut,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      warnings: []
    };

    const child = spawn(tools.ytDlp, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: request.outputDirectory
    });
    child.stdin.end();

    const active: ActiveQuickTask = {
      status,
      process: child,
      tempDirectory,
      outputToken,
      stdoutBuffer: '',
      stderrBuffer: '',
      recentLines: []
    };

    this.activeTask = active;
    this.statuses.set(taskId, cloneStatus(status));
    this.pruneStatuses();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      active.stdoutBuffer = this.consumeText(active, active.stdoutBuffer + chunk);
    });

    child.stderr.on('data', (chunk: string) => {
      active.stderrBuffer = this.consumeText(active, active.stderrBuffer + chunk);
    });

    child.once('error', (error) => {
      this.failTask(
        active,
        `KhÃƒÆ’Ã‚Â´ng thÃƒÂ¡Ã‚Â»Ã†â€™ khÃƒÂ¡Ã‚Â»Ã…Â¸i chÃƒÂ¡Ã‚ÂºÃ‚Â¡y yt-dlp: ${error.message}`
      );
    });

    child.once('close', (code) => {
      void this.finishTask(active, code, tools.ffprobe);
    });

    return cloneStatus(status);
  }

  public status(taskId: string): QuickDownloadStatus | null {
    const current = this.statuses.get(taskId);
    return current ? cloneStatus(current) : null;
  }

  public async cancel(taskId: string): Promise<QuickDownloadStatus | null> {
    const active = this.activeTask;

    if (!active || active.status.taskId !== taskId) {
      return this.status(taskId);
    }

    if (TERMINAL_PHASES.has(active.status.phase)) {
      return cloneStatus(active.status);
    }

    active.status.phase = 'cancelling';
    active.status.message =
      'Ãƒâ€žÃ‚Âang dÃƒÂ¡Ã‚Â»Ã‚Â«ng yt-dlp vÃƒÆ’Ã‚Â  cÃƒÆ’Ã‚Â¡c tiÃƒÂ¡Ã‚ÂºÃ‚Â¿n trÃƒÆ’Ã‚Â¬nh FFmpeg liÃƒÆ’Ã‚Âªn quan.';
    this.publish(active);

    await new Promise<void>((resolve) => {
      const killer = spawn(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(active.process.pid ?? 0), '/T', '/F'],
        {
          windowsHide: true,
          stdio: 'ignore'
        }
      );

      killer.once('close', () => resolve());
      killer.once('error', () => {
        active.process.kill();
        resolve();
      });
    });

    return cloneStatus(active.status);
  }

  public revealOutput(taskId: string): boolean {
    const current = this.statuses.get(taskId);

    if (!current?.outputPath || !existsSync(current.outputPath)) {
      return false;
    }

    shell.showItemInFolder(current.outputPath);
    return true;
  }

  private consumeText(active: ActiveQuickTask, text: string): string {
    const lines = text.split(/\r?\n/);
    const remainder = lines.pop() ?? '';

    for (const rawLine of lines) {
      this.consumeLine(active, rawLine.trim());
    }

    return remainder;
  }

  private consumeLine(active: ActiveQuickTask, line: string): void {
    if (!line) {
      return;
    }

    active.recentLines.push(line);

    if (active.recentLines.length > 60) {
      active.recentLines.splice(0, active.recentLines.length - 60);
    }

    if (line.startsWith('TUBMEDIA_TITLE|')) {
      active.status.title = line.slice('TUBMEDIA_TITLE|'.length);
      active.status.phase = 'downloading';
      active.status.message = 'Ãƒâ€žÃ‚Âang tÃƒÂ¡Ã‚ÂºÃ‚Â£i dÃƒÂ¡Ã‚Â»Ã‚Â¯ liÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡u video.';
      this.publish(active);
      return;
    }

    if (line.startsWith('TUBMEDIA_FILE|')) {
      active.status.outputPath = line.slice('TUBMEDIA_FILE|'.length);
      active.status.phase = 'processing';
      active.status.progress = Math.max(99, active.status.progress);
      active.status.message = 'Ãƒâ€žÃ‚Âang hoÃƒÆ’Ã‚Â n tÃƒÂ¡Ã‚ÂºÃ‚Â¥t file video.';
      this.publish(active);
      return;
    }

    if (line.startsWith('TUBMEDIA_PROGRESS|')) {
      const parts = line.split('|');
      active.status.phase = 'downloading';
      active.status.progress = parseProgressPercent(parts[1] ?? '');
      active.status.speed = (parts[2] ?? '').trim();
      active.status.eta = (parts[3] ?? '').trim();
      active.status.downloadedBytes = parseByteValue(parts[4] ?? '');
      active.status.totalBytes = parseByteValue(parts[5] ?? '');
      active.status.message =
        active.status.mode === 'range'
          ? 'Ãƒâ€žÃ‚Âang tÃƒÂ¡Ã‚ÂºÃ‚Â£i Ãƒâ€žÃ¢â‚¬ËœoÃƒÂ¡Ã‚ÂºÃ‚Â¡n video Ãƒâ€žÃ¢â‚¬ËœÃƒÆ’Ã‚Â£ chÃƒÂ¡Ã‚Â»Ã‚Ân.'
          : 'Ãƒâ€žÃ‚Âang tÃƒÂ¡Ã‚ÂºÃ‚Â£i toÃƒÆ’Ã‚Â n bÃƒÂ¡Ã‚Â»Ã¢â€žÂ¢ video.';
      this.publish(active);
    }
  }

  private async finishTask(active: ActiveQuickTask, code: number | null, ffprobePath: string): Promise<void> {
    active.stdoutBuffer = this.consumeText(active, active.stdoutBuffer + '\n');
    active.stderrBuffer = this.consumeText(active, active.stderrBuffer + '\n');

    if (active.status.phase === 'cancelling') {
      active.status.phase = 'cancelled';
      active.status.message = 'Ãƒâ€žÃ‚ÂÃƒÆ’Ã‚Â£ hÃƒÂ¡Ã‚Â»Ã‚Â§y tÃƒÂ¡Ã‚ÂºÃ‚Â£i nhanh.';
      active.status.completedAt = new Date().toISOString();
      this.publish(active);
      await this.cleanupActive(active);
      return;
    }

    if (code !== 0) {
      const detail = this.lastUsefulError(active.recentLines);
      this.failTask(
        active,
        detail
          ? `TÃƒÂ¡Ã‚ÂºÃ‚Â£i video thÃƒÂ¡Ã‚ÂºÃ‚Â¥t bÃƒÂ¡Ã‚ÂºÃ‚Â¡i: ${detail}`
          : `yt-dlp kÃƒÂ¡Ã‚ÂºÃ‚Â¿t thÃƒÆ’Ã‚Âºc vÃƒÂ¡Ã‚Â»Ã¢â‚¬Âºi mÃƒÆ’Ã‚Â£ ${String(code)}.`
      );
      await this.cleanupActive(active);
      return;
    }

    if (!active.status.outputPath || !existsSync(active.status.outputPath)) {
      active.status.outputPath = await this.findOutputByToken(
        active.status.outputDirectory,
        active.outputToken
      );
    }

    if (!active.status.outputPath || !existsSync(active.status.outputPath)) {
      this.failTask(
        active,
        'yt-dlp bÃƒÆ’Ã‚Â¡o hoÃƒÆ’Ã‚Â n tÃƒÂ¡Ã‚ÂºÃ‚Â¥t nhÃƒâ€ Ã‚Â°ng khÃƒÆ’Ã‚Â´ng tÃƒÆ’Ã‚Â¬m thÃƒÂ¡Ã‚ÂºÃ‚Â¥y file Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚ÂºÃ‚Â§u ra.'
      );
      await this.cleanupActive(active);
      return;
    }

    try {
      const duration = await this.readDuration(ffprobePath, active.status.outputPath);
      active.status.actualDurationSeconds = duration;

      if (duration <= 0) {
        throw new Error(
          'FFprobe khÃƒÆ’Ã‚Â´ng Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã‚Âc Ãƒâ€žÃ¢â‚¬ËœÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£c thÃƒÂ¡Ã‚Â»Ã‚Âi lÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£ng video.'
        );
      }

      if (
        active.status.mode === 'range' &&
        active.status.requestedStartSeconds !== null &&
        active.status.requestedEndSeconds !== null
      ) {
        const requestedDuration = active.status.requestedEndSeconds - active.status.requestedStartSeconds;
        const difference = Math.abs(duration - requestedDuration);
        const tolerance = active.status.accurateCut
          ? Math.max(2, requestedDuration * 0.08)
          : Math.max(12, requestedDuration * 0.25);

        if (difference > tolerance) {
          active.status.warnings.push(
            `ThÃƒÂ¡Ã‚Â»Ã‚Âi lÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£ng thÃƒÂ¡Ã‚Â»Ã‚Â±c tÃƒÂ¡Ã‚ÂºÃ‚Â¿ ${duration.toFixed(1)} giÃƒÆ’Ã‚Â¢y khÃƒÆ’Ã‚Â¡c ` +
              `mÃƒÂ¡Ã‚Â»Ã‚Â©c yÃƒÆ’Ã‚Âªu cÃƒÂ¡Ã‚ÂºÃ‚Â§u ${requestedDuration.toFixed(1)} giÃƒÆ’Ã‚Â¢y. ` +
              'Video vÃƒÂ¡Ã‚ÂºÃ‚Â«n Ãƒâ€žÃ¢â‚¬ËœÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£c giÃƒÂ¡Ã‚Â»Ã‚Â¯ lÃƒÂ¡Ã‚ÂºÃ‚Â¡i Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã†â€™ trÃƒÆ’Ã‚Â¡nh xÃƒÆ’Ã‚Â³a nhÃƒÂ¡Ã‚ÂºÃ‚Â§m file hÃƒÂ¡Ã‚Â»Ã‚Â£p lÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡.'
          );
        }
      }
    } catch (error) {
      active.status.warnings.push(
        error instanceof Error
          ? error.message
          : 'KhÃƒÆ’Ã‚Â´ng kiÃƒÂ¡Ã‚Â»Ã†â€™m tra Ãƒâ€žÃ¢â‚¬ËœÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£c thÃƒÂ¡Ã‚Â»Ã‚Âi lÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£ng video.'
      );
    }

    active.status.phase = 'completed';
    active.status.progress = 100;
    active.status.message =
      active.status.mode === 'range'
        ? 'Ãƒâ€žÃ‚ÂÃƒÆ’Ã‚Â£ tÃƒÂ¡Ã‚ÂºÃ‚Â£i xong Ãƒâ€žÃ¢â‚¬ËœoÃƒÂ¡Ã‚ÂºÃ‚Â¡n video.'
        : 'Ãƒâ€žÃ‚ÂÃƒÆ’Ã‚Â£ tÃƒÂ¡Ã‚ÂºÃ‚Â£i xong video.';
    active.status.completedAt = new Date().toISOString();
    this.publish(active);
    await this.cleanupActive(active);
  }

  private failTask(active: ActiveQuickTask, message: string): void {
    if (TERMINAL_PHASES.has(active.status.phase)) {
      return;
    }

    active.status.phase = 'failed';
    active.status.error = message;
    active.status.message = message;
    active.status.completedAt = new Date().toISOString();
    this.publish(active);
  }

  private publish(active: ActiveQuickTask): void {
    this.statuses.set(active.status.taskId, cloneStatus(active.status));
  }

  private async cleanupActive(active: ActiveQuickTask): Promise<void> {
    await rm(active.tempDirectory, {
      recursive: true,
      force: true
    }).catch(() => undefined);

    if (this.activeTask === active) {
      this.activeTask = null;
    }
  }

  private async assertWritableDirectory(directory: string): Promise<void> {
    const info = await stat(directory).catch(() => null);

    if (!info?.isDirectory()) {
      throw new Error(
        'ThÃƒâ€ Ã‚Â° mÃƒÂ¡Ã‚Â»Ã‚Â¥c lÃƒâ€ Ã‚Â°u video khÃƒÆ’Ã‚Â´ng tÃƒÂ¡Ã‚Â»Ã¢â‚¬Å“n tÃƒÂ¡Ã‚ÂºÃ‚Â¡i.'
      );
    }

    await access(directory, fsConstants.W_OK).catch(() => {
      throw new Error(
        'Tubmedia khÃƒÆ’Ã‚Â´ng cÃƒÆ’Ã‚Â³ quyÃƒÂ¡Ã‚Â»Ã‚Ân ghi vÃƒÆ’Ã‚Â o thÃƒâ€ Ã‚Â° mÃƒÂ¡Ã‚Â»Ã‚Â¥c Ãƒâ€žÃ¢â‚¬ËœÃƒÆ’Ã‚Â£ chÃƒÂ¡Ã‚Â»Ã‚Ân.'
      );
    });
  }

  private resolveTools(): {
    ytDlp: string;
    ffmpeg: string;
    ffprobe: string;
  } {
    const appRoot = app.getAppPath();
    const roots = [
      join(process.resourcesPath, 'tool'),
      join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'tool'),
      join(appRoot, 'tool'),
      join(process.cwd(), 'tool')
    ];

    const resolve = (name: string): string => {
      const candidate = roots.map((root) => join(root, `${name}.exe`)).find((item) => existsSync(item));

      if (!candidate) {
        throw new Error(
          `KhÃƒÆ’Ã‚Â´ng tÃƒÆ’Ã‚Â¬m thÃƒÂ¡Ã‚ÂºÃ‚Â¥y cÃƒÆ’Ã‚Â´ng cÃƒÂ¡Ã‚Â»Ã‚Â¥ ${name}.exe trong gÃƒÆ’Ã‚Â³i Tubmedia.`
        );
      }

      return candidate;
    };

    return {
      ytDlp: resolve('yt-dlp'),
      ffmpeg: resolve('ffmpeg'),
      ffprobe: resolve('ffprobe')
    };
  }

  private async readDuration(ffprobePath: string, mediaPath: string): Promise<number> {
    const result = await execFileAsync(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      mediaPath
    ]);
    const duration = Number.parseFloat(result.stdout.trim());

    if (!Number.isFinite(duration)) {
      throw new Error(
        'FFprobe trÃƒÂ¡Ã‚ÂºÃ‚Â£ thÃƒÂ¡Ã‚Â»Ã‚Âi lÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£ng khÃƒÆ’Ã‚Â´ng hÃƒÂ¡Ã‚Â»Ã‚Â£p lÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡.'
      );
    }

    return duration;
  }

  private async findOutputByToken(outputDirectory: string, token: string): Promise<string | null> {
    const entries = await readdir(outputDirectory, {
      withFileTypes: true
    }).catch(() => []);

    const matches: Array<{
      path: string;
      modifiedAt: number;
    }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes(token) || entry.name.endsWith('.part')) {
        continue;
      }

      const fullPath = join(outputDirectory, entry.name);
      const info = await stat(fullPath).catch(() => null);

      if (info && info.size > 0) {
        matches.push({
          path: fullPath,
          modifiedAt: info.mtimeMs
        });
      }
    }

    matches.sort((left, right) => right.modifiedAt - left.modifiedAt);

    return matches[0]?.path ?? null;
  }

  private lastUsefulError(lines: string[]): string | null {
    const ignored = ['TUBMEDIA_PROGRESS|', '[download]', '[Merger]', '[ExtractAudio]'];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];

      if (line && !ignored.some((prefix) => line.startsWith(prefix))) {
        return line.slice(0, 500);
      }
    }

    return null;
  }

  private pruneStatuses(): void {
    if (this.statuses.size <= 30) {
      return;
    }

    const removable = [...this.statuses.entries()]
      .filter(([, status]) => TERMINAL_PHASES.has(status.phase))
      .sort((left, right) => left[1].startedAt.localeCompare(right[1].startedAt));

    while (this.statuses.size > 20 && removable.length > 0) {
      const [taskId] = removable.shift()!;
      this.statuses.delete(taskId);
    }
  }
}
