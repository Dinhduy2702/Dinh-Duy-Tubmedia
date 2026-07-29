import { Bug, ChevronDown, ChevronUp, Copy, FileText, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LogEntry } from '@shared/types/domain';
import {
  isDiagnosticStillBlocking,
  shouldDisplayDiagnostic,
  TRANSIENT_DIAGNOSTIC_DURATION_MS
} from '@shared/utils/diagnostic-policy';
import { useAppStore } from '../stores/app-store';

function technicalText(error: string | null, log: LogEntry | null): string {
  if (error) return error;
  if (!log) return '';
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
}

export function DiagnosticDock(): React.JSX.Element | null {
  const error = useAppStore((state) => state.error);
  const jobs = useAppStore((state) => state.jobs);
  const logs = useAppStore((state) => state.logs);
  const setError = useAppStore((state) => state.setError);
  const setPage = useAppStore((state) => state.setPage);
  const log = logs.find((entry) => shouldDisplayDiagnostic(entry, jobs)) ?? null;
  const diagnosticId = error ? `ui:${error}` : (log?.id ?? '');
  const blocking = Boolean(log && isDiagnosticStillBlocking(log, jobs));
  const [dismissedId, setDismissedId] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (diagnosticId && diagnosticId !== dismissedId) setExpanded(false);
  }, [diagnosticId, dismissedId]);

  useEffect(() => {
    if (!diagnosticId || error || blocking) return;
    const timestamp = log ? Date.parse(log.timestamp) : Date.now();
    const elapsed = Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : 0;
    const wait = Math.max(500, TRANSIENT_DIAGNOSTIC_DURATION_MS - elapsed);
    const timer = window.setTimeout(() => setDismissedId(diagnosticId), wait);
    return () => window.clearTimeout(timer);
  }, [blocking, diagnosticId, error, log]);

  const technical = useMemo(() => technicalText(error, log), [error, log]);
  if (!diagnosticId || diagnosticId === dismissedId) return null;

  const eventCode = error ? 'UI_RUNTIME_ERROR' : (log?.eventCode ?? 'UNKNOWN_ERROR');
  const message = error ?? log?.message ?? 'Lỗi chưa xác định.';
  const close = (): void => {
    setDismissedId(diagnosticId);
    if (error) setError(null);
  };

  return (
    <aside className="diagnostic-dock" role="alert" aria-live="assertive">
      <div className="diagnostic-dock-accent" />
      <div className="diagnostic-dock-head">
        <span className="diagnostic-dock-icon">
          <Bug size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <b>{blocking || error ? 'Trung tâm lỗi cần xử lý' : 'Thông báo chẩn đoán'}</b>
          <small>{eventCode}</small>
        </div>
        <button
          className="icon-action"
          title="Đóng thông báo này"
          aria-label="Đóng thông báo này"
          onClick={close}
        >
          <X size={15} />
        </button>
      </div>
      <p>{message}</p>
      <div className="diagnostic-dock-actions">
        <button className="btn btn-small" onClick={() => void window.desktop.app.writeClipboard(technical)}>
          <Copy size={14} />
          Sao chép lỗi
        </button>
        <button className="btn btn-small" onClick={() => setPage('logs')}>
          <FileText size={14} />
          Mở nhật ký
        </button>
        <button className="btn btn-small btn-ghost" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Chi tiết
        </button>
      </div>
      {expanded && <pre className="diagnostic-dock-technical">{technical}</pre>}
    </aside>
  );
}
