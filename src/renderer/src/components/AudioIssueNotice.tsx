import { VolumeX } from 'lucide-react';
import type { QueueJob } from '@shared/types/domain';
import { audioIssueLabel, audioIssueNote, isAudioIssue } from '@shared/utils/audio-presence';
import { HoverTip } from './HoverTip';

/**
 * P1 (2026-10-10): video tải xong nhưng không có tiếng / tiếng im lặng — do NGUỒN (người đăng tải lên không có tiếng). Trước
 * đây chỉ có một dòng nhật ký nên người dùng tưởng app làm mất tiếng.
 */
export function AudioIssueBadge({ job }: { job: QueueJob }): React.JSX.Element | null {
  const issue = job.input.audioIssue;
  if (!isAudioIssue(issue)) return null;
  return (
    <span className="audio-issue-badge" data-audio-issue={issue} title={audioIssueNote(issue)}>
      <VolumeX size={12} aria-hidden="true" />
      {audioIssueLabel(issue)}
    </span>
  );
}

function videoName(job: QueueJob): string {
  const name = job.input.displayName ?? job.input.url;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Video';
}

/** Một dòng gọn dưới thanh tiến độ của danh sách / quy trình ghép; danh sách tên video hiện khi rê chuột. */
export function AudioIssueSummary({ jobs }: { jobs: readonly QueueJob[] }): React.JSX.Element | null {
  const affected = jobs.filter((job) => job.type === 'download' && isAudioIssue(job.input.audioIssue));
  if (affected.length === 0) return null;
  const details = affected
    .map((job) => `"${videoName(job)}" (${audioIssueLabel(job.input.audioIssue as 'missing' | 'silent').toLowerCase()})`)
    .join('; ');
  return (
    <div className="audio-issue-summary" role="status" data-audio-issue-count={affected.length}>
      <VolumeX size={14} aria-hidden="true" />
      <span>{affected.length} video không có tiếng từ nguồn</span>
      <HoverTip
        text={`Các video sau tải xong nhưng nguồn không có tiếng hoặc âm thanh im lặng hoàn toàn — tải lại cũng không có tiếng: ${details}.`}
        className="audio-issue-tip"
        tone="warning"
      >
        <span aria-hidden="true">ⓘ</span>
      </HoverTip>
    </div>
  );
}
