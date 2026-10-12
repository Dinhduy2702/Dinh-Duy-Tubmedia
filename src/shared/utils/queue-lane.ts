import type { QueueJob, ResourceProfile } from '../types/domain.js';

export type QueueExecutionLane = 'download-list' | 'merge-workflow' | 'processing';

type LaneJob = Pick<QueueJob, 'type' | 'input'>;

export function queueExecutionLane(job: LaneJob): QueueExecutionLane {
  if (job.type === 'download') {
    return job.input.workflow === 'download-merge' ? 'merge-workflow' : 'download-list';
  }
  if (job.type === 'clip' || job.type === 'normalize' || job.type === 'merge') {
    return 'merge-workflow';
  }
  return 'processing';
}

export function independentDownloadProjectCanStart(
  activeInProject: number,
  profile: Pick<ResourceProfile, 'downloadWorkers'>
): boolean {
  const projectLimit = Math.max(1, Math.min(16, Math.round(profile.downloadWorkers || 1)));
  return Math.max(0, activeInProject) < projectLimit;
}

/**
 * Lag bước 1 (2026-10-12): trần SỐ DANH SÁCH tải / SỐ QUY TRÌNH ghép chạy "full" cùng lúc. Danh sách đang giữ lượt (có ít
 * nhất một tác vụ đang chạy) luôn chạy tiếp với đủ luồng của hồ sơ; danh sách khác chỉ vào khi còn lượt trống. Trần này
 * KHÔNG chia nhỏ luồng của từng danh sách (downloadWorkers giữ nguyên theo hồ sơ phần cứng).
 */
export function laneSlotAvailable(projectId: string, holders: ReadonlySet<string>, cap: number): boolean {
  return holders.has(projectId) || holders.size < Math.max(1, cap);
}

/** Ô "Số danh sách tải chạy cùng lúc": 0 = tự động theo máy (khuyến nghị phần cứng), 1–6 = đúng số đã chọn. */
export function effectiveConcurrentDownloadLists(setting: number, automatic: number): number {
  const chosen = Math.trunc(Number(setting) || 0);
  return chosen >= 1 ? Math.min(6, chosen) : Math.max(1, Math.min(6, automatic));
}

/**
 * Trần riêng số video tải cùng lúc theo nền tảng trên toàn ứng dụng (cả làn ghép) — lưới an toàn chống HTTP 429 (hướng A
 * kế hoạch 429, đã duyệt: YouTube 6), độc lập với trần số danh sách vì 2 danh sách × 4 luồng vẫn ra 8 video YouTube.
 */
export const PLATFORM_DOWNLOAD_CAPS: Readonly<Record<string, number>> = Object.freeze({ youtube: 6 });

export function platformDownloadCap(platform: string | null): number | null {
  return platform ? (PLATFORM_DOWNLOAD_CAPS[platform] ?? null) : null;
}

/**
 * Lag bước 2: bắt đầu dần — tối đa MAX_JOB_STARTS_PER_WINDOW tác vụ được BẮT ĐẦU trong mỗi JOB_START_WINDOW_MS (đúng nhịp
 * tick 350 ms khi có việc). Mỗi lần mở yt-dlp tốn ≈0,77 s CPU; mở 8 tiến trình cùng lúc làm máy đứng hình vài giây. Tính theo
 * THỜI GIAN chứ không theo lượt tick, vì mỗi lần hàng đợi đổi trạng thái (emit) đều gọi tick ngay — các lượt tick sát nhau
 * vẫn chung một suất. Tổng số chạy cùng lúc không đổi.
 */
export const MAX_JOB_STARTS_PER_WINDOW = 2;
export const JOB_START_WINDOW_MS = 350;

/** Các lần bắt đầu còn nằm trong cửa sổ hiện tại (bỏ mốc cũ và mốc "tương lai" khi đồng hồ máy bị lùi). */
export function recentJobStarts(startTimes: readonly number[], now: number): number[] {
  return startTimes.filter((time) => time <= now && now - time < JOB_START_WINDOW_MS);
}
