import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { LogEntry, MediaSource, Project, ProjectItem, QueueJob, ToolStatus } from '@shared/types/domain.js';
import type { ErrorReportStatus } from '@shared/types/error-report.js';
import { sanitizeFilename } from '@shared/utils/filename.js';
import { redactSecrets } from '@shared/utils/secret-redaction.js';
import { MANAGED_TOOL_METADATA_FILE } from '../tools/tool-manager.js';
import type { MediaAnalyzer } from '../media/media-analyzer.js';
import type { FileVerifier } from '../media/file-verifier.js';
import { buildZip, type ZipEntry } from '../files/zip-writer.js';

/**
 * "Xuất báo cáo lỗi" (2026-10-20): thay cho khối lệnh PowerShell gom bằng chứng của vụ MERGE_FAILED 2026-10-15. Một tệp
 * .zip gồm: thông tin app/máy/công cụ (kèm nguồn gốc ffmpeg — bản đi kèm hay tools\current), tác vụ lỗi, nhật ký của tác vụ
 * và danh sách, và cho TỪNG video nguồn (+ tệp cắt + bản đệm chuẩn hóa/remux): dung lượng, ngày sửa, SHA256, thông số
 * luồng, kết quả GIẢI MÃ LẠI toàn bộ hình và tiếng. Giải mã lại MỌI nguồn vì hậu kiểm thành phẩm chỉ nêu thời điểm, không
 * nêu nguồn nào hỏng (vụ NA361). Không kèm tệp video.
 */

export interface ErrorReportDeps {
  getJob(id: string): QueueJob | null;
  getProject(id: string): Project | null;
  listItems(projectId: string): ProjectItem[];
  getSource(id: string): MediaSource | null;
  listLogs(query: { jobId?: string; projectId?: string; limit: number }): LogEntry[];
  listTools(): ToolStatus[];
  analyzer: Pick<MediaAnalyzer, 'analyze'>;
  verifier: Pick<FileVerifier, 'decodeStreamFailure'>;
  appInfo(): { appVersion: string; buildCommit: string };
  hardware(): Promise<unknown>;
}

type FileRole = 'nguồn' | 'tệp cắt' | 'bản đệm chuẩn hóa' | 'bản đệm remux';

export interface ReportedFile {
  role: FileRole;
  position: number | null;
  path: string;
  exists: boolean;
  bytes: number | null;
  modifiedAt: string | null;
  sha256: string | null;
  probe: Record<string, unknown> | null;
  probeError: string | null;
  /** 'ok' | 'không có luồng' | câu lỗi ffmpeg | 'không kiểm được: …' */
  videoDecode: string | null;
  audioDecode: string | null;
}

const LOG_LIMIT = 5_000;

/** Tên gợi ý: Tubmedia-bao-cao-loi-<danh sách>-<8 ký tự mã tác vụ>-<ngày giờ>.zip (bỏ ký tự không hợp lệ trên Windows). */
export function errorReportFileName(job: Pick<QueueJob, 'id'>, projectName: string | null, at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const name = projectName ? sanitizeFilename(projectName).slice(0, 60) + '-' : '';
  return `Tubmedia-bao-cao-loi-${name}${job.id.slice(0, 8)}-${stamp}.zip`;
}

export function cacheFilesFor(tempFolder: string, file: string, names: Record<'normalize' | 'remux', string[]>): Array<{ role: FileRole; path: string }> {
  const stem = sanitizeFilename(basename(file).replace(/\.[^.]+$/, ''));
  const pick = (folder: string, list: string[], role: FileRole): Array<{ role: FileRole; path: string }> =>
    list
      .filter((name) => name.startsWith(stem + '.') && /\.mp4$/i.test(name) && !/\.pending\.mp4$/i.test(name))
      .map((name) => ({ role, path: join(tempFolder, folder, name) }));
  return [
    ...pick('_normalized-cache', names.normalize, 'bản đệm chuẩn hóa'),
    ...pick('_remux-cache', names.remux, 'bản đệm remux')
  ];
}

