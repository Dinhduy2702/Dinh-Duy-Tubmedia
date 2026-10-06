import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import type { QuarantineOverview, QuarantineOverviewItem } from '@shared/types/domain';
import { QUARANTINE_WARN_BYTES } from '@shared/utils/quarantine-policy';
import { ConfirmDialog } from './ConfirmDialog';
import { safeUiText } from '../utils/ui-error';
import { PROJECT_QUARANTINE_SECTION_ID } from './quarantine-anchors';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));

function kindLabel(item: QuarantineOverviewItem): string {
  if (item.kind !== 'outdated-source') return 'Tệp lỗi khi kiểm tra';
  return item.replacedAt ? 'Bản cũ — đã có bản mới thay' : 'Bản cũ — đang chờ bản mới';
}

/**
 * Mục 5 (2026-10-02): xem toàn bộ khu cách ly của danh sách (<ổ>:\Tubmedia\quarantine) — tổng dung lượng, từng
 * tệp, ngày — và "Xóa các bản cũ đã chọn". Tubmedia không có cơ chế tự xóa nào ở đây.
 */
export function ProjectQuarantinePanel(): React.JSX.Element {
  const [overview, setOverview] = useState<QuarantineOverview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const next = await window.desktop.quarantine.overview();
      setOverview(next);
      setSelected((current) => new Set([...current].filter((id) => next.items.some((item) => item.id === id))));
    } catch (loadError) {
      setError(safeUiText(loadError, 'Không đọc được khu cách ly.'));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const items = overview?.items ?? [];
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const selectedBytes = selectedItems.reduce((sum, item) => sum + (item.exists ? item.bytes : 0), 0);

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const results = await window.desktop.quarantine.deleteItems(selectedItems.map((item) => item.id));
      const deleted = results.filter((result) => result.ok).length;
      const failed = results.filter((result) => !result.ok);
      setMessage(
        `Đã xóa ${deleted} tệp khỏi khu cách ly.` +
          (failed.length ? ` ${failed.length} tệp không xóa được: ${failed.map((item) => item.message).join('; ')}` : '')
      );
      setSelected(new Set());
      await load();
    } catch (deleteError) {
      setError(safeUiText(deleteError, 'Không xóa được các tệp đã chọn.'));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <section className="card system-cleanup-panel mt-5" id={PROJECT_QUARANTINE_SECTION_ID} data-testid="project-quarantine-panel">
      <div className="system-cleanup-heading">
        <div>
          <span className="system-cleanup-eyebrow">KHU CÁCH LY CỦA DANH SÁCH</span>
          <h2>Bản cũ và tệp lỗi đang được giữ</h2>
          <p>
            Nằm trên cùng ổ với tệp gốc, tại &lt;ổ&gt;:\Tubmedia\quarantine\&lt;tên danh sách (mã)&gt;. Tubmedia không bao giờ
            tự xóa ở đây; chỉ cảnh báo khi tổng dung lượng vượt {formatBytes(QUARANTINE_WARN_BYTES)} hoặc ổ còn dưới 10% trống.
          </p>
        </div>
        <button type="button" className="system-cleanup-button secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} /> Tải lại
        </button>
      </div>

      <p className="mt-3 text-sm">
        <b>Tổng:</b> {formatBytes(overview?.totalBytes ?? 0)} • {items.length} tệp
        {overview?.drives.map((drive) => (
          <span key={drive.root}>
            {' '}
            • Ổ {drive.root}: {formatBytes(drive.quarantineBytes)}
            {drive.freeBytes !== null ? ` (ổ còn trống ${formatBytes(drive.freeBytes)})` : ''}
          </span>
        ))}
      </p>

      {overview?.warnings.map((warning) => (
        <p key={warning} className="storage-attention-notice tone-warning mt-2 flex items-start gap-2 text-sm" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {warning}
        </p>
      ))}

      {!!overview?.legacyFolders.length && (
        <div className="system-cleanup-quarantine">
          <div className="system-cleanup-group-title">Thư mục cách ly cũ (Tubmedia không di chuyển, không xóa)</div>
          <ul className="system-cleanup-quarantine-list">
            {overview.legacyFolders.map((folder) => (
              <li key={folder.path}>
                <span>
                  <b title={folder.path}>{folder.path}</b>
                  <small>
                    {folder.files} tệp • {formatBytes(folder.bytes)}
                  </small>
                </span>
                <button type="button" className="system-cleanup-button secondary" onClick={() => void window.desktop.app.showPath(folder.path)}>
                  <FolderOpen size={14} /> Mở thư mục
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <p className="cleanup-action-note">Khu cách ly đang trống.</p>
      ) : (
        <div className="system-cleanup-quarantine">
          <ul className="system-cleanup-quarantine-list">
            {items.map((item) => (
              <li key={item.id}>
                <label>
                  <input type="checkbox" checked={selected.has(item.id)} disabled={busy} onChange={() => toggle(item.id)} />
                  <span>
                    <b title={item.originalPath}>{fileName(item.originalPath)}</b>
                    <small>
                      {item.projectName ?? 'Danh sách đã xóa'} • {kindLabel(item)} •{' '}
                      {new Date(item.createdAt).toLocaleString('vi-VN')} • {formatBytes(item.bytes)}
                      {item.exists ? '' : ' • không còn trên ổ'}
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  className="system-cleanup-button secondary"
                  onClick={() => void window.desktop.app.showPath(folderOf(item.quarantinePath))}
                >
                  <FolderOpen size={14} /> Mở thư mục
                </button>
              </li>
            ))}
          </ul>
          <div className="system-cleanup-quarantine-actions">
            <button
              type="button"
              className="system-cleanup-button secondary"
              disabled={busy}
              onClick={() =>
                setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))
              }
            >
              {selected.size === items.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
            <button
              type="button"
              className="system-cleanup-button danger"
              disabled={busy || selected.size === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 size={14} /> Xóa các bản cũ đã chọn ({selected.size})
            </button>
          </div>
        </div>
      )}

      {message && <p className="cleanup-action-note">{message}</p>}
      {error && <p className="cleanup-action-note" role="alert">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title="Xóa vĩnh viễn các tệp đã chọn?"
        message={`Tubmedia sẽ xóa vĩnh viễn ${selectedItems.length} tệp (${formatBytes(selectedBytes)}) khỏi khu cách ly. Không thể hoàn tác.`}
        details={selectedItems.slice(0, 20).map((item) => `${fileName(item.originalPath)} — ${formatBytes(item.bytes)}`)}
        confirmLabel={`Xóa ${formatBytes(selectedBytes)}`}
        danger
        busy={busy}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
