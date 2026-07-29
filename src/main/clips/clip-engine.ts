import { rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { sanitizeProgress } from '@shared/utils/progress-policy.js';
import type { ProjectItem, QueueJob, ResourceProfile } from '@shared/types/domain.js';
import { ToolNotFoundError, ProcessingFailedError } from '@shared/errors/app-errors.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { FileVerifier } from '../media/file-verifier.js';
import type { QuarantineService } from '../media/quarantine-service.js';
import { ensureDirectory } from '../files/ensure-directory.js';
import { ensureTubmediaOwnedDirectory, isReservedTubmediaDirectory } from '../files/file-ownership.js';
export class ClipEngine {
  public constructor(private readonly tools: ToolManager, private readonly processes: ProcessManager, private readonly verifier: FileVerifier, private readonly quarantine: QuarantineService) {}
  public async create(job: QueueJob, item: ProjectItem, input: string, tempFolder: string, resource: ResourceProfile, signal: AbortSignal, onProgress: (percent: number) => void): Promise<string> {
    const ffmpeg = this.tools.get('ffmpeg'); if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');
    if (item.timestampStartSeconds === null && item.timestampEndSeconds === null && item.audioMode !== 'mute') return input;
    await ensureDirectory(tempFolder);
    if (isReservedTubmediaDirectory(tempFolder)) await ensureTubmediaOwnedDirectory(tempFolder, 'download-temp');
    const hasCut = item.timestampStartSeconds !== null || item.timestampEndSeconds !== null;
    const muteOnly = item.audioMode === 'mute' && !hasCut;
    const sourceExtension = extname(input).toLowerCase();
    const outputExtension = muteOnly && sourceExtension ? sourceExtension : '.mp4';
    const final = join(tempFolder, `clip-${item.position}-${item.id}${outputExtension}`);
    const pending = `${final}.pending${outputExtension}`;
    const args = ['-hide_banner', '-y'];
    if (item.timestampStartSeconds !== null) args.push('-ss', String(item.timestampStartSeconds));
    args.push('-i', input);
    if (item.timestampEndSeconds !== null) {
      const duration = item.timestampStartSeconds !== null ? item.timestampEndSeconds - item.timestampStartSeconds : item.timestampEndSeconds;
      args.push('-t', String(Math.max(0.01, duration)));
    }
    args.push('-map', '0:v:0');
    if (item.audioMode === 'mute') args.push('-an');
    else args.push('-map', '0:a:0?');
    if (muteOnly) {
      args.push('-c:v', 'copy');
    } else {
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', String(resource.ffmpegThreads), '-filter_threads', String(resource.filterThreads));
      if (item.audioMode !== 'mute') args.push('-c:a', 'aac', '-ar', '48000');
      args.push('-movflags', '+faststart');
    }
    args.push('-progress', 'pipe:1', '-nostats', pending);
    const expected = item.timestampEndSeconds !== null ? item.timestampEndSeconds - (item.timestampStartSeconds ?? 0) : 0;
    const result = await this.processes.run({ jobId: job.id, projectId: job.projectId, tool: 'ffmpeg', executablePath: ffmpeg.executablePath, args, priority: resource.processPriority, signal, timeoutMs: 24 * 60 * 60 * 1000, onStdoutLine: line => { if (!line.startsWith('out_time_ms=') || !Number.isFinite(expected) || expected <= 0) return; const microseconds=Number(line.slice(12)); if (!Number.isFinite(microseconds)) return; onProgress(sanitizeProgress(microseconds / 1_000_000 / expected * 100)); } });
    if (result.code !== 0) {
      try { await this.quarantine.move(pending, join(tempFolder, '_quarantine'), result.stderrTail || 'Tạo đoạn video thất bại.', job.id); } catch { /* pending chưa tồn tại */ }
      throw new ProcessingFailedError(result.stderrTail || 'Tạo đoạn video thất bại.');
    }
    const check = await this.verifier.verify(pending, 'standard', expected > 0 ? expected : undefined);
    if (!check.ok) {
      const quarantined = await this.quarantine.move(pending, join(tempFolder, '_quarantine'), check.reasons.join('; '), job.id);
      throw new ProcessingFailedError(`Đoạn video bị lỗi và đã chuyển vào khu cách ly: ${quarantined}`);
    }
    await rm(final, { force: true }); await rename(pending, final); onProgress(100); return final;
  }
}
