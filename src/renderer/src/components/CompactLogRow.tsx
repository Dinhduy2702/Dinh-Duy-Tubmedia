import type { LogEntry } from '@shared/types/domain';
import { CompactDetail } from './CompactDetail';

function shouldDiscloseMessage(message: string): boolean {
  return message.length > 64 || /[\\/].{28,}/.test(message);
}

function levelLabel(level: LogEntry['level']): string {
  if (level === 'info') return 'THÔNG TIN';
  if (level === 'warn') return 'CẢNH BÁO';
  if (level === 'error') return 'LỖI';
  return 'GỠ LỖI';
}

export function CompactLogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  const fullMessage = `[${entry.eventCode}] ${entry.message}`;

  return <div className={`log-row log-${entry.level}`}>
    <span className="log-row-time">{new Date(entry.timestamp).toLocaleTimeString('vi-VN')}</span>
    <b className="log-row-level" title={levelLabel(entry.level)}>{levelLabel(entry.level)}</b>
    <div className="log-row-message">
      <p>{fullMessage}</p>
      {shouldDiscloseMessage(fullMessage) && <CompactDetail
        label="Nội dung đầy đủ của nhật ký"
        tone={entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warning' : 'info'}
      >
        <p>{entry.message}</p>
        <dl>
          <div><dt>Mã sự kiện</dt><dd>{entry.eventCode}</dd></div>
          <div><dt>Thời gian</dt><dd>{new Date(entry.timestamp).toLocaleString('vi-VN')}</dd></div>
          {entry.jobId && <div><dt>Mã tác vụ</dt><dd>{entry.jobId}</dd></div>}
        </dl>
      </CompactDetail>}
    </div>
  </div>;
}
