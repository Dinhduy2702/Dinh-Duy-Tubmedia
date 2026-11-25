/**
 * 1.8.0 việc A: bộ chạy JavaScript (Deno) đi kèm cho yt-dlp.
 *
 * yt-dlp ≥ 2025.11 cần một bộ chạy JS để giải thử thách của YouTube; thiếu nó yt-dlp cảnh báo "No supported JavaScript
 * runtime could be found ... some formats may be missing" và có máy chỉ còn nhận được bản ≤ 720p. Tubmedia đóng gói
 * `deno.exe` (bản chính thức, ghim phiên bản + SHA-256 trong scripts/ensure-bundled-deno.ps1) vào thư mục tool\ giống aria2.
 *
 * MỌI lần gọi yt-dlp với URL thêm `--js-runtimes deno:<đường dẫn>` qua ytDlpJsRuntimeArguments(). Không thấy tệp kèm sẵn thì
 * không thêm gì — yt-dlp tự dùng deno trong PATH nếu máy có.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolStatus } from '@shared/types/domain.js';

export const BUNDLED_DENO_FILE = 'deno.exe';

let bundledDenoCandidates: string[] = [];

/** Đăng ký các chỗ có thể chứa deno.exe kèm sẵn (gọi một lần lúc dựng ToolManager). Thứ tự = thứ tự ưu tiên. */
export function registerBundledDenoFolders(folders: readonly string[]): void {
  bundledDenoCandidates = folders.map((folder) => join(folder, BUNDLED_DENO_FILE));
}

/** Đường dẫn deno.exe kèm sẵn nếu tệp còn đó (kiểm mỗi lần — tệp có thể bị diệt virus xoá giữa chừng), ngược lại null. */
export function bundledDenoPath(exists: (path: string) => boolean = existsSync): string | null {
  return bundledDenoCandidates.find((candidate) => exists(candidate)) ?? null;
}

/** Phiên bản yt-dlp đầu tiên có tùy chọn `--js-runtimes`. */
export const YTDLP_JS_RUNTIMES_MIN_VERSION = '2025.11.12';

/**
 * yt-dlp cũ (máy người dùng có thể còn bản tự cập nhật từ trước) không biết `--js-runtimes` và sẽ dừng với "no such
 * option" — chỉ thêm tham số khi trợ giúp của yt-dlp có tùy chọn này hoặc phiên bản đủ mới.
 */
export function ytDlpSupportsJsRuntimes(ytdlp: Pick<ToolStatus, 'version' | 'capabilities'>): boolean {
  if (ytdlp.capabilities.includes('ytdlp_js_runtimes')) return true;
  const version = /^\d{4}\.\d{2}\.\d{2}/.exec(ytdlp.version ?? '')?.[0];
  return Boolean(version && version >= YTDLP_JS_RUNTIMES_MIN_VERSION);
}

/** Tham số yt-dlp chỉ định bộ chạy JS kèm sẵn; rỗng khi không có tệp hoặc yt-dlp quá cũ. */
export function ytDlpJsRuntimeArguments(
  ytdlp: Pick<ToolStatus, 'version' | 'capabilities'>,
  denoPath: string | null = bundledDenoPath()
): string[] {
  return denoPath && ytDlpSupportsJsRuntimes(ytdlp) ? ['--js-runtimes', `deno:${denoPath}`] : [];
}

/** Câu nhật ký khởi động: có/không bộ chạy JS và phiên bản yt-dlp (để đọc nhật ký máy người dùng là biết ngay). */
export function ytDlpJsRuntimeStartupMessage(ytDlpVersion: string | null, denoPath: string | null): string {
  const version = ytDlpVersion ?? 'chưa xác định';
  return denoPath
    ? `yt-dlp ${version}; có bộ chạy JavaScript Deno kèm sẵn (${denoPath}).`
    : `yt-dlp ${version}; KHÔNG có bộ chạy JavaScript kèm sẵn — yt-dlp chỉ dùng được deno nếu máy tự cài, YouTube có thể chỉ trả bản ≤ 720p.`;
}
