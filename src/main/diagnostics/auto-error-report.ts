import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactSecrets } from '@shared/utils/secret-redaction.js';

/**
 * 1.8.0 (yêu cầu người dùng 2026-11-25: "lỗi app, lỗi code mới cần lưu để fix lại"): lỗi do CHÍNH ỨNG DỤNG — ngoại lệ không
 * lường trước ở tiến trình chính, tác vụ sập (UNHANDLED_ERROR), lỗi công cụ tải chưa phân loại được, lỗi xử lý IPC kiểu lập
 * trình (TypeError…), giao diện sập (ErrorBoundary) — được TỰ ĐỘNG lưu thành một tệp JSON trong
 * userData/diagnostics/auto-reports, không mở hộp thoại nào.
 *
 * An toàn cho máy người dùng: tối đa ~50 tệp / ~20 MB (xoá cũ nhất, không bao giờ xoá tệp vừa ghi, không đụng tệp lạ);
 * mỗi tệp tối đa ~256 KB; cùng chữ ký lỗi trong một phiên chỉ lưu MỘT lần (lỗi lặp trong vòng lặp không làm đầy ổ); che
 * bí mật bằng redactSecrets + che mọi đường dẫn tệp cookies; ghi tuần tự; không bao giờ ném lỗi ra ngoài.
 */

export type AppFaultSource =
  | 'queue-executor'
  | 'download-unclassified'
  | 'main-uncaught-exception'
  | 'main-unhandled-rejection'
  | 'ipc'
  | 'renderer';

export interface AppFaultInput {
  source: AppFaultSource;
  error: unknown;
  jobId?: string;
  projectId?: string;
  context?: Record<string, unknown>;
}

export interface AppFaultRecord {
  saved: boolean;
  duplicate: boolean;
  fileName: string | null;
  signature: string;
}

export interface AutoErrorReporterOptions {
  maxFiles?: number;
  maxBytes?: number;
  now?: () => Date;
}

export const AUTO_REPORT_MAX_FILES = 50;
export const AUTO_REPORT_MAX_BYTES = 20 * 1024 * 1024;
const REPORT_BYTE_LIMIT = 256 * 1024;
const STRING_LIMIT = 20_000;
const REPORT_FILE = /^\d{8}-\d{6}-\d{3}-[a-z-]+-[0-9a-f]{8}\.json$/;

interface ErrorShape {
  name: string;
  message: string;
  stack: string;
}

function describeError(error: unknown): ErrorShape {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message, stack: error.stack ?? '' };
  }
  if (typeof error === 'string') return { name: 'string', message: error, stack: '' };
  let message = '';
  try {
    message = JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { name: typeof error, message, stack: '' };
}

