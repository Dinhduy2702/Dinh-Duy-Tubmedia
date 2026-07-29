import { copyFile, link, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { PROGRESS_MARKER } from '@shared/constants/app.js';
import {
  AuthenticationRequiredError,
  BrowserCookieLockedError,
  CookiesExpiredError,
  RetryWithConfiguredCookiesError,
  DiskFullError,
  DownloadFailedError,
  ToolNotFoundError
} from '@shared/errors/app-errors.js';
import type { AppSettings, QueueJob, ResourceProfile, VerificationLevel } from '@shared/types/domain.js';
import {
  downloadPolicyForWorkflow,
  formatSelectorForWorkflow,
  formatSortForWorkflow,
  isCapCutDownloadMode,
  mergeOutputFormat,
  planCapCutCompatibility,
  settingsForDownloadWorkflow,
  type DownloadWorkflow,
  validateDownloadedQuality,
  validateSelectedDownloadSize
} from '@shared/utils/download-quality.js';
import { FfmpegProgressTracker } from '@shared/utils/ffmpeg-progress.js';
import { classifyFailure } from '@shared/utils/retry.js';
import { hasConfiguredCookies, shouldAttachConfiguredCookies } from '@shared/utils/cookie-policy.js';
import { cleanExternalText } from '@shared/utils/text-encoding.js';
import { downloadLinkTag } from '@shared/utils/url.js';
import type { MediaSourceRepository } from '../database/repositories/media-source-repository.js';
import type { ProjectRepository } from '../database/repositories/project-repository.js';
import type { Logger } from '../logging/logger.js';
import { ensureDirectory } from '../files/ensure-directory.js';
import { commitFileWithoutOverwrite, nonConflictingPath } from '../files/non-conflicting-path.js';
import { ensureTubmediaOwnedDirectory, isReservedTubmediaDirectory } from '../files/file-ownership.js';
import type { FileVerifier } from '../media/file-verifier.js';
import type { MediaAnalyzer } from '../media/media-analyzer.js';
import type { QuarantineService } from '../media/quarantine-service.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { parseYtDlpProgress, YTDLP_PROGRESS_FLAGS, YTDLP_UTF8_FLAGS } from './ytdlp-progress.js';

export interface DownloadProgress {
  percent: number;
  speed: string | null;
  etaSeconds: number | null;
  stage?: 'analyzing' | 'downloading' | 'processing' | 'verifying';
  stageLabel?: string;
  elapsedSeconds?: number;
  displayName?: string;
}

export interface DownloadResult {
  outputPath: string;
  skipped: boolean;
  resultMessage: string;
}

export function isFinalDownloadForMediaId(fileName: string, mediaId: string): boolean {
  if (!/^[A-Za-z0-9_.-]{3,200}$/.test(mediaId)) return false;
  const escaped = mediaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[${escaped}\\]\\.(?:mp4|mkv|webm|mov|m4v)$`, 'i').test(fileName);
}

export function isFinalDownloadForLinkTag(fileName: string, linkTag: string): boolean {
  if (!/^LINK_[A-F0-9]{12}$/.test(linkTag)) return false;
  const escaped = linkTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[${escaped}\\]\\.(?:mp4|mkv|webm|mov|m4v)$`, 'i').test(fileName);
}

export class DownloadEngine {
  private readonly cookieRequiredJobs = new Set<string>();

  public constructor(
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager,
    private readonly sources: MediaSourceRepository,
    private readonly projects: ProjectRepository,
    private readonly settings: SettingsService,
    private readonly analyzer: MediaAnalyzer,
    private readonly verifier: FileVerifier,
    private readonly quarantine: QuarantineService,
    private readonly logger: Logger
  ) {}

  private async verifyFinal(
    job: QueueJob,
    path: string,
    level: VerificationLevel,
    signal: AbortSignal,
    onProgress: (progress: DownloadProgress) => void,
    quarantineOnFailure = true,
    expectedDuration?: number
  ): Promise<void> {
    onProgress({
      percent: 0,
      speed: null,
      etaSeconds: null,
      stage: 'verifying'
    });
    this.logger.info(
      'download',
      'FINAL_VERIFICATION_STARTED',
      level === 'deep'
        ? 'Đang giải mã và kiểm tra toàn bộ video từ đầu đến cuối.'
        : `Đang kiểm tra tệp ở mức ${level}.`,
      {
        jobId: job.id,
        ...(job.projectId ? { projectId: job.projectId } : {}),
        metadata: { path, level }
      }
    );

    const checked = await this.verifier.verify(path, level, expectedDuration, {
      jobId: job.id,
      projectId: job.projectId,
      signal,
      onProgress: (percent) => {
        onProgress({
          percent,
          speed: null,
          etaSeconds: null,
          stage: 'verifying'
        });
      }
    });
    if (!checked.ok) {
      const project = job.projectId ? this.projects.get(job.projectId) : null;
      if (project && quarantineOnFailure) {
        const quarantined = await this.quarantine.move(
          path,
          project.quarantineFolder,
          checked.reasons.join('; '),
          job.id
        );
        throw new DownloadFailedError(
          `Tệp tải xong không hợp lệ và đã chuyển vào khu cách ly: ${quarantined}. ${checked.reasons.join(' ')}`
        );
      }
      throw new DownloadFailedError(`Tệp tải xong không hợp lệ: ${checked.reasons.join('; ')}`);
    }

    this.logger.info(
      'download',
      'FINAL_VERIFICATION_COMPLETED',
      `Kiểm tra ${level} hoàn tất; tệp có thể đọc xuyên suốt.`,
      {
        jobId: job.id,
        ...(job.projectId ? { projectId: job.projectId } : {}),
        metadata: { path, level, duration: checked.duration }
      }
    );
  }

