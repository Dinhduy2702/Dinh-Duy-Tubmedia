import type { LogEntry } from '@shared/types/domain';
import { CompactDetail } from './CompactDetail';
import { friendlyIssue, safeUiText } from '../utils/ui-error';

function shouldDiscloseMessage(message: string): boolean {
  return message.length > 64 || /[\\/].{28,}/.test(message);
}

function levelLabel(level: LogEntry['level']): string {
  if (level === 'info') return 'THÔNG TIN';
  if (level === 'warn') return 'CẢNH BÁO';
  if (level === 'error') return 'LỖI';
  return 'NHẬT KÝ';
}

export function CompactLogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  const issue = entry.level === 'error' || entry.level === 'warn' ? friendlyIssue(entry.message) : null;
  const message = issue?.message ?? safeUiText(entry.message, 'Ứng dụng đã cập nhật trạng thái.');
  const title = issue?.title ?? message;

  return (
    <div className={`log-row log-${entry.level}`}>
      <span className="log-row-time">{new Date(entry.timestamp).toLocaleTimeString('vi-VN')}</span>
      <b className="log-row-level" title={levelLabel(entry.level)}>{levelLabel(entry.level)}</b>
      <div className="log-row-message">
        <p>{title}</p>
        {shouldDiscloseMessage(message) && (
          <CompactDetail
            label="Xem nội dung"
            tone={entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warning' : 'info'}
          >
            <p>{message}</p>
            <small>{new Date(entry.timestamp).toLocaleString('vi-VN')}</small>
          </CompactDetail>
        )}
      </div>
    </div>
  );
}