/** Chữ ký lỗi: nguồn + loại lỗi + câu lỗi đã bỏ số/đường dẫn/mã định danh + khung ngăn xếp đầu tiên (bỏ dòng:cột). */
export function appFaultSignature(source: AppFaultSource, error: unknown): string {
  const { name, message, stack } = describeError(error);
  const normalized = message
    .replace(/[A-Za-z]:\\[^\s'"]*/g, '<path>')
    .replace(/\/(?:[^\s'"/]+\/)+[^\s'"]*/g, '<path>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '#')
    .slice(0, 400);
  const frame = (stack.split('\n').find((line) => /^\s*at\s/.test(line)) ?? '').replace(/:\d+:\d+\)?\s*$/, '').trim();
  return createHash('sha1').update(`${source}|${name}|${normalized}|${frame}`).digest('hex').slice(0, 16);
}

/** Che mọi đường dẫn tệp có chữ "cookie" trong tên (bản sao tạm, tệp người dùng chọn) — cả dạng \ đã thoát trong JSON. */
function redactCookiePaths(text: string): string {
  return text
    .replace(/[A-Za-z]:(?:\\\\|\\|\/)[^\s"'<>|]*?cookie[^\s"'<>|]*/gi, '[ĐƯỜNG_DẪN_COOKIES]')
    .replace(/(?:\/[^\s"'/]+)+\/[^\s"'/]*cookie[^\s"']*/gi, '[ĐƯỜNG_DẪN_COOKIES]');
}

function capStrings(value: unknown): unknown {
  if (typeof value === 'string') return value.length > STRING_LIMIT ? `${value.slice(0, STRING_LIMIT)}… [đã cắt]` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map(capStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, capStrings(item)]));
  }
  return value;
}

function stamp(at: Date): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return (
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-` +
    `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${pad(at.getMilliseconds(), 3)}`
  );
}

export class AutoErrorReporter {
  private readonly seen = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly maxFiles: number;
  private readonly maxBytes: number;
  private readonly now: () => Date;

  public constructor(
    private readonly folder: string,
    private readonly appInfo: () => { appVersion: string; buildCommit: string },
    options: AutoErrorReporterOptions = {}
  ) {
    this.maxFiles = options.maxFiles ?? AUTO_REPORT_MAX_FILES;
    this.maxBytes = options.maxBytes ?? AUTO_REPORT_MAX_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  public get directory(): string {
    return this.folder;
  }

  /** Lưu báo cáo (tuần tự, không ném lỗi). Cùng chữ ký trong phiên → không ghi thêm, trả tên tệp đã có. */
  public record(input: AppFaultInput): Promise<AppFaultRecord> {
    const next = this.chain.then(() => this.write(input));
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Các báo cáo tự động của một tác vụ — đóng kèm vào gói "Xuất báo cáo lỗi". */
  public async listForJob(jobId: string): Promise<Array<{ name: string; data: string }>> {
    const names = (await readdir(this.folder).catch(() => [] as string[])).filter((name) => REPORT_FILE.test(name)).sort();
    const out: Array<{ name: string; data: string }> = [];
    for (const name of names) {
      const data = await readFile(join(this.folder, name), 'utf8').catch(() => '');
      if (data.includes(`"jobId": ${JSON.stringify(jobId)}`)) out.push({ name, data });
    }
    return out.slice(-10);
  }

  private async write(input: AppFaultInput): Promise<AppFaultRecord> {
    let signature = 'unknown';
    try {
      signature = appFaultSignature(input.source, input.error);
      const previous = this.seen.get(signature);
      if (previous) return { saved: false, duplicate: true, fileName: previous, signature };
      const at = this.now();
      const fileName = `${stamp(at)}-${input.source}-${signature.slice(0, 8)}.json`;
      const error = describeError(input.error);
      const app = this.appInfo();
      const report = {
        createdAt: at.toISOString(),
        appVersion: app.appVersion,
        buildCommit: app.buildCommit,
        platform: { os: process.platform, arch: process.arch, release: process.getSystemVersion?.() ?? null },
        source: input.source,
        signature,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        error,
        context: input.context ?? null
      };
      let text = redactCookiePaths(JSON.stringify(capStrings(redactSecrets(report)), null, 2));
      if (Buffer.byteLength(text) > REPORT_BYTE_LIMIT) {
        text = redactCookiePaths(
          JSON.stringify(capStrings(redactSecrets({ ...report, context: '[đã bỏ vì quá lớn]', error: { ...error, stack: error.stack.slice(0, 8_000) } })), null, 2)
        );
      }
      await mkdir(this.folder, { recursive: true });
      await writeFile(join(this.folder, fileName), text, { encoding: 'utf8', flag: 'wx' });
      this.seen.set(signature, fileName);
      await this.prune(fileName);
      return { saved: true, duplicate: false, fileName, signature };
    } catch {
      return { saved: false, duplicate: false, fileName: null, signature };
    }
  }

  private async prune(keep: string): Promise<void> {
    const names = (await readdir(this.folder).catch(() => [] as string[])).filter((name) => REPORT_FILE.test(name)).sort();
    const sized: Array<{ name: string; size: number }> = [];
    for (const name of names) {
      const info = await stat(join(this.folder, name)).catch(() => null);
      if (info) sized.push({ name, size: info.size });
    }
    let total = sized.reduce((sum, entry) => sum + entry.size, 0);
    let count = sized.length;
    for (const entry of sized) {
      if (count <= this.maxFiles && total <= this.maxBytes) break;
      if (entry.name === keep) continue;
      await rm(join(this.folder, entry.name), { force: true }).catch(() => undefined);
      count -= 1;
      total -= entry.size;
    }
  }
}
