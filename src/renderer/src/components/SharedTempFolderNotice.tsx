import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { buildSharedTempFolderNotice } from '@shared/utils/shared-folder-policy';
import { useAppStore } from '../stores/app-store';
import { safeUiText } from '../utils/ui-error';

/**
 * Đợt 2 mục 4 (2026-10-02): khi mở app, nếu có danh sách đang dùng thư mục chung (Downloads, Desktop, gốc ổ
 * đĩa...) làm thư mục tạm thì nhắc người dùng. Chỉ nhắc — Tubmedia không tự đổi cấu hình, không di chuyển dữ liệu.
 * "Không nhắc lại cho danh sách này" được lưu bền theo từng danh sách (cài đặt dismissedSharedTempWarnings) và chỉ
 * còn hiệu lực khi danh sách vẫn dùng đúng thư mục đó. Nút X chỉ ẩn trong lần mở app này.
 */
export function SharedTempFolderNotice(): React.JSX.Element | null {
  const projects = useAppStore((state) => state.projects);
  const settings = useAppStore((state) => state.settings);
  const [hidden, setHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (hidden || !settings) return null;
  const notice = buildSharedTempFolderNotice(projects, settings.dismissedSharedTempWarnings ?? {});
  if (!notice) return null;

  const dismiss = async (id: string, tempFolder: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      const next = await window.desktop.settings.update({
        dismissedSharedTempWarnings: { ...(settings.dismissedSharedTempWarnings ?? {}), [id]: tempFolder }
      });
      useAppStore.setState({ settings: next });
    } catch (dismissError) {
      setError(safeUiText(dismissError, 'Không lưu được lựa chọn. Hãy thử lại.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="shared-temp-folder-notice tone-warning" role="note" aria-label={notice.title}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <b>{notice.title}</b>
          <p className="text-sm">{notice.message}</p>
          <ul className="mt-2 space-y-1">
            {notice.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{item.name}</span>
                <span className="truncate font-mono text-xs">{item.tempFolder}</span>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busyId !== null}
                  onClick={() => void dismiss(item.id, item.tempFolder)}
                >
                  Không nhắc lại cho danh sách này
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-1 text-sm">{error}</p>}
        </div>
        <button
          type="button"
          className="icon-action"
          aria-label="Ẩn thông báo trong lần mở này"
          title="Ẩn thông báo trong lần mở này"
          onClick={() => setHidden(true)}
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}
