import { AlertTriangle } from 'lucide-react';
import type { QueueJob } from '@shared/types/domain';
import { HoverTip } from './HoverTip';

/** Đọc cảnh báo chất lượng thấp hơn mức đặt (vd. CapCut + bật "Cho phép thấp hơn" tải bản < 1080p). */
function jobQualityWarning(job: QueueJob): string | null {
  const value = job.input.qualityWarning;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function shortQualityLabel(warning: string): string {
  const heightMatch = /(\d{3,4}p)/.exec(warning);
  if (warning.includes('1080p') && heightMatch) {
    return `Thấp hơn 1080p (${heightMatch[1]})`;
  }
  return heightMatch ? `Thấp hơn mức đặt (${heightMatch[1]})` : 'Thấp hơn mức đặt';
}

function videoName(job: QueueJob): string {
  const name = job.input.displayName ?? job.input.url;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Video';
}

/**
 * 1.8.0: nhãn cảnh báo vàng trên dòng tác vụ khi CapCut (hoặc danh sách) tải bản thấp hơn 1080p vì ô "Cho phép thấp hơn" bật.
 */
export function QualityFallbackBadge({ job }: { job: QueueJob }): React.JSX.Element | null {
  const warning = jobQualityWarning(job);
  if (!warning) return null;
  return (
    <span className="quality-fallback-badge" role="status" data-quality-fallback="true" title={warning}>
      <AlertTriangle size={12} aria-hidden="true" />
      {shortQualityLabel(warning)}
    </span>
  );
}

/** Khung cảnh báo vàng trong bảng chi tiết tác vụ khi bản tải thấp hơn mức đặt. */
export function QualityFallbackDetailBanner({ job }: { job: QueueJob }): React.JSX.Element | null {
  const warning = jobQualityWarning(job);
  if (!warning) return null;
  return (
    <div className="blocking-card blocking-warning" role="status">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <b>Bản tải thấp hơn mức đặt</b>
        <p>{warning}</p>
      </div>
    </div>
  );
}

/** Dòng tóm tắt màu vàng gọn dưới thanh tiến độ của danh sách khi có video tải ở chất lượng thấp hơn 1080p. */
export function QualityFallbackSummary({ jobs }: { jobs: readonly QueueJob[] }): React.JSX.Element | null {
  const affected = jobs.filter((job) => job.type === 'download' && jobQualityWarning(job) !== null);
  if (affected.length === 0) return null;
  const details = affected
    .map((job) => `"${videoName(job)}" (${shortQualityLabel(jobQualityWarning(job)!).toLowerCase()})`)
    .join('; ');
  return (
    <div className="audio-issue-summary" role="status" data-quality-fallback-count={affected.length}>
      <AlertTriangle size={14} aria-hidden="true" />
      <span>{affected.length} video tải ở bản thấp hơn 1080p (do bật "Cho phép thấp hơn")</span>
      <HoverTip
        text={`Nguồn không có bản từ 1080p trở lên nên Tubmedia đã lấy bản tốt nhất hiện có và không phóng to giả: ${details}.`}
        className="audio-issue-tip"
        tone="warning"
      >
        <span aria-hidden="true">ⓘ</span>
      </HoverTip>
    </div>
  );
}
