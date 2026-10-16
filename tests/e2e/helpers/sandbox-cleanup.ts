import fs from 'node:fs';
import path from 'node:path';

/**
 * Xóa thư mục tạm của một bài kiểm e2e sau khi đã đóng app.
 *
 * Ngay sau khi giết cây tiến trình Electron, Windows có lúc chưa nhả khóa tệp (máy CI chậm, chống virus quét tệp mới):
 * EPERM ở run 37748960748 (phát hành 1.6.1) và run 38865391717 (phát hành 1.7.0). Bản cũ dùng
 * `fs.rmSync(..., { maxRetries: 10 })` nhưng trên Node 24 bản đồng bộ BỎ QUA maxRetries khi gặp EPERM (đo 2026-10-16:
 * báo lỗi sau 1 ms; `fs.promises.rm` thì thử lại đúng) — khóa chỉ vài mili giây cũng đánh rớt bài, và vì bộ e2e chạy nối
 * tiếp nên mọi bài phía sau "did not run" → chặn phát hành. Giờ tự thử lại tới hết hạn chờ; quá hạn thì trả chẩn đoán
 * thay vì ném lỗi: thư mục tạm sót lại không phải lỗi của tính năng đang kiểm.
 */
export interface SandboxCleanupResult {
  removed: boolean;
  waitedMs: number;
  attempts: number;
  error?: string;
  /** Vài đường dẫn còn sót (khi không xóa được) — để biết tệp nào đang bị giữ. */
  remaining?: string[];
}

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EMFILE', 'ENFILE', 'EACCES']);
export const SANDBOX_CLEANUP_BUDGET_MS = 60_000;
const RETRY_DELAY_MS = 250;
const REMAINING_LIMIT = 20;

function listRemaining(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= REMAINING_LIMIT) return;
      const full = path.join(current, entry.name);
      found.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(directory);
  return found;
}

export async function removeSandbox(
  directory: string,
  options: { budgetMs?: number } = {}
): Promise<SandboxCleanupResult> {
  const budgetMs = options.budgetMs ?? SANDBOX_CLEANUP_BUDGET_MS;
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await fs.promises.rm(directory, { recursive: true, force: true });
      return { removed: true, waitedMs: Date.now() - started, attempts };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      const message = `${code} ${(error as Error).message}`.trim();
      if (!RETRYABLE_CODES.has(code) || Date.now() - started + RETRY_DELAY_MS > budgetMs) {
        return { removed: false, waitedMs: Date.now() - started, attempts, error: message, remaining: listRemaining(directory) };
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
