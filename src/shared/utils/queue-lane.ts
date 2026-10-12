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
