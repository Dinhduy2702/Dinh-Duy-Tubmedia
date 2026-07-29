import { AlertTriangle, LoaderCircle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  details?: string[];
  secondaryLabel?: string | undefined;
  secondaryDanger?: boolean;
  onSecondary?: (() => void) | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Quay lại',
  busy = false,
  danger = false,
  details = [],
  secondaryLabel,
  secondaryDanger = false,
  onSecondary,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element | null {
  if (!open) return null;
  return <>
    <div className="dialog-overlay confirm-overlay" onMouseDown={() => { if (!busy) onCancel(); }}/>
    <section className="dialog-content confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <button className="dialog-close" disabled={busy} onClick={onCancel} aria-label="Đóng"><X size={18}/></button>
      <div className={`confirm-icon ${danger ? 'confirm-icon-danger' : ''}`}><AlertTriangle size={26}/></div>
      <h2>{title}</h2>
      <p>{message}</p>
      {details.length > 0 && <ul>{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
      <div className="confirm-actions">
        <button className="btn" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        {secondaryLabel && onSecondary && <button
          className={secondaryDanger ? 'btn btn-danger confirm-danger-button' : 'btn'}
          disabled={busy}
          onClick={onSecondary}
        >
          {secondaryLabel}
        </button>}
        <button className={danger ? 'btn btn-danger confirm-danger-button' : 'btn btn-primary'} disabled={busy} onClick={onConfirm}>
          {busy && <LoaderCircle className="animate-spin" size={17}/>} {busy ? 'Đang xử lý...' : confirmLabel}
        </button>
      </div>
    </section>
  </>;
}
