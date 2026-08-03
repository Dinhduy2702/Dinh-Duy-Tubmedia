import type { ReactNode } from 'react';
import { StatusBadge } from './StatusBadge';

const ACTIVE_PROGRESS_STATES = new Set([
  'pending',
  'queued',
  'preparing',
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying',
  'pausing',
  'resuming',
  'cancelling'
]);

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function UnifiedDownloadProgress({
  title,
  subtitle,
  status,
  progress,
  completed,
  total,
  detail,
  secondary,
  outputPath,
  actions,
  compact = false,
  className = ''
}: {
  title: string;
  subtitle?: string | null;
  status: string;
  progress: number;
  completed: number;
  total: number;
  detail?: string | null;
  secondary?: string | null;
  outputPath?: string | null;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}): React.JSX.Element {
  const safeProgress = clampProgress(progress);
  const safeTotal = Math.max(1, total);
  const safeCompleted = Math.max(0, Math.min(safeTotal, completed));
  const animate = ACTIVE_PROGRESS_STATES.has(status);

  return (
    <section
      className={`unified-download-progress ${compact ? 'is-compact' : ''} ${className}`.trim()}
      data-status={status}
    >
      <header className="unified-download-progress-head">
        <div className="unified-download-progress-copy">
          <div className="unified-download-progress-title">
            <b title={title}>{title}</b>
            <StatusBadge status={status} fixed />
          </div>
          {subtitle && <small title={subtitle}>{subtitle}</small>}
        </div>
        <strong>
          {safeCompleted}/{safeTotal}
        </strong>
      </header>

      <div
        className={`progress progress-large unified-download-progress-bar ${
          animate ? 'is-animated' : 'is-static'
        }`}
        aria-label={`Tiến trình ${safeProgress.toFixed(1)}%`}
      >
        <span style={{ width: `${safeProgress}%` }} />
      </div>

      <div className="unified-download-progress-meta">
        <span>{safeProgress.toFixed(1)}% toàn quy trình</span>
        <span>{detail || 'Đang đồng bộ tiến trình'}</span>
      </div>

      {(secondary || outputPath) && (
        <div className="unified-download-progress-foot">
          {secondary && <span>{secondary}</span>}
          {outputPath && <code title={outputPath}>{outputPath}</code>}
        </div>
      )}

      {actions && <div className="unified-download-progress-actions">{actions}</div>}
    </section>
  );
}
