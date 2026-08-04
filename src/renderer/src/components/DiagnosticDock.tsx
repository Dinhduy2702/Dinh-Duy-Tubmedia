import { AlertTriangle, Copy, FileText, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LogEntry } from '@shared/types/domain';
import {
  isDiagnosticStillBlocking,
  shouldDisplayDiagnostic,
  TRANSIENT_DIAGNOSTIC_DURATION_MS
} from '@shared/utils/diagnostic-policy';
import { useAppStore } from '../stores/app-store';
import { friendlyIssue } from '../utils/ui-error';

function supportText(error: unknown, log: LogEntry | null): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  if (error !== null && error !== undefined) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return 'Không thể tạo thông tin hỗ trợ.';
    }
  }
  if (!log) return '';
  try {
    return JSON.stringify(
      {
        time: log.timestamp,
        component: log.module,
        eventCode: log.eventCode,
        message: log.message,
        projectId: log.projectId ?? null,
        jobId: log.jobId ?? null,
        metadata: log.metadata ?? null
      },
      null,
      2
    );
  } catch {
    return log.message;
  }
}

export function DiagnosticDock(): React.JSX.Element | null {
  const jobs = useAppStore((state) => state.jobs);
  const logs = useAppStore((state) => state.logs);
  const setPage = useAppStore((state) => state.setPage);
  const log = logs.find((entry) => shouldDisplayDiagnostic(entry, jobs)) ?? null;
  const blocking = Boolean(log && isDiagnosticStillBlocking(log, jobs));
  const issue = useMemo(() => friendlyIssue(log?.message ?? ''), [log]);
  const diagnosticId = log?.id ?? '';
  const [dismissedId, setDismissedId] = useState('');

  useEffect(() => {
    if (!diagnosticId || blocking) return;
    const timestamp = log ? Date.parse(log.timestamp) : Date.now();
    const elapsed = Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : 0;
    const wait = Math.max(500, TRANSIENT_DIAGNOSTIC_DURATION_MS - elapsed);
    const timer = window.setTimeout(() => setDismissedId(diagnosticId), wait);
    return () => window.clearTimeout(timer);
  }, [blocking, diagnosticId, log]);

  if (!diagnosticId || diagnosticId === dismissedId) return null;
  const technical = supportText(null, log);
  const close = (): void => {
    setDismissedId(diagnosticId);
  };

  return (
    <aside className={`diagnostic-dock diagnostic-${issue.tone}`} role="alert" aria-live="assertive">
      <div className="diagnostic-dock-accent" />
      <div className="diagnostic-dock-head">
        <span className="diagnostic-dock-icon"><AlertTriangle size={17} /></span>
        <div className="min-w-0 flex-1">
          <b>{issue.title}</b>
          <small>{blocking ? 'Tác vụ đang chờ bạn xử lý' : 'Thông báo cần kiểm tra'}</small>
        </div>
        <button className="icon-action" title="Đóng thông báo này" aria-label="Đóng thông báo này" onClick={close}>
          <X size={15} />
        </button>
      </div>
      <p>{issue.message}</p>
      {issue.steps.length > 0 && (
        <ol>{issue.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      )}
      <div className="diagnostic-dock-actions">
        <button className="btn btn-small" onClick={() => setPage('logs')}>
          <FileText size={14} />
          Mở nhật ký
        </button>
        <button className="btn btn-small btn-ghost" onClick={() => void window.desktop.app.writeClipboard(technical)}>
          <Copy size={14} />
          Sao chép thông tin hỗ trợ
        </button>
      </div>
    </aside>
  );
}
