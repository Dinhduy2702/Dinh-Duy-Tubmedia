import type { LucideIcon } from 'lucide-react';

interface WorkflowCardProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
  actionLabel: string;
  tone?: 'primary' | 'good' | 'warning' | 'neutral';
  onOpen(): void;
}

export function WorkflowCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  meta,
  actionLabel,
  tone = 'neutral',
  onOpen
}: WorkflowCardProps): React.JSX.Element {
  return (
    <article className={`editor-workflow-card is-${tone}`}>
      <div className="editor-workflow-card-head">
        <span className="editor-workflow-icon"><Icon size={22} /></span>
        <span className="editor-workflow-eyebrow">{eyebrow}</span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="editor-workflow-card-footer">
        <span>{meta}</span>
        <button className="btn btn-primary" type="button" onClick={onOpen}>{actionLabel}</button>
      </div>
    </article>
  );
}
