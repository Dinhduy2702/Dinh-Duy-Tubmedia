import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * Thư mục tạm riêng cho từng tiến trình yt-dlp (2026-10-15).
 *
 * yt-dlp.exe bản Windows là PyInstaller một tệp: tiến trình mồi giải nén ~20 MB vào %TEMP%\_MEIxxxx và chỉ tự dọn khi thoát
 * bình thường. Tubmedia dừng yt-dlp bằng `taskkill /T /F` (tạm dừng, hủy, quá giờ, đóng app) nên mỗi lần dừng ngang để sót
 * một thư mục — máy dev từng có 980 thư mục = 21,4 GB, ổ C đầy làm hồ sơ tải báo DISK_FULL. Cho mỗi tiến trình yt-dlp một
 * thư mục tạm riêng (TMP/TEMP) và xóa đúng thư mục đó khi tiến trình kết thúc — không bao giờ đụng thư mục của một yt-dlp
 * khác đang chạy (xóa dở một _MEI đang dùng làm hỏng tiến trình đó).
 */
export const YTDLP_RUNTIME_TEMP_FOLDER = 'tubmedia-ytdlp-runtime';
/**
 * Thư mục mới cấp chưa đủ tuổi này thì không dọn: từ lúc tạo thư mục, qua lúc yt-dlp GIẢI NÉN vào _MEI (vài trăm ms tới vài
 * giây trên máy chậm), tới khi nó nạp xong DLL, thư mục chưa bị khóa — đổi tên sẽ thành công nhầm và xóa mất tệp của một
 * yt-dlp đang khởi động (đo 2026-10-16: dọn ngay khi _MEI vừa xuất hiện thì đổi tên được ~1/3 lượt).
 */
export const YTDLP_RUNTIME_MIN_AGE_MS = 60_000;
/** Dọn thêm sau mỗi lần một yt-dlp kết thúc, tối đa một lần mỗi khoảng này. */
const SWEEP_INTERVAL_MS = 60_000;

export function isYtDlpExecutable(executablePath: string): boolean {
  return /^yt-dlp(?:\.exe)?(?:$|\.)/i.test(basename(executablePath.replace(/\\/g, '/')));
}

export interface YtDlpRuntimeAllocation {
  dir: string;
  env: { TMP: string; TEMP: string };
  release(): Promise<void>;
}

export class YtDlpRuntimeTemp {
  public constructor(private readonly root: string = join(tmpdir(), YTDLP_RUNTIME_TEMP_FOLDER)) {}

  public async allocate(): Promise<YtDlpRuntimeAllocation> {
    const dir = join(this.root, randomUUID().replaceAll('-', '').slice(0, 16));
    await mkdir(dir, { recursive: true });
    let released: Promise<void> | null = null;
    return {
      dir,
      env: { TMP: dir, TEMP: dir },
      // Tệp có thể còn bị khóa vài trăm ms sau khi cây tiến trình đóng (ffmpeg con, chống virus) → thử lại.
      release: () =>
        (released ??= rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
          .catch(() => undefined)
          .then(() => this.sweepUnusedSoon()))
    };
  }

  /**
   * Xóa mọi thư mục tạm KHÔNG còn tiến trình nào dùng (sót lại khi app bị tắt giữa lúc tải, hoặc phiên trước bị tắt đột
   * ngột). Cách nhận biết: đổi tên thư mục — trên Windows thư mục có DLL đang được nạp (yt-dlp còn chạy) đổi tên báo EPERM
   * (đo thật 2026-10-15), nên chỉ thư mục đã bỏ mới bị xóa. Trả số thư mục đã xóa.
   */
  public async sweepUnused(minAgeMs = YTDLP_RUNTIME_MIN_AGE_MS, now = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      const dir = join(this.root, name);
      try {
        const info = await stat(dir);
        if (!info.isDirectory()) continue;
        if (name.includes('.removing-')) {
          await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
          continue;
        }
        if (now - info.mtimeMs < minAgeMs) continue;
        const doomed = dir + '.removing-' + randomUUID().slice(0, 8);
        await rename(dir, doomed);
        await rm(doomed, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        removed += 1;
      } catch {
        // Đang bị khóa (yt-dlp còn chạy) → để lần sau.
      }
    }
    return removed;
  }

  /** Gọi sau khi một yt-dlp kết thúc: dọn thêm thư mục bị bỏ, nhưng không quá một lần mỗi phút. */
  public sweepUnusedSoon(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    void this.sweepUnused().catch(() => undefined);
  }

  private lastSweepAt = 0;
}

export const defaultYtDlpRuntimeTemp = new YtDlpRuntimeTemp();