  private async remuxToPreferredContainer(
    job: QueueJob,
    input: string,
    appSettings: AppSettings,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<string> {
    if (appSettings.downloadContainerPreference === 'mkv') return input;
    if (extname(input).toLowerCase() === '.mp4') return input;

    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) {
      if (appSettings.downloadContainerPreference === 'mp4') {
        throw new ToolNotFoundError('ffmpeg');
      }
      return input;
    }

    onProgress({
      percent: 0,
      speed: null,
      etaSeconds: null,
      stage: 'processing'
    });
    const desiredOutput = input.slice(0, -extname(input).length) + '.mp4';
    const output = await nonConflictingPath(desiredOutput);
    const pending = output.replace(/\.mp4$/i, `.tubmedia-${job.id}.pending.mp4`);
    const result = await this.processes.run({
      jobId: job.id,
      projectId: job.projectId,
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath,
      args: [
        '-hide_banner',
        '-y',
        '-i',
        input,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        pending
      ],
      priority: resource.processPriority,
      signal,
      timeoutMs: 6 * 60 * 60 * 1000
    });
    if (result.code !== 0) {
      await rm(pending, { force: true });
      if (appSettings.downloadContainerPreference === 'mp4') {
        throw new DownloadFailedError(
          `Không thể đóng gói lại tệp sang MP4: ${result.stderrTail || 'FFmpeg thất bại.'}`
        );
      }
      this.logger.warn(
        'download',
        'REMUX_SKIPPED',
        'Codec nguồn không tương thích MP4; giữ container gốc để tránh encode lại và giảm chất lượng.',
        {
          jobId: job.id,
          ...(job.projectId ? { projectId: job.projectId } : {}),
          metadata: { input }
        }
      );
      return input;
    }

    const checked = await this.verifier.verify(pending, 'fast', undefined, {
      jobId: job.id,
      projectId: job.projectId,
      signal
    });
    if (!checked.ok) {
      await rm(pending, { force: true });
      if (appSettings.downloadContainerPreference === 'mp4') {
        throw new DownloadFailedError(
          `Tệp MP4 sau khi đóng gói lại không hợp lệ: ${checked.reasons.join('; ')}`
        );
      }
      return input;
    }

    const committedOutput = await commitFileWithoutOverwrite(pending, output);
    await rm(input, { force: true });
    return committedOutput;
  }

  private async makeCapCutCompatible(
    job: QueueJob,
    input: string,
    appSettings: AppSettings,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (progress: DownloadProgress) => void,
    forceFaststart: boolean
  ): Promise<string> {
    const info = await this.analyzer.analyze(input, job.id);
    const plan = planCapCutCompatibility(appSettings, info);
    if (!plan.active || !plan.maxHeight) return input;
    if (info.height < 1080) {
      throw new DownloadFailedError(
        `Nguồn chỉ đạt ${info.height}p. Chế độ CapCut trực tiếp yêu cầu tối thiểu 1080p và không phóng lớn ảo.`
      );
    }

    const needsProcessing =
      forceFaststart || plan.needsVideoTranscode || plan.needsAudioTranscode || plan.needsContainerRemux;
    if (!needsProcessing) return input;

    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) {
      throw new ToolNotFoundError('ffmpeg');
    }
    const capabilities = ffmpeg.capabilities;
    if (plan.needsVideoTranscode && !capabilities.includes('libx264')) {
      throw new DownloadFailedError(
        'FFmpeg hiện tại thiếu libx264 nên chưa thể tạo video H.264 tương thích CapCut.'
      );
    }
    if (plan.needsAudioTranscode && !capabilities.includes('aac')) {
      throw new DownloadFailedError(
        'FFmpeg hiện tại thiếu bộ mã hóa AAC nên chưa thể chuẩn hóa âm thanh cho CapCut.'
      );
    }
    if (plan.requiresHdrToneMap && (!capabilities.includes('zscale') || !capabilities.includes('tonemap'))) {
      throw new DownloadFailedError(
        'Video là HDR/10-bit nhưng FFmpeg thiếu zscale hoặc tonemap. Ứng dụng không tự đổi màu sai; hãy vào Trung tâm công cụ và chọn Sửa chữa tất cả.'
      );
    }
    if (plan.requiresColorConversion && !capabilities.includes('zscale')) {
      throw new DownloadFailedError('Video cần chuyển không gian màu sang BT.709 nhưng FFmpeg thiếu zscale.');
    }

    const extension = extname(input);
    const desiredOutput = input.slice(0, -extension.length) + '.mp4';
    const replacesInput = resolve(desiredOutput) === resolve(input);
    const output = replacesInput ? desiredOutput : await nonConflictingPath(desiredOutput);
    const pending = output.replace(/\.mp4$/i, `.tubmedia-${job.id}.capcut.pending.mp4`);
    const backup = output.replace(/\.mp4$/i, `.capcut-source-${Date.now()}.bak`);
    await rm(pending, { force: true });

    const filters: string[] = [];
    if (plan.requiresHdrToneMap) {
      filters.push(
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'tonemap=hable:desat=0',
        'zscale=p=bt709:t=bt709:m=bt709:r=tv'
      );
    } else if (plan.requiresColorConversion) {
      filters.push('zscale=p=bt709:t=bt709:m=bt709:r=tv');
    }
    if (info.height > plan.maxHeight + 2) {
      const maxWidth = plan.maxHeight === 1440 ? 2560 : 1920;
      filters.push(
        `scale=w='min(iw,${maxWidth})':h='min(ih,${plan.maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2`
      );
    }
    if (info.fps > 60.5) filters.push('fps=60');
    if (plan.needsVideoTranscode) filters.push('setsar=1', 'format=yuv420p');

