import { useAppStore } from '../stores/app-store';
import { friendlyIssue } from '../utils/ui-error';
import { FriendlyIssueCard } from './FriendlyIssueCard';

export function ErrorBanner(): React.JSX.Element | null {
  const error = useAppStore((state) => state.error);
  const setError = useAppStore((state) => state.setError);
  if (!error) return null;
  const issue = friendlyIssue(error);
  return (
    <div className="mx-5 mt-4">
      <FriendlyIssueCard issue={issue} onDismiss={() => setError(null)} />
    </div>
  );
}
