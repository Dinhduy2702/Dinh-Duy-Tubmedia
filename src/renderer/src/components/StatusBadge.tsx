import { AlertTriangle, CheckCircle2, Circle, Clock3, Pause, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { statusLabel } from '../utils/vi-labels';

const STATUS_COLORS: Record<string, string> = {
  idle: '#0ea5e9', draft: '#64748b', pending: '#8b5cf6', analyzing: '#06b6d4',
  ready: '#14b8a6', downloading: '#2563eb', downloaded: '#4f46e5', verifying: '#d97706',
  normalizing: '#c026d3', processing: '#ea580c', merging: '#9333ea', paused: '#ca8a04',
  retrying: '#db2777', completed: '#16a34a', success: '#22c55e', healthy: '#10b981',
  valid: '#059669', skipped: '#65a30d', cancelled: '#64748b', failed: '#dc2626',
  error: '#ef4444', broken: '#b91c1c', interrupted: '#f43f5e', warning: '#f59e0b'
};

function statusColor(status: string): string {
  if (STATUS_COLORS[status]) return STATUS_COLORS[status];
  const partial = Object.keys(STATUS_COLORS).find((key) => status.includes(key));
  const partialColor = partial ? STATUS_COLORS[partial] : undefined;
  return partialColor ?? '#0ea5e9';
}

export function StatusBadge({ status, fixed = false }: { status: string; fixed?: boolean }): React.JSX.Element {
  const lower = status.toLowerCase();
  const Icon = lower.includes('complete') || lower === 'healthy' || lower === 'valid' || lower === 'success'
    ? CheckCircle2
    : lower.includes('fail') || lower === 'broken' || lower === 'error'
      ? XCircle
      : lower.includes('pause')
        ? Pause
        : lower.includes('warn') || lower === 'interrupted'
          ? AlertTriangle
          : lower.includes('pending') || lower === 'draft'
            ? Clock3
            : Circle;
  const color = statusColor(lower);
  const label = statusLabel(status);
  const style = {
    '--status-color': color,
    color,
    borderColor: `color-mix(in srgb, ${color} 48%, var(--border))`
  } as CSSProperties;

  return <span
    className={`badge status-badge status-badge-${lower.replace(/[^a-z0-9_-]/g, '-')} ${fixed ? 'status-badge-fixed' : ''}`.trim()}
    data-status={lower}
    title={label}
    style={style}
  >
    <Icon size={13}/><span>{label}</span>
  </span>;
}