async function listFolder(path: string): Promise<string[]> {
  return readdir(path).catch(() => []);
}

async function sha256(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash, { signal });
  return hash.digest('hex');
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Đã hủy tạo báo cáo lỗi.');
}

/** Các tệp cần kiểm: tác vụ ghép → mọi video đang bật của danh sách; tác vụ khác → đúng nguồn/mục của tác vụ. */
function targetFiles(deps: ErrorReportDeps, job: QueueJob, project: Project | null): Array<{ role: FileRole; position: number | null; path: string }> {
  const out: Array<{ role: FileRole; position: number | null; path: string }> = [];
  const items = project ? deps.listItems(project.id).filter((item) => item.enabled && item.validity !== 'invalid') : [];
  const chosen = job.type === 'merge' ? items : items.filter((item) => item.id === job.itemId || (job.sourceId && item.sourceId === job.sourceId));
  for (const item of chosen) {
    const source = item.sourceId ? deps.getSource(item.sourceId) : null;
    if (source?.sourceFile) out.push({ role: 'nguồn', position: item.position, path: source.sourceFile });
    if (item.clipFile) out.push({ role: 'tệp cắt', position: item.position, path: item.clipFile });
  }
  if (!chosen.length && job.sourceId) {
    const source = deps.getSource(job.sourceId);
    if (source?.sourceFile) out.push({ role: 'nguồn', position: null, path: source.sourceFile });
  }
  return out;
}

async function inspectFile(
  deps: ErrorReportDeps,
  target: { role: FileRole; position: number | null; path: string },
  ffmpegReady: boolean,
  signal: AbortSignal,
  jobId: string
): Promise<ReportedFile> {
  const base: ReportedFile = {
    role: target.role,
    position: target.position,
    path: target.path,
    exists: false,
    bytes: null,
    modifiedAt: null,
    sha256: null,
    probe: null,
    probeError: null,
    videoDecode: null,
    audioDecode: null
  };
  const info = await stat(target.path).catch(() => null);
  if (!info?.isFile()) return base;
  const file: ReportedFile = { ...base, exists: true, bytes: info.size, modifiedAt: info.mtime.toISOString() };
  file.sha256 = await sha256(target.path, signal).catch((error: unknown) => {
    if (signal.aborted) throw abortError(signal);
    return 'không đọc được: ' + (error instanceof Error ? error.message : String(error));
  });

  let hasVideo = true;
  let hasAudio = true;
  try {
    const media = await deps.analyzer.analyze(target.path, jobId + '-report');
    hasVideo = media.width > 0 && media.height > 0;
    hasAudio = Boolean(media.audioCodec);
    file.probe = {
      duration: media.duration,
      videoCodec: media.videoCodec,
      width: media.width,
      height: media.height,
      fps: media.fps,
      pixelFormat: media.pixelFormat,
      timeBase: media.timeBase,
      audioCodec: media.audioCodec,
      sampleRate: media.sampleRate,
      channels: media.channels,
      videoStreamDuration: media.videoStreamDuration ?? null,
      audioStreamDuration: media.audioStreamDuration ?? null
    };
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    file.probeError = error instanceof Error ? error.message : String(error);
  }

  if (!ffmpegReady) {
    file.videoDecode = file.audioDecode = 'không kiểm được: thiếu ffmpeg';
    return file;
  }
  const decode = async (stream: 'video' | 'audio', present: boolean): Promise<string> => {
    if (!present) return 'không có luồng';
    const failure = await deps.verifier.decodeStreamFailure(target.path, stream, { jobId: jobId + '-report', signal });
    if (signal.aborted) throw abortError(signal);
    return failure ?? 'ok';
  };
  file.videoDecode = await decode('video', hasVideo);
  file.audioDecode = await decode('audio', hasAudio);
  return file;
}

