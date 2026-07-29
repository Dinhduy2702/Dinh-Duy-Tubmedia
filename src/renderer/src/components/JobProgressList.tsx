import { CheckCircle2, CircleDashed, Download, FileVideo2 } from 'lucide-react';
import type { QueueJob } from '@shared/types/domain';
import { shouldAnimateJobProgress } from '@shared/utils/progress-policy';
import { statusLabel } from '../utils/vi-labels';

function inputText(job: QueueJob, key: string): string | null {
  const value = job.input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function etaLabel(seconds: number | null): string {
  if (seconds === null) return 'Chưa xác định thời gian còn lại';
  if (seconds < 60) return `Còn khoảng ${seconds} giây`;
  const minutes = Math.ceil(seconds / 60);
  return `Còn khoảng ${minutes} phút`;
}

export function JobProgressList({ jobs }: { jobs: QueueJob[] }): React.JSX.Element | null {
  const downloads = jobs.filter((job) => job.type === 'download');
  if (downloads.length === 0) return null;

  return <section className="job-progress-panel" aria-label="Tiến trình từng video">
    <header>
      <div>
        <span>TIẾN TRÌNH TỪNG VIDEO</span>
        <b>{downloads.length} liên kết đã được đưa vào hàng đợi</b>
      </div>
      <Download size={18}/>
    </header>
    <div className="job-progress-list scroll">
      {downloads.map((job, index) => {
        const title = inputText(job, 'displayName') ?? inputText(job, 'url') ?? `Video ${index + 1}`;
        const url = inputText(job, 'url');
        const outputPath = inputText(job, 'outputPath');
        const finished = ['completed', 'skipped'].includes(job.status);
        return <article className={`job-progress-row job-progress-${job.status}`} key={job.id}>
          <div className="job-progress-index">
            {finished ? <CheckCircle2 size={17}/> : job.status === 'downloading' ? <Download size={17}/> : <CircleDashed size={17}/>}
            <span>{String(index + 1).padStart(2, '0')}</span>
          </div>
          <div className="job-progress-copy">
            <div className="job-progress-title">
              <b title={title}>{title}</b>
              <span className="job-progress-status" title={statusLabel(job.status)}>{statusLabel(job.status)}</span>
            </div>
            {url && title !== url && <small title={url}>{url}</small>}
            <div className={`progress job-progress-bar ${shouldAnimateJobProgress(job.status) ? 'is-animated' : 'is-static'}`}><span style={{ width: `${job.progress}%` }}/></div>
            <div className="job-progress-meta">
              <span>{job.progress.toFixed(1)}%</span>
              <span>{job.speed ?? etaLabel(job.etaSeconds)}</span>
            </div>
            {outputPath && <div className="job-output-path" title={outputPath}><FileVideo2 size={13}/>{outputPath}</div>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
