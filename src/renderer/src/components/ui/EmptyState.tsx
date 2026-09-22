import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

/** Trạng thái trống đầy đủ: biểu tượng + câu giải thích + nút hành động (đặc tả GĐ 2a). */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): React.JSX.Element {
  return <div className="tm-empty">
    <span className="tm-empty-icon" aria-hidden="true"><Icon size={24}/></span>
    <h3>{title}</h3>
    <p>{description}</p>
    {action}
  </div>;
}
