import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

type InfoTone = 'neutral' | 'good' | 'warning' | 'danger' | 'info';

interface InfoDisclosureProps {
  title: string;
  summary: string;
  icon: LucideIcon;
  status?: string;
  tone?: InfoTone;
  defaultOpen?: boolean;
  autoOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InfoDisclosure({
  title,
  summary,
  icon: Icon,
  status,
  tone = 'neutral',
  defaultOpen = false,
  autoOpen = false,
  actions,
  children,
  className = ''
}: InfoDisclosureProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen || autoOpen);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  return <section className={`info-disclosure info-tone-${tone} ${open ? 'is-open' : ''} ${className}`.trim()}>
    <div className="info-disclosure-bar">
      <button
        type="button"
        className="info-disclosure-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="info-disclosure-icon"><Icon size={18}/></span>
        <span className="info-disclosure-copy">
          <b>{title}</b>
          <small>{summary}</small>
        </span>
        {status && <span className="info-disclosure-status">{status}</span>}
        <span className="info-disclosure-chevron" aria-hidden="true"><ChevronDown size={17}/></span>
      </button>
      {actions && <div className="info-disclosure-actions">{actions}</div>}
    </div>
    <div className="info-disclosure-collapse" aria-hidden={!open}>
      <div className="info-disclosure-body">{children}</div>
    </div>
  </section>;
}
