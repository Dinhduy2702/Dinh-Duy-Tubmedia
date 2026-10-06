import { useEffect, useState } from 'react';
import { FolderOpen, Info, X } from 'lucide-react';
import type { QuarantineEntry } from '@shared/system-cleanup';
import type { QuarantineOverview } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { CLEANUP_QUARANTINE_SECTION_ID, PROJECT_QUARANTINE_SECTION_ID } from './quarantine-anchors';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

function timeLeft(expiresAt: string): string {
  const hours = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
  return hours >= 24 ? `còn ${Math.ceil(hours / 24)} ngày` : `còn ${hours} giờ`;
}

/**
 * Mục 5 (2026-10-02) — nhắc nhẹ khi mở app, chỉ đọc, không tự làm gì:
 * - thư mục _quarantine cũ còn tệp → "Mở thư mục" (Tubmedia không di chuyển, không xóa);
 * - khu cách ly vượt 20 GB hoặc ổ còn dưới 10% trống → "Xem";
 * - mục trong khu cách ly của Dọn dẹp máy sẽ bị xóa vĩnh viễn trong 2 ngày tới → "Xem".
 */
export function StorageAttentionNotice(): React.JSX.Element | null {
  const setPage = useAppStore((state) => state.setPage);
  const [overview, setOverview] = useState<QuarantineOverview | null>(null);
  const [expiring, setExpiring] = useState<QuarantineEntry[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    void window.desktop.quarantine.overview().then(setOverview).catch(() => undefined);
    void window.desktop.systemCleanup.quarantineExpiring().then(setExpiring).catch(() => undefined);
  }, []);

  const legacy = overview?.legacyFolders ?? [];
  const warnings = overview?.warnings ?? [];
  if (hidden || (!legacy.length && !warnings.length && !expiring.length)) return null;

  const view = (sectionId: string): void => {
    setPage('cleanup');
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };
  const soonest = [...expiring].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];

  return (
    <aside className="storage-attention-notice tone-info" role="note" aria-label="Nhắc về khu cách ly">
      <div className="flex items-start gap-3">
        <Info size={20} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          {legacy.map((folder) => (
            <div key={folder.path} className="flex flex-wrap items-center gap-2">
              <span>
                Thư mục cách ly cũ còn {folder.files} tệp ({formatBytes(folder.bytes)}):{' '}
                <span className="font-mono text-xs">{folder.path}</span>. Tubmedia không di chuyển, không xóa thư mục này.
              </span>
              <button type="button" className="btn btn-small" onClick={() => void window.desktop.app.showPath(folder.path)}>
                <FolderOpen size={14} /> Mở thư mục
              </button>
            </div>
          ))}
          {warnings.map((warning) => (
            <div key={warning} className="flex flex-wrap items-center gap-2">
              <span>{warning}</span>
              <button type="button" className="btn btn-small" onClick={() => view(PROJECT_QUARANTINE_SECTION_ID)}>
                Xem
              </button>
            </div>
          ))}
          {soonest && (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {expiring.length} mục trong khu cách ly của Dọn dẹp máy sẽ bị xóa vĩnh viễn trong 2 ngày tới (sớm nhất{' '}
                {timeLeft(soonest.expiresAt)}). Có thể hoàn tác trước thời hạn.
              </span>
              <button type="button" className="btn btn-small" onClick={() => view(CLEANUP_QUARANTINE_SECTION_ID)}>
                Xem
              </button>
            </div>
          )}
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