    const args = ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?'];
    if (plan.needsVideoTranscode) {
      if (filters.length) args.push('-vf', filters.join(','));
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-tag:v',
        'avc1',
        '-threads',
        String(resource.ffmpegThreads),
        '-filter_threads',
        String(resource.filterThreads),
        '-filter_complex_threads',
        String(resource.filterComplexThreads)
      );
    } else {
      args.push('-c:v', 'copy');
    }
    if (!info.audioCodec) {
      args.push('-an');
    } else if (plan.needsAudioTranscode) {
      args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000');
      if ((info.channels ?? 2) > 2) args.push('-ac', '2');
    } else {
      args.push('-c:a', 'copy');
    }
    args.push(
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-color_range',
      'tv',
      '-movflags',
      '+faststart',
      '-max_muxing_queue_size',
      '2048',
      '-progress',
      'pipe:1',
      '-nostats',
      pending
    );

    const stageLabel = plan.needsVideoTranscode
      ? plan.requiresHdrToneMap
        ? 'Đang chuyển HDR/10-bit sang SDR BT.709 cho CapCut'
        : 'Đang chuẩn hóa H.264 8-bit để dựng trực tiếp trong CapCut'
      : plan.needsAudioTranscode
        ? 'Đang chuẩn hóa âm thanh AAC 48 kHz cho CapCut'
        : 'Đang đóng gói MP4 faststart cho CapCut';
    onProgress({
      percent: 0,
      speed: null,
      etaSeconds: null,
      stage: 'processing',
      stageLabel,
      elapsedSeconds: 0
    });
    this.logger.info('download', 'CAPCUT_COMPATIBILITY_STARTED', `${stageLabel}. Không tạo tệp Proxy.`, {
      jobId: job.id,
      ...(job.projectId ? { projectId: job.projectId } : {}),
      metadata: {
        input,
        mode: plan.mode,
        reasons: plan.reasons,
        videoTranscode: plan.needsVideoTranscode,
        audioTranscode: plan.needsAudioTranscode
      }
    });

    const tracker = new FfmpegProgressTracker(info.duration);
    const result = await this.processes.run({
      jobId: job.id,
      projectId: job.projectId,
      tool: 'ffmpeg',
      executablePath: ffmpeg.executablePath,
      args,
      priority: resource.processPriority,
      signal,
      timeoutMs: 48 * 60 * 60 * 1000,
      onStdoutLine: (line) => {
        const snapshot = tracker.update(line);
        if (!snapshot) return;
        onProgress({
          percent: snapshot.percent,
          speed: snapshot.speed,
          etaSeconds: snapshot.etaSeconds,
          stage: 'processing',
          stageLabel,
          elapsedSeconds: snapshot.elapsedSeconds
        });
      }
    });
    if (result.code !== 0) {
      await rm(pending, { force: true });
      throw new DownloadFailedError(
        `Không thể chuẩn hóa video cho CapCut: ${result.stderrTail || 'FFmpeg thất bại.'}`
      );
    }

    const checked = await this.verifier.verify(pending, 'fast', undefined, {
      jobId: job.id,
      projectId: job.projectId,
      signal
    });
    if (!checked.ok) {
      await rm(pending, { force: true });
      throw new DownloadFailedError(`Tệp CapCut sau xử lý không hợp lệ: ${checked.reasons.join('; ')}`);
    }

    if (replacesInput) {
      await rename(input, backup);
    }
    let committedOutput = output;
    try {
      if (replacesInput) await rename(pending, output);
      else committedOutput = await commitFileWithoutOverwrite(pending, output);
    } catch (error) {
      if (replacesInput) {
        await rename(backup, input).catch(() => undefined);
      }
      throw error;
    }
    if (replacesInput) {
      await rm(backup, { force: true });
    } else {
      await rm(input, { force: true });
    }

    this.logger.info(
      'download',
      'CAPCUT_COMPATIBILITY_COMPLETED',
      `Đã tạo MP4 H.264 SDR BT.709 dùng trực tiếp trong CapCut, không cần Proxy: ${basename(committedOutput)}.`,
      {
        jobId: job.id,
        ...(job.projectId ? { projectId: job.projectId } : {}),
        metadata: { output: committedOutput, mode: plan.mode }
      }
    );
    return committedOutput;
  }

  private async prepareDownloadedFile(
    job: QueueJob,
    input: string,
    appSettings: AppSettings,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (progress: DownloadProgress) => void,
    forceFaststart = false
  ): Promise<string> {
    if (isCapCutDownloadMode(appSettings.downloadCompatibilityMode)) {
      return this.makeCapCutCompatible(job, input, appSettings, resource, signal, onProgress, forceFaststart);
    }
    return this.remuxToPreferredContainer(job, input, appSettings, resource, signal, onProgress);
  }

  private async materializeForProject(sourcePath: string, projectFolder: string): Promise<string> {
    if (resolve(dirname(sourcePath)) === resolve(projectFolder)) return sourcePath;

    await ensureDirectory(projectFolder);
    const materialized = join(projectFolder, basename(sourcePath));
    const existing = await this.verifier.verify(materialized, 'fast').catch(() => ({ ok: false }));
    if (!existing.ok) {
      await rm(materialized, { force: true });
      try {
        await link(sourcePath, materialized);
      } catch {
        await copyFile(sourcePath, materialized);
      }
      const copiedCheck = await this.verifier.verify(materialized, 'fast');
      if (!copiedCheck.ok) {
        await rm(materialized, { force: true });
        throw new DownloadFailedError(
          `Không thể tạo bản video hợp lệ trong thư mục danh sách: ${copiedCheck.reasons.join('; ')}`
        );
      }
    }
    return materialized;
  }

  private async findExistingByLinkTag(
    folder: string,
    linkTag: string,
    job: QueueJob,
    workflow: DownloadWorkflow
  ): Promise<string | null> {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = entries
      .filter((entry) => {
        if (!entry.isFile() || !isFinalDownloadForLinkTag(entry.name, linkTag)) return false;
        const isMergeSource = entry.name.includes('[Nguon-chat-luong-cao]');
        return workflow === 'download-merge' ? isMergeSource : !isMergeSource;
      })
      .map((entry) => join(folder, entry.name))
      .sort((left, right) => {
        const score = (path: string): number =>
          path.toLowerCase().endsWith('.mp4') ? 3 : path.toLowerCase().endsWith('.mkv') ? 2 : 1;
        return score(right) - score(left);
      });

    for (const candidate of candidates) {
      const checked = await this.verifier.verify(candidate, 'fast', undefined, {
        jobId: job.id,
        projectId: job.projectId
      });
      if (checked.ok) return candidate;
      const project = job.projectId ? this.projects.get(job.projectId) : null;
      if (project) {
        await this.quarantine
          .move(
            candidate,
            project.quarantineFolder,
            `Tệp có sẵn theo link ${linkTag} chưa tải đủ hoặc bị hỏng: ${checked.reasons.join('; ')}`,
            job.id
          )
          .catch(() => undefined);
      }
    }
    return null;
  }

  private async findExistingByMediaId(
    folder: string,
    mediaId: string,
    job: QueueJob,
    workflow: DownloadWorkflow
  ): Promise<string | null> {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = entries
      .filter((entry) => {
        if (!entry.isFile() || !isFinalDownloadForMediaId(entry.name, mediaId)) return false;
        const isMergeSource = entry.name.includes('[Nguon-chat-luong-cao]');
        return workflow === 'download-merge' ? isMergeSource : !isMergeSource;
      })
      .map((entry) => join(folder, entry.name))
      .sort((left, right) => {
        const score = (path: string): number =>
          path.toLowerCase().endsWith('.mp4') ? 3 : path.toLowerCase().endsWith('.mkv') ? 2 : 1;
        return score(right) - score(left);
      });

    for (const candidate of candidates) {
      const checked = await this.verifier.verify(candidate, 'fast', undefined, {
        jobId: job.id,
        projectId: job.projectId
      });
      if (checked.ok) return candidate;
      const project = job.projectId ? this.projects.get(job.projectId) : null;
      if (project) {
        await this.quarantine
          .move(
            candidate,
            project.quarantineFolder,
            `Tệp có sẵn theo ID ${mediaId} chưa tải đủ hoặc bị hỏng: ${checked.reasons.join('; ')}`,
            job.id
          )
          .catch(() => undefined);
      }
    }
    return null;
  }

  public async run(
    job: QueueJob,
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    if (!job.sourceId || !job.projectId) {
      throw new DownloadFailedError('Tác vụ tải thiếu dữ liệu nguồn hoặc dự án.');
    }
    let source = this.sources.get(job.sourceId);
    const project = this.projects.get(job.projectId);
    if (!source || !project) {
      throw new DownloadFailedError('Không tìm thấy nguồn video hoặc dự án.');
    }

    const storedSettings = this.settings.get();
    const workflow: DownloadWorkflow =
      job.input.workflow === 'download-merge' ? 'download-merge' : 'download-only';
    const linkTag = downloadLinkTag(source.normalizedUrl || source.originalUrl);
    const appSettings = settingsForDownloadWorkflow(storedSettings, workflow);
    const downloadPolicy = downloadPolicyForWorkflow(appSettings, workflow, source.platform);
    let outdatedSourceBackup: string | null = null;
    const verificationLevel: VerificationLevel = appSettings.downloadVerifyEntireFile
      ? 'deep'
      : appSettings.verificationLevel;

    if (!source.sourceFile) {
      const discoveredByLink = await this.findExistingByLinkTag(project.sourceFolder, linkTag, job, workflow);
      const discovered =
        discoveredByLink ??
        (await this.findExistingByMediaId(project.sourceFolder, source.mediaId, job, workflow));
      if (discovered) {
        const discoveredInfo = await this.analyzer.analyze(discovered, job.id);
        this.sources.setFile(source.id, discovered, discoveredInfo);
        source = this.sources.get(source.id) ?? source;
        this.logger.info(
          'download',
          'EXISTING_DOWNLOAD_DISCOVERED',
          `Đã nhận diện tệp có sẵn theo ${discoveredByLink ? `link ${linkTag}` : 'ID nguồn'} và sẽ kiểm tra để bỏ qua tải lại: ${basename(discovered)}.`,
          {
            jobId: job.id,
            projectId: project.id,
            metadata: {
              path: discovered,
              mediaId: source.mediaId,
              linkTag,
              matchedBy: discoveredByLink ? 'link' : 'media-id'
            }
          }
        );
      }
    }

    const cachePolicyMatches = source.downloadPolicy === downloadPolicy;
    if (source.sourceFile && !cachePolicyMatches) {
      const cachedPath = source.sourceFile;
      const cachedFileExists = await stat(cachedPath)
        .then((entry) => entry.isFile())
        .catch(() => false);

      if (!cachedFileExists) {
        this.logger.info(
          'download',
          'SOURCE_CACHE_MISSING',
          'Tệp cache của chính sách cũ không còn trên ổ đĩa. Tubmedia đã xóa tham chiếu cũ và sẽ tải lại theo chính sách hiện tại.',
          {
            jobId: job.id,
            projectId: project.id,
            metadata: {
              path: cachedPath,
              previousPolicy: source.downloadPolicy,
              requiredPolicy: downloadPolicy,
              recovery: 'clear-cache-and-redownload'
            }
          }
        );
        this.sources.clearFileCache(source.id);
      } else {
        this.logger.info(
          'download',
          'SOURCE_CACHE_POLICY_UPGRADE',
          workflow === 'download-merge'
            ? 'Video nguồn cũ chưa được xác nhận theo chính sách đa nền tảng mới. Tubmedia sẽ giữ tạm bản cũ và tải lại nguồn sạch.'
            : 'Tệp tải cũ không khớp chính sách chọn định dạng hiện tại. Tubmedia sẽ giữ tạm bản cũ và tải lại để tránh dùng nhầm bản chất lượng thấp.',
          {
            jobId: job.id,
            projectId: project.id,
            metadata: {
              path: cachedPath,
              previousPolicy: source.downloadPolicy,
              requiredPolicy: downloadPolicy
            }
          }
        );
        const existingCheck = await this.verifier.verify(cachedPath, 'fast').catch(() => ({ ok: false }));
        if (existingCheck.ok) {
          outdatedSourceBackup = await this.quarantine
            .move(
              cachedPath,
              project.quarantineFolder,
              workflow === 'download-merge'
                ? 'Nguồn từ bản cũ chưa có chính sách đa nền tảng mới; giữ tạm để tải lại nguồn đầy đủ.'
                : 'Tệp cũ không khớp chính sách chất lượng hiện tại; giữ tạm đến khi bản mới được tải và kiểm tra xong.',
              job.id
            )
            .catch(() => null);
        }
        this.sources.clearFileCache(source.id);
      }
      source = this.sources.get(source.id) ?? source;
    }

    if (source.sourceFile && cachePolicyMatches) {
      const cachedPath = source.sourceFile;
      try {
        await this.verifyFinal(job, cachedPath, verificationLevel, signal, onProgress, false);
        const cachedInfo = await this.analyzer.analyze(cachedPath, job.id);
        const cachedQuality = validateDownloadedQuality(appSettings, cachedInfo, {
          enforceCompatibility: false,
          allowCapCutPreparation: true
        });
        if (cachedQuality.ok) {
          for (const warning of cachedQuality.warnings) {
            const acceptedMinimumFallback =
              appSettings.downloadAllowBelowMinimum && warning.startsWith('Nguồn không đạt mức tối thiểu:');
            const metadata = {
              path: cachedPath,
              width: cachedInfo.width,
              height: cachedInfo.height,
              requestedMinHeight: appSettings.downloadMinHeight,
              fallbackAccepted: acceptedMinimumFallback
            };
            if (acceptedMinimumFallback) {
              this.logger.info(
                'download',
                'SOURCE_CACHE_QUALITY_FALLBACK',
                `Tệp đã tải trước đó đạt ${cachedInfo.height}p, thấp hơn mức mong muốn ${appSettings.downloadMinHeight}p nhưng vẫn được dùng vì danh sách cho phép fallback.`,
                { jobId: job.id, projectId: project.id, metadata }
              );
            } else {
              this.logger.warn('download', 'SOURCE_CACHE_QUALITY_WARNING', warning, {
                jobId: job.id,
                projectId: project.id,
                metadata
              });
            }
          }

          let readyPath = await this.materializeForProject(cachedPath, project.sourceFolder);
          const beforeRemux = readyPath;
          readyPath = await this.prepareDownloadedFile(
            job,
            readyPath,
            appSettings,
            resource,
            signal,
            onProgress
          );
          if (readyPath !== beforeRemux || isCapCutDownloadMode(appSettings.downloadCompatibilityMode)) {
            await this.verifyFinal(job, readyPath, verificationLevel, signal, onProgress);
          }
          const finalInfo = await this.analyzer.analyze(readyPath, job.id);
          const finalQuality = validateDownloadedQuality(appSettings, finalInfo);
          if (!finalQuality.ok) {
            throw new DownloadFailedError(finalQuality.blockingReasons.join('; '));
          }

          if (beforeRemux === cachedPath) {
            this.sources.setFile(source.id, readyPath, finalInfo, 'valid', downloadPolicy);
          }
          this.logger.info(
            'download',
            'SOURCE_CACHE_HIT',
            'Dùng lại nguồn đã kiểm tra toàn vẹn và bảo đảm tệp nằm trong thư mục của danh sách.',
            {
              jobId: job.id,
              projectId: project.id,
              metadata: {
                path: readyPath,
                verificationLevel,
                width: finalInfo.width,
                height: finalInfo.height,
                fps: finalInfo.fps,
                videoCodec: finalInfo.videoCodec,
                audioCodec: finalInfo.audioCodec
              }
            }
          );
          return {
            outputPath: readyPath,
            skipped: true,
            resultMessage: `Đã tải trước đó – đã kiểm tra hợp lệ và bỏ qua tải lại: ${readyPath}`
          };
        }

        this.logger.info(
          'download',
          'SOURCE_CACHE_QUALITY_MISS',
          `Bộ nhớ đệm nguồn không còn phù hợp cấu hình chất lượng hiện tại: ${cachedQuality.blockingReasons.join('; ')}`,
          {
            jobId: job.id,
            projectId: project.id,
            metadata: {
              path: cachedPath,
              recovery: 'preserve-old-file-and-redownload'
            }
          }
        );
        outdatedSourceBackup = await this.quarantine
          .move(
            cachedPath,
            project.quarantineFolder,
            `Tệp cache không còn đạt cấu hình chất lượng hiện tại: ${cachedQuality.blockingReasons.join('; ')}`,
            job.id
          )
          .catch(() => null);
        this.sources.clearFileCache(source.id);
        source = this.sources.get(source.id) ?? source;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (signal.aborted) throw error;
        const cachedFileExists = await stat(cachedPath)
          .then((entry) => entry.isFile())
          .catch(() => false);

        if (!cachedFileExists) {
          this.logger.info(
            'download',
            'SOURCE_CACHE_MISSING',
            'Tệp tải trước đó không còn trên ổ đĩa. Tubmedia đã xóa tham chiếu cache cũ và sẽ tải lại sạch.',
            {
              jobId: job.id,
              projectId: project.id,
              metadata: { path: cachedPath, recovery: 'clear-cache-and-redownload' }
            }
          );
        } else {
          this.logger.warn(
            'download',
            'SOURCE_CACHE_CORRUPT',
            `Tệp cache vẫn tồn tại nhưng không vượt qua kiểm tra; ứng dụng sẽ cách ly tệp và tải lại sạch. ${message}`,
            {
              jobId: job.id,
              projectId: project.id,
              metadata: { path: cachedPath, recovery: 'quarantine-and-redownload' }
            }
          );
          const fastCheck = await this.verifier.verify(cachedPath, 'fast');
          if (!fastCheck.ok) {
            await this.quarantine
              .move(cachedPath, project.quarantineFolder, fastCheck.reasons.join('; '), job.id)
              .catch(() => undefined);
          }
        }
        this.sources.clearFileCache(source.id);
        source = this.sources.get(source.id) ?? source;
      }
      if (source.sourceFile) {
        this.sources.invalidate(source.id);
        source = this.sources.get(source.id) ?? source;
      }
    }

    const ytdlp = this.tools.get('yt-dlp');
    if (!ytdlp.available || !ytdlp.executablePath) {
      throw new ToolNotFoundError('yt-dlp');
    }

    await ensureDirectory(project.sourceFolder);
    await ensureDirectory(project.tempFolder);
    if (isReservedTubmediaDirectory(project.tempFolder)) {
      await ensureTubmediaOwnedDirectory(project.tempFolder, 'download-temp');
    }
    onProgress({
      percent: 0,
      speed: null,
      etaSeconds: null,
      stage: 'analyzing',
      displayName: cleanExternalText(source.title) ?? source.originalUrl
    });
    const outputTemplate = join(
      project.sourceFolder,
      workflow === 'download-merge'
        ? `%(title).145B [Nguon-chat-luong-cao] [%(id)s] [${linkTag}].%(ext)s`
        : `%(title).165B [%(id)s] [${linkTag}].%(ext)s`
    );
    const args = [
      source.originalUrl,
      '--no-playlist',
      ...YTDLP_PROGRESS_FLAGS,
      ...YTDLP_UTF8_FLAGS,
      '--windows-filenames',
      '--trim-filenames',
      '230',
      '--continue',
      '--part',
      '--no-overwrites',
      '--no-keep-fragments',
      '--socket-timeout',
      '120',
      '--retries',
      '60',
      '--fragment-retries',
      '60',
      '--extractor-retries',
      '30',
      '--retry-sleep',
      'http:3',
      '--retry-sleep',
      'fragment:3',
      '--concurrent-fragments',
      String(Math.max(1, Math.min(8, appSettings.downloadConcurrentFragments))),
      '--http-chunk-size',
      '10M',
      '--no-mtime',
      '--merge-output-format',
      mergeOutputFormat(appSettings, workflow),
      '--paths',
      `temp:${project.tempFolder}`,
      '-o',
      outputTemplate,
      '--progress-template',
      `download:${PROGRESS_MARKER}|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s`,
      '--print',
      'before_dl:__VDMSP_TITLE__:%(title)s',
      '--print',
      'before_dl:__VDMSP_UPLOADER__:%(uploader)s',
      '--print',
      'before_dl:__VDMSP_ID__:%(id)s',
      '--print',
      'after_move:__VDMSP_FILE__:%(filepath)s',
      '--print',
      'after_move:__VDMSP_TITLE__:%(title)s',
      '--print',
      'after_move:__VDMSP_UPLOADER__:%(uploader)s',
      '--print',
      'after_move:__VDMSP_ID__:%(id)s',
      '--print',
      'after_move:__VDMSP_FORMAT__:%(format_id)s|%(height)s|%(fps)s|%(tbr)s|%(filesize)s|%(filesize_approx)s|%(vcodec)s|%(acodec)s|%(requested_formats.0.filesize)s|%(requested_formats.0.filesize_approx)s|%(requested_formats.1.filesize)s|%(requested_formats.1.filesize_approx)s|%(duration)s'
    ];
    const requestedFormat = formatSelectorForWorkflow(appSettings, workflow, source.platform);
    if (requestedFormat) {
      args.splice(args.indexOf('--merge-output-format'), 0, '-f', requestedFormat);
    } else if (source.platform === 'google-drive') {
      this.logger.info(
        'download',
        'GOOGLE_DRIVE_NATIVE_DOWNLOAD_MODE',
        'Google Drive: không ép định dạng; yt-dlp tải tệp mặc định/nguyên bản theo đúng cơ chế của liên kết để hỗ trợ cả link chia sẻ và link tải trực tiếp.',
        {
          jobId: job.id,
          projectId: project.id,
          metadata: { url: source.originalUrl, workflow }
        }
      );
    }
    const forcedFormatSort = formatSortForWorkflow(appSettings, workflow, source.platform);
    if (forcedFormatSort) {
      args.push('--format-sort-force', '--format-sort', forcedFormatSort);
    }

    const attachConfiguredCookies = shouldAttachConfiguredCookies(
      job,
      appSettings,
      this.cookieRequiredJobs.has(job.id)
    );
    if (attachConfiguredCookies && appSettings.cookiesFilePath) {
      args.push('--cookies', appSettings.cookiesFilePath);
    } else if (attachConfiguredCookies && appSettings.cookiesBrowser !== 'none') {
      const browserSpec = appSettings.cookiesBrowserProfile
        ? `${appSettings.cookiesBrowser}:${appSettings.cookiesBrowserProfile}`
        : appSettings.cookiesBrowser;
      args.push('--cookies-from-browser', browserSpec);
    }
    if (attachConfiguredCookies) {
      this.logger.info(
        'download',
        'COOKIES_ATTACHED_ON_DEMAND',
        'Video đã yêu cầu xác thực; cookies cấu hình mới được gắn vào lần thử này.',
        {
          jobId: job.id,
          projectId: project.id,
          metadata: {
            mode: appSettings.cookiesFilePath ? 'file' : appSettings.cookiesBrowser
          }
        }
      );
    }
    if (appSettings.proxy) args.push('--proxy', appSettings.proxy);
    if (appSettings.rateLimit) args.push('--limit-rate', appSettings.rateLimit);

    const aria = this.tools.get('aria2c');
    if (source.platform === 'google-drive' && appSettings.useAria2c) {
      this.logger.info(
        'download',
        'GOOGLE_DRIVE_INTERNAL_DOWNLOADER',
        'Google Drive dùng bộ tải nội bộ của yt-dlp như code tham chiếu; tạm bỏ aria2c để tránh lỗi link xác nhận/chữ ký và giữ tốc độ ổn định.',
        {
          jobId: job.id,
          projectId: project.id
        }
      );
    }
    if (
      appSettings.useAria2c &&
      source.platform !== 'google-drive' &&
      job.attempts === 0 &&
      aria.available &&
      aria.executablePath
    ) {
      args.push(
        '--downloader',
        `http,https:${aria.executablePath}`,
        '--downloader-args',
        `aria2c:-x ${appSettings.aria2Connections} -s ${appSettings.aria2Connections} -k 8M --file-allocation=none --summary-interval=0 --console-log-level=warn --retry-wait=3 --max-tries=10 --continue=true --allow-overwrite=true`
      );
    }

    let finalPath = '';
    let title: string | null = null;
    let uploader: string | null = null;
    let resolvedId: string | null = null;
    let selectedFormatId = '';
    let selectedExpectedBytes: number | null = null;
    let selectedExpectedBytesKind: 'exact' | 'approximate' | 'bitrate-estimate' | null = null;
    let selectedDurationSeconds: number | null = null;
    let selectedHeight: number | null = null;
    let selectedFps: number | null = null;
    let selectedBitrateKbps: number | null = null;
    let selectedVideoCodec: string | null = null;
    let selectedAudioCodec: string | null = null;
    let latestProgress: DownloadProgress = {
      percent: 0,
      speed: null,
      etaSeconds: null,
      stage: 'analyzing',
      displayName: cleanExternalText(source.title) ?? source.originalUrl
    };
    const parseLine = (line: string): void => {
      const parsedProgress = parseYtDlpProgress(line);
      if (parsedProgress) {
        latestProgress = {
          ...parsedProgress,
          stage: 'downloading',
          ...(title ? { displayName: title } : {})
        };
        onProgress(latestProgress);
      } else if (line.startsWith('__VDMSP_FILE__:')) {
        finalPath = line.slice('__VDMSP_FILE__:'.length).trim();
      } else if (line.startsWith('__VDMSP_TITLE__:')) {
        title = cleanExternalText(line.slice('__VDMSP_TITLE__:'.length));
        if (title) {
          this.sources.setMetadata(source.id, { title });
          latestProgress = { ...latestProgress, displayName: title };
          onProgress(latestProgress);
        }
      } else if (line.startsWith('__VDMSP_UPLOADER__:')) {
        uploader = cleanExternalText(line.slice('__VDMSP_UPLOADER__:'.length));
        if (uploader) this.sources.setMetadata(source.id, { uploader });
      } else if (line.startsWith('__VDMSP_ID__:')) {
        resolvedId = cleanExternalText(line.slice('__VDMSP_ID__:'.length));
      } else if (line.startsWith('__VDMSP_FORMAT__:')) {
        const [
          formatId = '',
          heightText = '',
          fpsText = '',
          bitrateText = '',
          exactSizeText = '',
          approximateSizeText = '',
          videoCodec = '',
          audioCodec = '',
          firstExactSizeText = '',
          firstApproximateSizeText = '',
          secondExactSizeText = '',
          secondApproximateSizeText = '',
          durationText = ''
        ] = line.slice('__VDMSP_FORMAT__:'.length).split('|');
        const finiteNumber = (value: string): number | null => {
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        };
        selectedFormatId = cleanExternalText(formatId) ?? '';
        selectedHeight = finiteNumber(heightText);
        selectedFps = finiteNumber(fpsText);
        selectedBitrateKbps = finiteNumber(bitrateText);
        const firstExactBytes = finiteNumber(firstExactSizeText);
        const firstApproximateBytes = finiteNumber(firstApproximateSizeText);
        const secondExactBytes = finiteNumber(secondExactSizeText);
        const secondApproximateBytes = finiteNumber(secondApproximateSizeText);
        const componentBytes = [
          firstExactBytes ?? firstApproximateBytes,
          secondExactBytes ?? secondApproximateBytes
        ]
          .filter((value): value is number => value !== null)
          .reduce((sum, value) => sum + value, 0);
        const exactTopLevelBytes = finiteNumber(exactSizeText);
        const approximateTopLevelBytes = finiteNumber(approximateSizeText);
        selectedDurationSeconds = finiteNumber(durationText);
        const bitrateEstimatedBytes =
          selectedBitrateKbps && selectedDurationSeconds
            ? Math.round((selectedBitrateKbps * 1000 * selectedDurationSeconds) / 8)
            : null;

        if (componentBytes > 0) {
          selectedExpectedBytes = componentBytes;
          selectedExpectedBytesKind =
            (firstExactBytes !== null || firstApproximateBytes === null) &&
            (secondExactBytes !== null || secondApproximateBytes === null)
              ? 'exact'
              : 'approximate';
        } else if (exactTopLevelBytes !== null) {
          selectedExpectedBytes = exactTopLevelBytes;
          selectedExpectedBytesKind = 'exact';
        } else if (approximateTopLevelBytes !== null) {
          selectedExpectedBytes = approximateTopLevelBytes;
          selectedExpectedBytesKind = 'approximate';
        } else {
          selectedExpectedBytes = bitrateEstimatedBytes;
          selectedExpectedBytesKind = bitrateEstimatedBytes ? 'bitrate-estimate' : null;
        }
        selectedVideoCodec = cleanExternalText(videoCodec);
        selectedAudioCodec = cleanExternalText(audioCodec);
      }
    };

    const result = await this.processes.run({
      jobId: job.id,
      projectId: project.id,
      tool: 'yt-dlp',
      executablePath: ytdlp.executablePath,
      args,
      priority: resource.processPriority,
      timeoutMs: 48 * 60 * 60 * 1000,
      signal,
      onStdoutLine: parseLine,
      onStderrLine: parseLine
    });
    if (result.code !== 0 || !finalPath) {
      const text = `${result.stderrTail}\n${result.stdoutTail}`;
      const kind = classifyFailure(text);
      const lines = [
        ...new Set(
          text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        )
      ];
      const summary = lines.slice(-5).join(' | ') || `yt-dlp trả về mã thoát ${result.code}`;
      const lower = text.toLowerCase();
      const requestedFormatUnavailable =
        lower.includes('requested format is not available') ||
        lower.includes('requested format is not available, use --list-formats');
      if (isCapCutDownloadMode(appSettings.downloadCompatibilityMode) && requestedFormatUnavailable) {
        throw new DownloadFailedError(
          'Nguồn không có định dạng video từ 1080p đến mức CapCut đã chọn. Ứng dụng không tải 720p và không phóng lớn giả.'
        );
      }
      const browserCookieDatabaseLocked =
        attachConfiguredCookies &&
        (lower.includes('could not copy chrome cookie database') ||
          lower.includes('could not copy edge cookie database') ||
          lower.includes('cookie database is locked') ||
          (lower.includes('could not copy') && lower.includes('cookie database')) ||
          (lower.includes('permission denied') && appSettings.cookiesBrowser !== 'none'));
      if (browserCookieDatabaseLocked) {
        throw new BrowserCookieLockedError(
          appSettings.cookiesBrowser === 'none' ? 'trình duyệt Chromium' : appSettings.cookiesBrowser,
          appSettings.cookiesBrowserProfile
        );
      }
      if (kind === 'authentication') {
        this.cookieRequiredJobs.add(job.id);
        if (!attachConfiguredCookies && hasConfiguredCookies(appSettings)) {
          throw new RetryWithConfiguredCookiesError();
        }
        if (attachConfiguredCookies) {
          throw new CookiesExpiredError();
        }
        throw new AuthenticationRequiredError(
          'Video đang tải vừa yêu cầu đăng nhập hoặc cookies hợp lệ. Chỉ video này được tạm dừng; các video phía sau và các danh sách khác vẫn tiếp tục. ' +
            'Mở khung Cookies của chính danh sách này và chọn một trong ba cách: trình duyệt, dán trực tiếp hoặc chọn tệp cookies. Sau khi lưu, video này sẽ tự tiếp tục.'
        );
      }
      this.logger.error(
        'download',
        'YTDLP_DOWNLOAD_FAILED',
        'yt-dlp không hoàn tất được video. Chi tiết kỹ thuật đã được giữ trong nhật ký chẩn đoán.',
        {
          jobId: job.id,
          projectId: project.id,
          metadata: { exitCode: result.code, failureClass: kind, technicalSummary: summary }
        }
      );
      if (kind === 'disk') {
        throw new DiskFullError(project.sourceFolder);
      }
      if (kind === 'tool') {
        throw new ToolNotFoundError('yt-dlp hoặc công cụ tải phụ trợ');
      }
      if (kind === 'retryable') {
        throw new DownloadFailedError(
          'Kết nối mạng hoặc máy chủ video đang không ổn định. Ứng dụng sẽ tự thử lại theo thời gian chờ; nếu lỗi lặp lại, danh sách sẽ tạm dừng để tránh lặp thông báo.',
          true
        );
      }
      throw new DownloadFailedError(
        'Video không khả dụng, URL không được hỗ trợ hoặc nền tảng đang từ chối truy cập. Mở Nhật ký riêng của danh sách để xem mã chẩn đoán rồi kiểm tra lại liên kết.'
      );
    }

    const initialCheck = await this.verifier.verify(finalPath, 'fast', undefined, {
      jobId: job.id,
      projectId: project.id,
      signal
    });
    if (!initialCheck.ok) {
      const quarantined = await this.quarantine.move(
        finalPath,
        project.quarantineFolder,
        initialCheck.reasons.join('; '),
        job.id
      );
      throw new DownloadFailedError(`Tệp tải xong không hợp lệ và đã chuyển vào khu cách ly: ${quarantined}`);
    }

    finalPath = await this.prepareDownloadedFile(
      job,
      finalPath,
      appSettings,
      resource,
      signal,
      onProgress,
      true
    );
    await this.verifyFinal(
      job,
      finalPath,
      verificationLevel,
      signal,
      onProgress,
      true,
      selectedDurationSeconds ?? undefined
    );

    const info = await this.analyzer.analyze(finalPath, job.id);
    const selectedSize = validateSelectedDownloadSize(
      info.fileSize,
      isCapCutDownloadMode(appSettings.downloadCompatibilityMode) ? null : selectedExpectedBytes
    );
    if (!selectedSize.ok) {
      const quarantined = await this.quarantine.move(
        finalPath,
        project.quarantineFolder,
        selectedSize.message ?? 'Dung lượng tệp thực tế không hợp lệ.',
        job.id
      );
      throw new DownloadFailedError(
        `Tệp tải về không hợp lệ và đã chuyển vào khu cách ly: ${quarantined}. ${selectedSize.message ?? ''}`
      );
    }
    if (selectedSize.suspicious) {
      this.logger.info(
        'download',
        'DOWNLOAD_SIZE_ESTIMATE_MISMATCH',
        `${selectedSize.message ?? 'Dung lượng khác metadata ước tính.'} Tệp đã vượt qua kiểm tra thời lượng và giải mã nên được giữ lại; ứng dụng không cách ly chỉ vì metadata kích thước của nền tảng không chính xác.`,
        {
          jobId: job.id,
          projectId: project.id,
          metadata: {
            path: finalPath,
            expectedBytes: selectedExpectedBytes,
            expectedBytesKind: selectedExpectedBytesKind,
            actualBytes: info.fileSize,
            ratio: selectedSize.ratio,
            verifiedDuration: info.duration,
            expectedDuration: selectedDurationSeconds
          }
        }
      );
    }
    if (selectedFormatId) {
      this.logger.info(
        'download',
        'DOWNLOAD_FORMAT_CONFIRMED',
        `Đã xác nhận format ${selectedFormatId}: ${selectedHeight ?? info.height}p, ${selectedFps ?? info.fps} FPS, ${(info.fileSize / 1024 ** 2).toFixed(1)} MB.`,
        {
          jobId: job.id,
          projectId: project.id,
          metadata: {
            selectedFormatId,
            selectedExpectedBytes,
            selectedExpectedBytesKind,
            selectedDurationSeconds,
            actualBytes: info.fileSize,
            selectedSizeRatio: selectedSize.ratio,
            selectedHeight,
            selectedFps,
            selectedBitrateKbps,
            selectedVideoCodec,
            selectedAudioCodec
          }
        }
      );
    }
    const quality = validateDownloadedQuality(appSettings, info);
    if (!quality.ok) {
      const quarantined = await this.quarantine.move(
        finalPath,
        project.quarantineFolder,
        quality.blockingReasons.join('; '),
        job.id
      );
      throw new DownloadFailedError(
        `Tệp không đạt giới hạn chất lượng và đã chuyển vào khu cách ly: ${quarantined}. ${quality.blockingReasons.join(' ')}`
      );
    }
    for (const warning of quality.warnings) {
      const acceptedMinimumFallback =
        appSettings.downloadAllowBelowMinimum && warning.startsWith('Nguồn không đạt mức tối thiểu:');
      const metadata = {
        path: finalPath,
        width: info.width,
        height: info.height,
        fps: info.fps,
        codec: info.videoCodec,
        audioBitrate: info.audioBitrate,
        selectedFormatId,
        selectedHeight,
        requestedMinHeight: appSettings.downloadMinHeight,
        fallbackAccepted: acceptedMinimumFallback
      };

      if (acceptedMinimumFallback) {
        this.logger.info(
          'download',
          'DOWNLOAD_QUALITY_FALLBACK',
          `Định dạng tốt nhất phù hợp chính sách chỉ đạt ${info.height}p, thấp hơn mức mong muốn ${appSettings.downloadMinHeight}p. Tệp vẫn được giữ vì danh sách cho phép dùng chất lượng thấp hơn khi nguồn không đáp ứng.`,
          { jobId: job.id, projectId: project.id, metadata }
        );
      } else {
        this.logger.warn('download', 'DOWNLOAD_QUALITY_WARNING', warning, {
          jobId: job.id,
          projectId: project.id,
          metadata
        });
      }
    }

    if (outdatedSourceBackup) {
      await rm(outdatedSourceBackup, { force: true }).catch(() => undefined);
      this.logger.info(
        'download',
        'SOURCE_CACHE_REPLACED',
        'Tệp mới đã đạt đúng chính sách chất lượng và dung lượng; bản cũ được dọn để không chiếm thêm dung lượng.',
        {
          jobId: job.id,
          projectId: project.id,
          metadata: { removedBackup: outdatedSourceBackup, replacement: finalPath }
        }
      );
    }

    this.cookieRequiredJobs.delete(job.id);
    this.sources.setFile(source.id, finalPath, info, 'valid', downloadPolicy);
    this.sources.setMetadata(source.id, { title, uploader });
    if (resolvedId) this.sources.promoteIdentity(source.id, resolvedId);
    this.logger.info(
      'download',
      'DOWNLOAD_COMPLETED',
      `Đã tải và kiểm tra ${basename(finalPath)} (${info.width}x${info.height}, ${info.fps.toFixed(2)} FPS, ${info.videoCodec}).`,
      {
        jobId: job.id,
        projectId: project.id,
        metadata: {
          path: finalPath,
          bytes: info.fileSize,
          duration: info.duration,
          width: info.width,
          height: info.height,
          fps: info.fps,
          videoCodec: info.videoCodec,
          videoBitrate: info.videoBitrate,
          audioCodec: info.audioCodec,
          audioBitrate: info.audioBitrate,
          selectedFormatId,
          selectedExpectedBytes,
          selectedExpectedBytesKind,
          selectedDurationSeconds,
          selectedHeight,
          selectedFps,
          selectedBitrateKbps,
          selectedVideoCodec,
          selectedAudioCodec,
          selectedSizeRatio: selectedSize.ratio,
          downloadPolicy,
          linkTag,
          platform: source.platform,
          verificationLevel
        }
      }
    );
    const capCutReady = isCapCutDownloadMode(appSettings.downloadCompatibilityMode);
    const acceptedMinimumFallback =
      appSettings.downloadAllowBelowMinimum &&
      appSettings.downloadMinHeight > 0 &&
      info.height < appSettings.downloadMinHeight;
    return {
      outputPath: finalPath,
      skipped: false,
      resultMessage: capCutReady
        ? `Đã tải và chuẩn hóa để dựng trực tiếp trong CapCut, không cần Proxy: ${finalPath}`
        : workflow === 'download-merge'
          ? `Đã tải nguồn tốt nhất mà ${source.platform || 'nền tảng'} cung cấp để ghép, chưa mã hóa giảm chất lượng: ${finalPath}`
          : acceptedMinimumFallback
            ? `Đã tải thành công ${info.height}p — thấp hơn mức mong muốn ${appSettings.downloadMinHeight}p nhưng là fallback được danh sách cho phép: ${finalPath}`
            : `Đã tải và kiểm tra hoàn tất: ${finalPath}`
    };
  }
}
