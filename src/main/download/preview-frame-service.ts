/**
 * Giai đoạn 3 (2026-09-23) — "Tải theo khoảng có xem trước": lấy MỘT khung hình thật gần một mốc thời
 * gian của video nguồn, dùng cho thẻ "Xem trước" (khung hình đầu/cuối đoạn đã chọn) trước khi người dùng
 * bấm tải thật.
 *
 * Cách làm (đã hỏi và được người dùng chọn — ưu tiên độ tin cậy trên nhiều nền tảng hơn tiết kiệm vài
 * trăm KB): dùng ĐÚNG yt-dlp (đã tự xử lý cookies/header/chữ ký từng nền tảng, y hệt cách tải thật) để
 * tải một ĐOẠN RẤT NGẮN (mặc định 1 giây, không âm thanh, chất lượng thấp nhất có) quanh mốc thời gian
 * vào một thư mục tạm RIÊNG (xem preview-frame-command.ts), rồi dùng ffmpeg trích đúng 1 khung hình từ
 * đoạn đó. Xóa TOÀN BỘ thư mục tạm (cả đoạn video lẫn ảnh vừa trích) ngay sau khi đã đọc ảnh vào bộ nhớ
 * — không để lại tệp nào trên đĩa. Không dùng logic tải chính (QuickDownloadService) vì đây là một tác vụ
 * "bắn một phát rồi xong", không cần theo dõi tiến trình/tạm dừng/khôi phục như tác vụ tải thật.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ToolNotFoundError } from '@shared/errors/app-errors.js';
import type { Logger } from '../logging/logger.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { ToolManager } from '../tools/tool-manager.js';
import { buildFrameExtractArguments, buildPreviewFrameDownloadArguments } from './preview-frame-command.js';

const YTDLP_TIMEOUT_MS = 45_000;
const FFMPEG_TIMEOUT_MS = 20_000;

export interface PreviewFrameRequest {
  url: string;
  timestampSeconds: number;
}

export interface PreviewFrameResult {
  dataUrl: string;
}

export class PreviewFrameService {
  public constructor(
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {}

  public async extractFrame(request: PreviewFrameRequest): Promise<PreviewFrameResult> {
    const ytdlp = this.tools.get('yt-dlp');
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ytdlp.available || !ytdlp.executablePath) throw new ToolNotFoundError('yt-dlp');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const workDirectory = await mkdtemp(join(tmpdir(), 'tubmedia-preview-'));
    try {
      const args = buildPreviewFrameDownloadArguments(
        request.url,
        request.timestampSeconds,
        { ffmpegDirectory: dirname(ffmpeg.executablePath), workDirectory },
        this.settings.get()
      );

      const downloadResult = await this.processes.run({
        jobId: `preview-${randomUUID()}`,
        tool: 'yt-dlp',
        executablePath: ytdlp.executablePath,
        args,
        cwd: workDirectory,
        priority: 'below_normal',
        timeoutMs: YTDLP_TIMEOUT_MS
      });
      if (downloadResult.code !== 0) {
        const detail = downloadResult.stderrTail.trim().split(/\r?\n/).pop() ?? '';
        throw new Error(
          `Không tải được đoạn ngắn để xem trước. Nguồn có thể chặn hoặc mốc thời gian vượt quá thời lượng video.${detail ? ` (${detail})` : ''}`
        );
      }

      const files = await readdir(workDirectory);
      const clipName = files.find((name) => name.startsWith('preview.'));
      if (!clipName) throw new Error('Không tìm thấy đoạn xem trước vừa tải.');
      const clipPath = join(workDirectory, clipName);
      const framePath = join(workDirectory, 'frame.jpg');

      const frameResult = await this.processes.run({
        jobId: `preview-frame-${randomUUID()}`,
        tool: 'ffmpeg',
        executablePath: ffmpeg.executablePath,
        args: buildFrameExtractArguments(clipPath, framePath),
        cwd: workDirectory,
        priority: 'below_normal',
        timeoutMs: FFMPEG_TIMEOUT_MS
      });
      if (frameResult.code !== 0 || !existsSync(framePath)) {
        throw new Error('Không trích được khung hình từ đoạn vừa tải.');
      }

      const buffer = await readFile(framePath);
      return { dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` };
    } catch (error) {
      this.logger.warn(
        'quick-download',
        'PREVIEW_FRAME_FAILED',
        error instanceof Error ? error.message : String(error),
        { metadata: { timestampSeconds: request.timestampSeconds } }
      );
      throw error;
    } finally {
      await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