function verdict(file: ReportedFile): string {
  if (!file.exists) return 'KHÔNG CÒN TRÊN Ổ';
  const broken = [
    file.videoDecode && !['ok', 'không có luồng'].includes(file.videoDecode) ? 'HỎNG HÌNH' : '',
    file.audioDecode && !['ok', 'không có luồng'].includes(file.audioDecode) ? 'HỎNG TIẾNG' : ''
  ].filter(Boolean);
  if (broken.length) return broken.join(' + ');
  if (file.probeError) return 'KHÔNG ĐỌC ĐƯỢC THÔNG SỐ';
  if (file.videoDecode?.startsWith('không kiểm được')) return 'CHƯA KIỂM (thiếu ffmpeg)';
  return 'sạch';
}

function summaryText(report: { appVersion: string; job: QueueJob; projectName: string | null; ffmpeg: ToolStatus | undefined; files: ReportedFile[] }): string {
  const lines = [
    'BÁO CÁO LỖI TUBMEDIA',
    `Phiên bản app: ${report.appVersion}`,
    `Danh sách: ${report.projectName ?? '(không có)'}`,
    `Tác vụ: ${report.job.type} · ${report.job.status} · ${report.job.errorCode ?? ''}`,
    `Lỗi: ${report.job.errorMessage ?? '(không có câu lỗi)'}`,
    `ffmpeg: ${report.ffmpeg?.version ?? '?'} · ${report.ffmpeg?.source ?? '?'} · ${report.ffmpeg?.executablePath ?? '?'}`,
    '',
    `KIỂM LẠI ${report.files.length} TỆP (giải mã toàn bộ hình + tiếng):`
  ];
  for (const file of report.files) {
    const where = file.position !== null ? `#${file.position} ` : '';
    lines.push(`- ${where}[${file.role}] ${basename(file.path)}: ${verdict(file)}`);
    if (file.videoDecode && !['ok', 'không có luồng'].includes(file.videoDecode)) lines.push(`    hình: ${file.videoDecode}`);
    if (file.audioDecode && !['ok', 'không có luồng'].includes(file.audioDecode)) lines.push(`    tiếng: ${file.audioDecode}`);
  }
  lines.push('', 'Chi tiết đầy đủ: bao-cao.json (SHA256, thông số luồng) và thư mục nhat-ky/.');
  return lines.join('\r\n') + '\r\n';
}

