import { AlertCircle, X } from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import { friendlyIssue } from '../utils/ui-error';

export function ErrorBanner(): React.JSX.Element | null {
  const error = useAppStore((state) => state.error);
  const setError = useAppStore((state) => state.setError);
  if (!error) return null;
  const issue = friendlyIssue(error);
  return (
    <div
      className="mx-5 mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
      style={{
        borderColor: 'color-mix(in srgb,var(--bad) 45%,var(--border))',
        background: 'color-mix(in srgb,var(--bad) 12%,var(--panel))',
        color: 'var(--bad)'
      }}
    >
      <AlertCircle size={18} />
      <div className="flex-1">
        <b>{issue.title}</b>
        <p>{issue.message}</p>
      </div>
      <button className="btn btn-ghost p-1" onClick={() => setError(null)} aria-label="Đóng thông báo">
        <X size={16} />
      </button>
    </div>
  );
}
