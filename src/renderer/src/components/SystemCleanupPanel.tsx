import { useEffect, useMemo, useState } from 'react';
import {
  SYSTEM_CLEANUP_CATEGORIES,
  isIrreversibleCleanupSelection,
  systemCleanupRequiresAdmin,
  type SystemCleanupCategoryId,
  type SystemCleanupStatus
} from '@shared/system-cleanup';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);

  return `${(value / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

const terminalPhases = new Set(['completed', 'cancelled', 'failed']);

export function SystemCleanupPanel(): React.JSX.Element {
  const defaultSelection = useMemo(
    () => SYSTEM_CLEANUP_CATEGORIES.filter((item) => item.defaultSelected).map((item) => item.id),
    []
  );

  const [selected, setSelected] = useState<SystemCleanupCategoryId[]>(defaultSelection);
  const [status, setStatus] = useState<SystemCleanupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = Boolean(status && !terminalPhases.has(status.phase));
  const requiresAdmin = systemCleanupRequiresAdmin(selected);
  const selectedItems = SYSTEM_CLEANUP_CATEGORIES.filter((item) => selected.includes(item.id));

  useEffect(() => {
    if (!status || terminalPhases.has(status.phase)) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const next = await window.desktop.systemCleanup.status(status.runId);

        if (next) {
          setStatus(next);
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : 'Không đọc được tiến trình dọn dẹp.');
      }
    }, 600);

    return () => window.clearInterval(timer);
  }, [status?.runId, status?.phase]);

  function toggleCategory(id: SystemCleanupCategoryId): void {
    if (running) {
      return;
    }

    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function start(mode: 'estimate' | 'clean'): Promise<void> {
    setError(null);

    if (selected.length === 0) {
      setError('Hãy chọn ít nhất một hạng mục.');
      return;
    }

    if (mode === 'clean') {
      const names = selectedItems.map((item) => `• ${item.label}`).join('\n');
      const confirmed = window.confirm(
        `Tubmedia sẽ dọn các hạng mục sau:\n\n${names}\n\n` +
          'Các tệp đang bị ứng dụng khác sử dụng sẽ được bỏ qua. Tiếp tục?'
      );

      if (!confirmed) {
        return;
      }

      if (selected.includes('disableHibernate')) {
        const phrase = window.prompt(
          'Tắt ngủ đông sẽ thay đổi tính năng nguồn của Windows.\n' +
            'Nhập chính xác "TAT NGU DONG" để xác nhận:'
        );

        if (phrase !== 'TAT NGU DONG') {
          setError('Đã hủy thao tác tắt chế độ ngủ đông.');
          return;
        }
      }

      if (isIrreversibleCleanupSelection(selected)) {
        const irreversibleConfirmed = window.confirm(
          'Lựa chọn hiện tại có thao tác không thể hoàn tác. Bạn xác nhận tiếp tục?'
        );

        if (!irreversibleConfirmed) {
          return;
        }
      }
    }

    try {
      const next = await window.desktop.systemCleanup.start({
        mode,
        categories: selected
      });
      setStatus(next);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Không thể bắt đầu dọn dẹp.');
    }
  }

  async function cancel(): Promise<void> {
    if (!status) {
      return;
    }

    try {
      const next = await window.desktop.systemCleanup.cancel(status.runId);

      if (next) {
        setStatus(next);
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Không gửi được yêu cầu dừng.');
    }
  }

  return (
    <section className="card system-cleanup-panel" data-testid="system-cleanup-panel">
      <div className="system-cleanup-heading">
        <div>
          <span className="system-cleanup-eyebrow">BẢO TRÌ WINDOWS</span>
          <h2>Dọn dẹp an toàn ổ hệ thống</h2>
          <p>
            Quét trước dung lượng có thể giải phóng, chọn đúng hạng mục rồi theo dõi tiến trình ngay trong
            Tubmedia.
          </p>
        </div>

        <div className="system-cleanup-admin-badge">
          {requiresAdmin ? 'Sẽ hiện yêu cầu UAC' : 'Không cần quyền quản trị'}
        </div>
      </div>

      <div className="system-cleanup-warning">
        Tubmedia không xóa Desktop, Documents, Downloads, Pictures, Videos, Zalo Received Files, thư mục gốc
        CapCut/Zalo hoặc dữ liệu dự án Tubmedia. Hãy đóng Chrome, Edge, CapCut và Zalo để dọn được nhiều hơn.
      </div>

      {(['safe', 'advanced'] as const).map((group) => (
        <div className="system-cleanup-group" key={group}>
          <div className="system-cleanup-group-title">
            {group === 'safe' ? 'Dọn dẹp thông thường' : 'Tùy chọn nâng cao'}
          </div>

          <div className="system-cleanup-grid">
            {SYSTEM_CLEANUP_CATEGORIES.filter((item) => item.group === group).map((item) => {
              const checked = selected.includes(item.id);

              return (
                <label className={`system-cleanup-option ${checked ? 'is-selected' : ''}`} key={item.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={running}
                    onChange={() => toggleCategory(item.id)}
                  />

                  <span className="system-cleanup-option-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>

                    <span className="system-cleanup-tags">
                      {item.requiresAdmin && <em>Quyền quản trị</em>}
                      {item.irreversible && <em>Không thể hoàn tác</em>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {error && <div className="system-cleanup-error">{error}</div>}

      {status && (
        <div className="system-cleanup-progress-card">
          <div className="system-cleanup-progress-head">
            <strong>{status.message}</strong>
            <span>{Math.max(0, Math.min(100, status.progress))}%</span>
          </div>

          <div className="system-cleanup-progress-track">
            <span style={{ width: `${status.progress}%` }} />
          </div>

          <div className="system-cleanup-stats">
            <span>Ước tính: {formatBytes(status.estimatedBytes)}</span>
            <span>Đã giải phóng: {formatBytes(status.removedBytes)}</span>
            <span>Đã xử lý: {status.removedItems.toLocaleString('vi-VN')} mục</span>
            <span>Bỏ qua: {status.skippedItems.toLocaleString('vi-VN')} mục</span>
          </div>

          {status.errors.length > 0 && (
            <details className="system-cleanup-errors">
              <summary>{status.errors.length} mục không thể xử lý</summary>
              <pre>{status.errors.join('\n')}</pre>
            </details>
          )}
        </div>
      )}

      <div className="system-cleanup-actions">
        <button
          type="button"
          className="system-cleanup-button secondary"
          disabled={running || selected.length === 0}
          onClick={() => void start('estimate')}
        >
          Quét dung lượng
        </button>

        <button
          type="button"
          className="system-cleanup-button primary"
          disabled={running || selected.length === 0}
          onClick={() => void start('clean')}
        >
          Dọn dẹp đã chọn
        </button>

        {running && (
          <button type="button" className="system-cleanup-button danger" onClick={() => void cancel()}>
            Yêu cầu dừng
          </button>
        )}
      </div>
    </section>
  );
}
