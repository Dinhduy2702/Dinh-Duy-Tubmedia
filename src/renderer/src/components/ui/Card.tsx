import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Thẻ dùng chung (bo góc 14px, tiêu đề + biểu tượng tùy chọn) — dùng cho các trang thiết kế lại GĐ 2a. */
export function Card({ title, subtitle, icon: Icon, actions, className = '', children }: CardProps): React.JSX.Element {
  return <section className={`tm-card ${className}`.trim()}>
    {(title || Icon) && <div className="tm-card-head">
      {Icon && <span className="tm-card-head-icon" aria-hidden="true"><Icon size={17}/></span>}
      {title && <div className="min-w-0 flex-1">
        <h3>{title}</h3>
        {subtitle && <small>{subtitle}</small>}
      </div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>}
    {children}
  </section>;
}
