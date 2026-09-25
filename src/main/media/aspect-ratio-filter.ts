/**
 * Bộ lọc "nền mờ kiểu CapCut" dùng chung cho MỌI nơi đổi tỉ lệ khung hình trong app — ban đầu viết cho
 * "Cắt tệp có sẵn" (Giai đoạn 6 mục 3, 2026-09-24), tái dùng nguyên vẹn cho preset xuất theo nền tảng ở
 * Ghép theo Timeline (Giai đoạn 6 mục 4) theo đúng yêu cầu người dùng ("tái dùng đúng cơ chế đổi tỉ lệ đã
 * có ở mục 3"). Tách riêng ra tệp này để không có hai bản định nghĩa khác nhau cho cùng một bộ lọc.
 */
import type { LocalCutAspectRatio } from '@shared/local-cut.js';

/**
 * Độ phân giải đích cho từng tỉ lệ — theo đúng chuẩn xuất phổ biến của nền tảng (Reels/Shorts 1080x1920,
 * bài đăng vuông 1080x1080, video ngang chuẩn 1920x1080).
 */
export const ASPECT_RATIO_DIMENSIONS: Record<
  Exclude<LocalCutAspectRatio, 'original'>,
  { width: number; height: number }
> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 }
};

/**
 * Bộ lọc "nền mờ kiểu CapCut": phóng to + cắt để lấp đầy khung mới rồi làm mờ làm nền; video gốc scale
 * vừa khít bên trong khung mới (không cắt, không méo) rồi đặt giữa. Đã xác nhận THẬT bằng ffmpeg thật
 * trước khi dùng (test 16:9→9:16, 16:9→16:9, 16:9→1:1, và nguồn không có âm thanh) — không chỉ đọc cú
 * pháp lý thuyết.
 */
export function buildAspectRatioFilter(width: number, height: number): string {
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=20[bg];` +
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,setsar=1`
  );
}