export async function collectErrorReport(
  deps: ErrorReportDeps,
  jobId: string,
  signal: AbortSignal,
  onStep: (step: string, current: number, total: number) => void
): Promise<ZipEntry[]> {
  const job = deps.getJob(jobId);
  if (!job) throw new Error('Không tìm thấy tác vụ để xuất báo cáo.');
  const project = job.projectId ? deps.getProject(job.projectId) : null;
  onStep('Đang gom thông tin tác vụ và nhật ký', 0, 0);

  const tools = deps.listTools();
  const toolMetadata: Record<string, unknown> = {};
  for (const tool of tools) {
    if (tool.source !== 'managed' || !tool.executablePath) continue;
    const metadataPath = join(dirname(tool.executablePath), MANAGED_TOOL_METADATA_FILE);
    if (metadataPath in toolMetadata) continue;
    toolMetadata[metadataPath] = await readFile(metadataPath, 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .catch((error: unknown) => 'không đọc được: ' + (error instanceof Error ? error.message : String(error)));
  }

  const jobLogs = deps.listLogs({ jobId, limit: LOG_LIMIT });
  const projectLogs = project ? deps.listLogs({ projectId: project.id, limit: LOG_LIMIT }) : [];
  const failure = jobLogs.find((entry) => entry.eventCode === 'JOB_FAILED') ?? null;

  const primary = targetFiles(deps, job, project);
  const targets: Array<{ role: FileRole; position: number | null; path: string }> = [...primary];
  if (project) {
    const names = {
      normalize: await listFolder(join(project.tempFolder, '_normalized-cache')),
      remux: await listFolder(join(project.tempFolder, '_remux-cache'))
    };
    for (const file of primary) {
      for (const cache of cacheFilesFor(project.tempFolder, file.path, names)) targets.push({ ...cache, position: file.position });
    }
  }

  const ffmpeg = tools.find((tool) => tool.name === 'ffmpeg');
  const ffmpegReady = Boolean(ffmpeg?.available && ffmpeg.executablePath);
  const files: ReportedFile[] = [];
  for (const [index, target] of targets.entries()) {
    if (signal.aborted) throw abortError(signal);
    onStep(`Đang kiểm ${target.role} ${index + 1}/${targets.length}: ${basename(target.path)}`, index, targets.length);
    files.push(await inspectFile(deps, target, ffmpegReady, signal, jobId));
  }
  onStep('Đang đóng gói báo cáo', targets.length, targets.length);

  const app = deps.appInfo();
  const report = {
    exportedAt: new Date().toISOString(),
    appVersion: app.appVersion,
    buildCommit: app.buildCommit,
    platform: { os: process.platform, release: process.getSystemVersion?.() ?? null, arch: process.arch },
    hardware: await deps.hardware().catch(() => null),
    tools,
    toolMetadata,
    job,
    failure,
    project: project
      ? { id: project.id, name: project.name, code: project.code, status: project.status, tempFolder: project.tempFolder, outputFolder: project.outputFolder }
      : null,
    files
  };
  const jsonl = (entries: LogEntry[]): string =>
    entries
      .slice()
      .reverse()
      .map((entry) => JSON.stringify(redactSecrets(entry)))
      .join('\n') + '\n';
  return [
    { name: 'tom-tat.txt', data: summaryText({ appVersion: app.appVersion, job, projectName: project?.name ?? null, ffmpeg, files }) },
    { name: 'bao-cao.json', data: JSON.stringify(redactSecrets(report), null, 2) },
    { name: 'nhat-ky/tac-vu.jsonl', data: jsonl(jobLogs) },
    ...(project ? [{ name: 'nhat-ky/danh-sach.jsonl', data: jsonl(projectLogs) }] : [])
  ];
}

interface Run {
  status: ErrorReportStatus;
  controller: AbortController;
}

export class ErrorReportService {
  private readonly runs = new Map<string, Run>();

  public constructor(private readonly deps: ErrorReportDeps) {}

  public isActive(): boolean {
    return [...this.runs.values()].some((run) => run.status.state === 'running');
  }

  public start(jobId: string, outputPath: string): ErrorReportStatus {
    for (const run of this.runs.values()) {
      if (run.status.state === 'running') throw new Error('Đang tạo một báo cáo lỗi khác — chờ xong hoặc hủy trước.');
    }
    const runId = randomUUID();
    const controller = new AbortController();
    const run: Run = {
      controller,
      status: { runId, jobId, state: 'running', step: 'Đang bắt đầu', current: 0, total: 0, outputPath, error: null }
    };
    this.runs.set(runId, run);
    void this.execute(run);
    return { ...run.status };
  }

  public status(runId: string): ErrorReportStatus | null {
    const run = this.runs.get(runId);
    return run ? { ...run.status } : null;
  }

  public cancel(runId: string): ErrorReportStatus | null {
    const run = this.runs.get(runId);
    if (run?.status.state === 'running') run.controller.abort(new Error('Đã hủy tạo báo cáo lỗi.'));
    return run ? { ...run.status } : null;
  }

  private async execute(run: Run): Promise<void> {
    const { status, controller } = run;
    const partial = status.outputPath + '.' + status.runId.slice(0, 8) + '.part';
    try {
      const entries = await collectErrorReport(this.deps, status.jobId, controller.signal, (step, current, total) => {
        Object.assign(status, { step, current, total });
      });
      if (controller.signal.aborted) throw abortError(controller.signal);
      await writeFile(partial, buildZip(entries), { flag: 'wx' });
      await rename(partial, status.outputPath);
      Object.assign(status, { state: 'completed', step: 'Đã xuất báo cáo lỗi' });
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      const cancelled = controller.signal.aborted;
      Object.assign(status, {
        state: cancelled ? 'cancelled' : 'failed',
        step: cancelled ? 'Đã hủy' : 'Không tạo được báo cáo',
        error: cancelled ? null : error instanceof Error ? error.message : String(error)
      });
    }
  }
}
