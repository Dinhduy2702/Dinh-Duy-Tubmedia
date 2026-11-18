import type { AppSettings, MediaInfo } from '../types/domain.js';
import { isCapCutDownloadMode, type CapCutCompatibilityPlan } from './download-quality.js';

/**
 * 1.7.5 (người dùng duyệt 2026-11-03): mỗi video chỉ một tệp. "CapCut trực tiếp" mà không bật "tạo thêm bản CapCut" → tệp tải
 * về chính là tệp dùng trong CapCut: đạt chuẩn thì giữ nguyên, chưa đạt thì mã hoá một lần rồi THAY tệp gốc.
 * Bật "tạo thêm bản CapCut" (downloadEditCopyMode) → vẫn giữ bản gốc + bản CapCut như trước, cho ai cần 2 tệp.
 */
export function isCapCutOneFileMode(settings: AppSettings): boolean {
  return (
    (settings.downloadEditCopyMode ?? 'off') === 'off' &&
    isCapCutDownloadMode(settings.downloadCompatibilityMode)
  );
}

/**
 * Số bản mã hoá CapCut chạy cùng lúc trên máy đang chạy: các bản cộng lại dùng khoảng MỘT NỬA số nhân, phần còn lại để
 * người dùng làm việc. Đo thật (máy 72 nhân): mỗi bản với `threads` luồng dùng ~1,3 × threads nhân (giải mã + lọc + mã hoá).
 */
export function editEncodeLimit(logicalCpus: number, threadsPerEncode: number): number {
  const coresPerEncode = Math.max(1, threadsPerEncode) * 1.3;
  return Math.max(1, Math.floor((Math.max(0, logicalCpus) * 0.5) / coresPerEncode));
}

/**
 * 1.7.7 (việc A): Trần cứng CPU động có sàn (Windows Job Object HARD_CAP) cho nhóm mã hoá CapCut nền:
 * - Máy >= 4 luồng: giữ tổng CPU toàn máy < 60% khi vừa tải vừa mã hoá (~56% - tải khác, sàn 43% để thời gian <= 2x, trần 48%).
 * - Máy <= 2 luồng (Q1b đã duyệt): thời gian mã hoá <= 2x (sàn 45%), chấp nhận tổng CPU 65-70% (~68% - tải khác, trần 50%).
 */
export function computeBackgroundEncodeCpuCapPercent(logicalCpus: number, otherCpuPercent: number): number {
  const safeCpus = Math.max(1, Math.trunc(logicalCpus));
  const other = Number.isFinite(otherCpuPercent) ? Math.max(0, Math.min(100, otherCpuPercent)) : 0;
  if (safeCpus <= 2) {
    return Math.max(45, Math.min(50, Math.round(68 - other)));
  }
  if (safeCpus <= 4) {
    return Math.max(43, Math.min(48, Math.round(56 - other)));
  }
  return Math.max(25, Math.min(50, Math.round(55 - other)));
}

/** Kích thước sau thu nhỏ — đúng như `scale=w='min(iw,W)':h='min(ih,H)':force_original_aspect_ratio=decrease:force_divisible_by=2`. */
export function capCutScaledSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  let w = Math.min(width, maxWidth);
  let h = Math.min(height, maxHeight);
  w = Math.min(w, Math.round((h * width) / height));
  h = Math.min(h, Math.round((w * height) / width));
  return { width: Math.max(2, Math.floor(w / 2) * 2), height: Math.max(2, Math.floor(h / 2) * 2) };
}

/**
 * Chuỗi bộ lọc tạo bản CapCut. HDR cần thu nhỏ: thu nhỏ NGAY ở bước zscale đầu (ánh sáng tuyến tính) rồi mới chuyển màu — chuyển
 * màu số thực trên khung 4K tốn gấp 4 lần (đo thật 0,39x → 1,30x, SSIM 0,993). SDR giữ nguyên chuỗi cũ.
 */
export function capCutFilterChain(plan: CapCutCompatibilityPlan, info: MediaInfo): string[] {
  const filters: string[] = [];
  const maxHeight = plan.maxHeight ?? info.height;
  const maxWidth = maxHeight === 1440 ? 2560 : 1920;
  const tooHigh = info.height > maxHeight + 2;
  let scaled = false;
  if (plan.requiresHdrToneMap) {
    if (tooHigh) {
      const size = capCutScaledSize(info.width, info.height, maxWidth, maxHeight);
      filters.push(`zscale=w=${size.width}:h=${size.height}:t=linear:npl=100`);
      scaled = true;
    } else {
      filters.push('zscale=t=linear:npl=100');
    }
    filters.push('format=gbrpf32le', 'tonemap=hable:desat=0', 'zscale=p=bt709:t=bt709:m=bt709:r=tv');
  } else if (plan.requiresColorConversion) {
    filters.push('zscale=p=bt709:t=bt709:m=bt709:r=tv');
  }
  if (tooHigh && !scaled) {
    filters.push(
      `scale=w='min(iw,${maxWidth})':h='min(ih,${maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2`
    );
  }
  if (info.fps > 60.5) filters.push('fps=60');
  filters.push('setsar=1', 'format=yuv420p');
  return filters;
}
