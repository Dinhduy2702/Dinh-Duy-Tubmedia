import { useEffect } from 'react';
import { useAppStore } from '../stores/app-store';

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
 * - khu cách ly vượt 20 GB hoặc ổ còn dưới 10% trống → "Xem khu cách ly";
 * - mục trong khu cách ly của Dọn dẹp máy sẽ bị xóa vĩnh viễn trong 2 ngày tới → "Xem khu cách ly".
 *
 * Phần A rà soát giao diện (người dùng duyệt 2026-10-06): KHÔNG còn banner đầu trang — các lời nhắc nằm trong chuông
 * thông báo. Id cố định nên mở app nhiều lần không nhân bản, và nội dung không đổi thì không đánh dấu chưa đọc lại.
 */
export function StorageAttentionNotice(): null {
  const addBellNotification = useAppStore((state) => state.addBellNotification);

  useEffect(() => {
    void window.desktop.quarantine
      .overview()
      .then((overview) => {
        for (const folder of overview.legacyFolders) {
          addBellNotification(
            {
              id: `quarantine-legacy:${folder.path.toLowerCase()}`,
              severity: 'info',
              title: `Thư mục cách ly cũ còn ${folder.files} tệp (${formatBytes(folder.bytes)})`,
              message: `${folder.path} — Tubmedia không di chuyển, không xóa thư mục này.`,
              code: 'QUARANTINE_LEGACY_FOLDER',
              sticky: false
            },
            folder.path
          );
        }
        overview.warnings.forEach((warning, index) => {
          addBellNotification({
            id: `quarantine-storage-warning:${index}`,
            severity: 'warning',
            title: 'Khu cách ly cần xem lại',
            message: warning,
            code: 'QUARANTINE_STORAGE_WARNING',
            sticky: false
          });
        });
      })
      .catch(() => undefined);
    void window.desktop.systemCleanup
      .quarantineExpiring()
      .then((expiring) => {
        const soonest = [...expiring].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
        if (!soonest) return;
        addBellNotification({
          id: 'cleanup-quarantine-expiring',
          severity: 'info',
          title: `${expiring.length} mục trong khu cách ly sắp bị xóa vĩnh viễn`,
          message: `Khu cách ly của Dọn dẹp máy sẽ xóa vĩnh viễn trong 2 ngày tới (sớm nhất ${timeLeft(soonest.expiresAt)}). Có thể hoàn tác trước thời hạn.`,
          code: 'CLEANUP_QUARANTINE_EXPIRING',
          sticky: false
        });
      })
      .catch(() => undefined);
  }, [addBellNotification]);

  return null;
}
