import type { QueueJob } from '../types/domain.js';

const RUNNING_OR_DONE = new Set<QueueJob['status']>([
  'analyzing',
  'ready',
  'downloading',
  'downloaded',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'completed',
  'skipped'
]);

/**
 * Số hiển thị ở ô "Lần thử N/M". Từ Đợt 1 (2026-10-02) attempts chỉ đếm số lượt đã THẤT BẠI, nên khi tác
 * vụ đang chạy hoặc vừa xong thì lượt hiện tại là attempts + 1; khi đã thất bại hẳn thì attempts đã gồm lượt
 * cuối; còn đang chờ/tạm dừng thì hiển thị số lượt đã dùng.
 */
export function displayedAttempt(job: Pick<QueueJob, 'status' | 'attempts' | 'maxAttempts'>): number {
  const used = Math.max(0, job.attempts);
  const shown = RUNNING_OR_DONE.has(job.status) ? used + 1 : used;
  return Math.min(shown, Math.max(job.maxAttempts, used));
}
