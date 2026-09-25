import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { Logger } from '../logging/logger.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { processEnvironmentFor } from '../processes/process-manager.js';
import type {
  VideoLinkFilterLink,
  VideoLinkFilterMove,
  VideoLinkFilterRequest,
  VideoLinkFilterResult
} from '@shared/video-link-filter.js';
import {
  combineVideoFilterLinks,
  extractVideoFilterUrls,
  matchVideoByLinks,
  VIDEO_LINK_FILTER_EXTENSIONS,
  type VideoCandidate
} from '@shared/utils/video-link-filter.js';
import { InvalidInputError, ProcessingFailedError } from '@shared/errors/app-errors.js';

const YTDLP_SEPARATOR = '|||TUBMEDIA_VIDEO_FILTER|||';
const MAX_YTDLP_OUTPUT_BYTES = 64 * 1024 * 1024;
const YTDLP_TIMEOUT_MS = 20 * 60 * 1000;

function comparablePath(value: string): string {
  return resolve(value).replace(/[\\/]+$/g, '').toLocaleLowerCase('en-US');
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function isInside(parent: string, candidate: string): boolean {
  const normalizedParent = comparablePath(parent);
  const normalizedCandidate = comparablePath(candidate);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(normalizedParent + sep.toLocaleLowerCase('en-US'))
  );
}

function cleanMeta(value: string | undefined): string {
  const text = (value ?? '').trim();
  return /^(NA|None|null|undefined)$/i.test(text) ? '' : text;
}

function fileSystemErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export class VideoLinkFilterService {
  private running = false;

  public constructor(
    private readonly tools: ToolManager,
    private readonly logger: Logger
  ) {}

  public async run(request: VideoLinkFilterRequest): Promise<VideoLinkFilterResult> {
    if (this.running) {
      throw new InvalidInputError('Chức năng Lọc video theo link đang xử lý một tác vụ khác.');
    }
    this.running = true;
    try {
      return await this.execute(request);
    } finally {
      this.running = false;
    }
  }

  private async execute(request: VideoLinkFilterRequest): Promise<VideoLinkFilterResult> {
    const sourceFolder = resolve(request.sourceFolder);
    const destinationFolder = resolve(request.destinationFolder);
    const sourceStat = await stat(sourceFolder).catch(() => null);
    if (!sourceStat?.isDirectory()) {
      throw new InvalidInputError(`Không tìm thấy thư mục video nguồn: ${sourceFolder}`);
    }
    if (samePath(sourceFolder, destinationFolder)) {
      throw new InvalidInputError('Thư mục nguồn và thư mục đích phải khác nhau.');
    }

    const urls = extractVideoFilterUrls(request.linksText);
    if (urls.length === 0) {
      throw new InvalidInputError('Danh sách chưa có URL hợp lệ để đối chiếu.');
    }

    const warnings: string[] = [];
    let resolvedLinks: VideoLinkFilterLink[] = [];
    if (request.useYtDlp) {
      const tool = this.tools.get('yt-dlp');
      if (tool.available && tool.executablePath) {
        try {
          resolvedLinks = await this.resolveByYtDlp(tool.executablePath, urls);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push('yt-dlp không nhận diện được toàn bộ link; Tubmedia đã tự chuyển sang tách ID trực tiếp.');
          this.logger.warn('video-filter', 'VIDEO_FILTER_YTDLP_FALLBACK', message, {
            metadata: { urlCount: urls.length }
          });
        }
      } else {
        warnings.push('yt-dlp chưa sẵn sàng; Tubmedia đang dùng bộ tách ID trực tiếp.');
      }
    }

    const links = combineVideoFilterLinks(urls, resolvedLinks);
    if (links.length === 0) {
      throw new ProcessingFailedError(
        'Không nhận diện được ID video nào từ danh sách link. Hãy kiểm tra link hoặc tình trạng yt-dlp.'
      );
    }

    const videos = await this.scanVideos(sourceFolder, destinationFolder);
    if (videos.length === 0) {
      throw new InvalidInputError(`Không tìm thấy file video trong: ${sourceFolder}`);
    }

    const moves: VideoLinkFilterMove[] = [];
    const matchedIds = new Set<string>();
    let movedVideos = 0;
    let failed = 0;

    for (const video of videos) {
      const match = matchVideoByLinks(video, links, request.titleMatch);
      if (!match) continue;

      matchedIds.add(match.link.id.toLowerCase());
      const relativeTarget = request.flatten ? video.name : video.relativePath;
      const requestedTarget = join(destinationFolder, relativeTarget);
      const destination = await this.uniqueDestination(requestedTarget);

      let status: VideoLinkFilterMove['status'] = request.mode === 'move' ? 'moved' : 'preview';
      let errorText = '';
      if (request.mode === 'move') {
        try {
          await this.moveSafe(video.fullPath, destination);
          movedVideos += 1;
        } catch (error) {
          status = 'failed';
          failed += 1;
          errorText = error instanceof Error ? error.message : String(error);
          this.logger.error('video-filter', 'VIDEO_FILTER_MOVE_FAILED', errorText, {
            metadata: {
              source: video.fullPath,
              destination,
              videoId: match.link.id
            }
          });
        }
      }

      moves.push({
        source: video.fullPath,
        destination,
        relativePath: video.relativePath,
        matchReason: match.reason,
        videoId: match.link.id,
        link: match.link.url,
        platform: match.link.platform,
        title: match.link.title,
        status,
        ...(errorText ? { error: errorText } : {})
      });
    }

    const unmatchedLinks = links.filter((item) => !matchedIds.has(item.id.toLowerCase()));
    const result: VideoLinkFilterResult = {
      createdAt: new Date().toISOString(),
      mode: request.mode,
      sourceFolder,
      destinationFolder,
      inputUrls: urls.length,
      recognizedLinks: links.length,
      scannedVideos: videos.length,
      matchedVideos: moves.length,
      movedVideos,
      failed,
      warnings,
      moves,
      unmatchedLinks
    };

    this.logger.info(
      'video-filter',
      request.mode === 'move' ? 'VIDEO_FILTER_MOVE_COMPLETED' : 'VIDEO_FILTER_PREVIEW_COMPLETED',
      request.mode === 'move'
        ? `Đã hoàn tất lọc video theo link: chuyển ${movedVideos}/${moves.length} video khớp.`
        : `Đã xem trước lọc video theo link: tìm thấy ${moves.length} video khớp.`,
      {
        metadata: {
          inputUrls: result.inputUrls,
          recognizedLinks: result.recognizedLinks,
          scannedVideos: result.scannedVideos,
          matchedVideos: result.matchedVideos,
          movedVideos: result.movedVideos,
          failed: result.failed
        }
      }
    );

    return result;
  }

  private async scanVideos(sourceFolder: string, destinationFolder: string): Promise<VideoCandidate[]> {
    const videos: VideoCandidate[] = [];
    const destinationInsideSource = isInside(sourceFolder, destinationFolder);

    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (destinationInsideSource && isInside(destinationFolder, fullPath)) continue;
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = extname(entry.name).toLowerCase();
        if (!VIDEO_LINK_FILTER_EXTENSIONS.has(extension)) continue;
        videos.push({
          fullPath,
          relativePath: relative(sourceFolder, fullPath),
          name: basename(fullPath),
          stem: basename(fullPath, extension)
        });
      }
    };

    await walk(sourceFolder);
    return videos;
  }

  private async resolveByYtDlp(executablePath: string, urls: string[]): Promise<VideoLinkFilterLink[]> {
    const folder = await mkdtemp(join(tmpdir(), 'TubmediaVideoFilter-'));
    const batchFile = join(folder, 'links.txt');
    await writeFile(batchFile, urls.join('\n'), 'utf8');

    try {
      const template = ['%(id)s', '%(title)s', '%(webpage_url)s', '%(extractor_key)s'].join(YTDLP_SEPARATOR);
      // Danh sách link nằm trong --batch-file nên không có URL nào trên dòng lệnh; --ignore-config
      // chặn tệp cấu hình yt-dlp trên máy chèn thêm tùy chọn (như --exec).
      const args = [
        '--ignore-config',
        '--ignore-errors',
        '--quiet',
        '--no-warnings',
        '--skip-download',
        '--flat-playlist',
        '--batch-file',
        batchFile,
        '--print',
        template
      ];

      const { code, stdout, stderr } = await this.runYtDlp(executablePath, args);
      if (code !== 0 && stdout.trim().length === 0) {
        throw new ProcessingFailedError(stderr.trim() || 'yt-dlp không thể đọc danh sách link.');
      }

      const output: VideoLinkFilterLink[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(YTDLP_SEPARATOR)) continue;
        const [rawId, rawTitle, rawUrl, rawPlatform] = line.split(YTDLP_SEPARATOR);
        const id = cleanMeta(rawId);
        if (!id || id.length < 4 || id.length > 160) continue;
        output.push({
          id,
          title: cleanMeta(rawTitle),
          url: cleanMeta(rawUrl),
          platform: cleanMeta(rawPlatform)
        });
      }
      return output;
    } finally {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runYtDlp(
    executablePath: string,
    args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(executablePath, args, {
        windowsHide: true,
        // yt-dlp.exe (PyInstaller) ghi tiêu đề qua pipe bằng code page của Windows nếu không ép UTF-8,
        // làm hỏng tiếng Việt và khiến chế độ khớp theo tiêu đề không tìm thấy video.
        env: processEnvironmentFor('yt-dlp'),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        callback();
      };

      // StringDecoder giữ lại byte UTF-8 dang dở giữa hai chunk; giải mã từng chunk riêng lẻ sẽ
      // làm hỏng ký tự tiếng Việt nằm đúng ranh giới chunk.
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      const append = (current: string, chunk: Buffer, decoder: StringDecoder): string => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_YTDLP_OUTPUT_BYTES) {
          child.kill();
          settle(() => reject(new ProcessingFailedError('yt-dlp trả về quá nhiều dữ liệu khi nhận diện link.')));
          return current;
        }
        return current + decoder.write(chunk);
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk, stdoutDecoder);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk, stderrDecoder);
      });
      child.on('error', (error) => {
        settle(() => reject(error));
      });
      child.on('close', (code) => {
        settle(() =>
          resolvePromise({
            code: code ?? -1,
            stdout,
            stderr
          })
        );
      });

      timeout = setTimeout(() => {
        child.kill();
        settle(() => reject(new ProcessingFailedError('yt-dlp quá thời gian khi nhận diện danh sách link.')));
      }, YTDLP_TIMEOUT_MS);
    });
  }

  private async uniqueDestination(target: string): Promise<string> {
    if (!(await this.exists(target))) return target;
    const extension = extname(target);
    const stem = target.slice(0, -extension.length);
    for (let index = 1; index <= 9999; index += 1) {
      const candidate = `${stem} (${index})${extension}`;
      if (!(await this.exists(candidate))) return candidate;
    }
    throw new ProcessingFailedError(`Không thể tạo tên file không trùng cho: ${target}`);
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch (error) {
      const code = fileSystemErrorCode(error);
      if (code === 'ENOENT') return false;
      throw error;
    }
  }

  private async moveSafe(source: string, destination: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });

    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = fileSystemErrorCode(error);
      if (!['EXDEV', 'EPERM', 'EACCES'].includes(code)) {
        // A safe copy fallback is still useful for Windows/network filesystems, but log the original reason.
        this.logger.warn('video-filter', 'VIDEO_FILTER_RENAME_FALLBACK', 'Đang chuyển sang sao chép an toàn.', {
          metadata: { source, destination, code }
        });
      }
    }

    const pending = `${destination}.tubmedia-${randomUUID()}.pending`;
    try {
      await copyFile(source, pending);
      const [sourceStat, pendingStat] = await Promise.all([stat(source), stat(pending)]);
      if (sourceStat.size !== pendingStat.size) {
        throw new ProcessingFailedError('File sao chép không đủ kích thước; Tubmedia giữ nguyên file nguồn.');
      }
      await rename(pending, destination);
      await rm(source);
    } catch (error) {
      await rm(pending, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
