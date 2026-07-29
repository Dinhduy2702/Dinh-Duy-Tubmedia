import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { LogEntry } from '@shared/types/domain.js';
import { IPC } from '@shared/contracts/channels.js';
import type { LogRepository } from '../database/repositories/log-repository.js';
import { redactSecrets } from '@shared/utils/secret-redaction.js';

interface PendingFileWrite {
  path: string;
  content: string;
  generation: number;
}

/**
 * Nhật ký vẫn được ghi vào SQLite ngay lập tức để trạng thái chẩn đoán bền vững.
 * Phần file text được gom theo lô nhỏ và ghi nối tiếp ở nền. Điều này tránh
 * appendFileSync/statSync chặn Electron main thread mỗi khi yt-dlp/ffmpeg phát log,
 * vốn là một nguồn gây khựng giao diện khi nhiều worker chạy song song.
 */
export class Logger {
  private window: BrowserWindow | null = null;
  private pendingWrites = new Map<string, string[]>();
  private fileWriteTail: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | null = null;
  private writeGeneration = 0;
  private readonly fileFlushDelayMs = 140;

  public constructor(
    private readonly repo: LogRepository,
    private readonly logFolder: string,
    private readonly maxBytes = 20 * 1024 * 1024
  ) {
    mkdirSync(logFolder, { recursive: true });
  }

  public setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  private async rotate(path: string): Promise<void> {
    try {
      const details = await stat(path);
      if (details.size < this.maxBytes) return;
    } catch {
      return;
    }

    const old = `${path}.1`;
    try {
      await rename(old, `${old}.${Date.now()}`);
    } catch {
      // Bản xoay trước không tồn tại hoặc đang bị khóa; vẫn thử xoay file hiện tại.
    }
    try {
      await rename(path, old);
    } catch {
      // Không để file log bị khóa làm gián đoạn tác vụ media.
    }
  }

  private enqueueFile(path: string, serialized: string): void {
    const current = this.pendingWrites.get(path);
    if (current) current.push(serialized);
    else this.pendingWrites.set(path, [serialized]);

    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.queuePendingWrites();
    }, this.fileFlushDelayMs);
    this.flushTimer.unref?.();
  }

  private queuePendingWrites(): void {
    if (this.pendingWrites.size === 0) return;
    const generation = this.writeGeneration;
    const batch: PendingFileWrite[] = [...this.pendingWrites.entries()].map(([path, chunks]) => ({
      path,
      content: chunks.join(''),
      generation
    }));
    this.pendingWrites.clear();

    this.fileWriteTail = this.fileWriteTail
      .then(async () => {
        for (const item of batch) {
          if (item.generation !== this.writeGeneration) continue;
          try {
            await mkdir(dirname(item.path), { recursive: true });
            await this.rotate(item.path);
            if (item.generation !== this.writeGeneration) continue;
            await appendFile(item.path, item.content, 'utf8');
          } catch {
            // SQLite là nguồn log chính. File text chỉ là bản chẩn đoán phụ,
            // vì vậy lỗi I/O không được phép làm sập ứng dụng.
          }
        }
      })
      .catch(() => undefined);
  }

  /** Ghi hết batch còn chờ trước khi đóng database/cài bản cập nhật. */
  public async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.queuePendingWrites();
    await this.fileWriteTail;
  }

  private write(
    level: LogEntry['level'],
    module: string,
    eventCode: string,
    message: string,
    context: Partial<Pick<LogEntry, 'projectId' | 'jobId' | 'attemptId'>> & {
      metadata?: Record<string, unknown>;
    } = {}
  ): LogEntry {
    const safeMetadata = context.metadata
      ? (redactSecrets(context.metadata) as Record<string, unknown>)
      : undefined;
    const entry = this.repo.insert({
      timestamp: new Date().toISOString(),
      level,
      module,
      eventCode,
      message: String(redactSecrets(message)),
      ...(context.projectId ? { projectId: context.projectId } : {}),
      ...(context.jobId ? { jobId: context.jobId } : {}),
      ...(context.attemptId ? { attemptId: context.attemptId } : {}),
      ...(safeMetadata ? { metadata: safeMetadata } : {})
    });

    const serialized = `${JSON.stringify(entry)}\n`;
    this.enqueueFile(join(this.logFolder, `${module}.log`), serialized);
    if (entry.projectId) {
      this.enqueueFile(join(this.logFolder, 'projects', `${entry.projectId}.log`), serialized);
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC.events.log, entry);
    }
    return entry;
  }

  public pruneFiles(retentionDays: number): number {
    if (!existsSync(this.logFolder)) return 0;
    const safeDays = Math.max(1, Math.min(3650, Math.round(retentionDays || 30)));
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1_000;
    let removed = 0;
    const walk = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          try {
            if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true });
          } catch {
            // Một tiến trình ghi log có thể vừa sử dụng thư mục; sẽ thử lại lần sau.
          }
          continue;
        }
        try {
          if (statSync(path).mtimeMs < cutoff) {
            rmSync(path, { force: true });
            removed += 1;
          }
        } catch {
          // Bỏ qua file đang bị khóa; không để cleanup ảnh hưởng khởi động ứng dụng.
        }
      }
    };
    walk(this.logFolder);
    return removed;
  }

  public clearProject(projectId: string): number {
    const removed = this.repo.clear(projectId);
    const projectPath = join(this.logFolder, 'projects', `${projectId}.log`);
    this.pendingWrites.delete(projectPath);
    rmSync(projectPath, { force: true });
    return removed;
  }

  public clearAll(): number {
    const removed = this.repo.clear();
    this.writeGeneration += 1;
    this.pendingWrites.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    rmSync(this.logFolder, { recursive: true, force: true });
    mkdirSync(this.logFolder, { recursive: true });
    return removed;
  }

  public debug(module: string, code: string, message: string, context?: Parameters<Logger['write']>[4]): LogEntry {
    return this.write('debug', module, code, message, context);
  }
  public info(module: string, code: string, message: string, context?: Parameters<Logger['write']>[4]): LogEntry {
    return this.write('info', module, code, message, context);
  }
  public warn(module: string, code: string, message: string, context?: Parameters<Logger['write']>[4]): LogEntry {
    return this.write('warn', module, code, message, context);
  }
  public error(module: string, code: string, message: string, context?: Parameters<Logger['write']>[4]): LogEntry {
    return this.write('error', module, code, message, context);
  }
}
