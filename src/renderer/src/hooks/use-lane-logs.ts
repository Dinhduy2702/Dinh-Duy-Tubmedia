import { useEffect, useMemo, useState } from 'react';
import type { LogEntry } from '@shared/types/domain';

/**
 * Khám phá #12 (bản cài 1.5.0, 2026-10-05): "Nhật ký riêng" của một danh sách tải / quy trình ghép.
 * Đọc lịch sử của danh sách từ CSDL NGAY khi thẻ hiện ra (trước đây chỉ khi mở khung → số "N sự kiện" lúc đóng sai, thường
 * là 0) và đọc lại khi `reloadKey` đổi (sau khi xóa nhật ký — trước đây dòng cũ đã đọc vẫn nằm trong khung). Gộp với dòng
 * mới phát sinh trong phiên (`liveLogs`), mới nhất trước.
 */
export function useLaneLogs(
  projectId: string | undefined,
  liveLogs: readonly LogEntry[],
  reloadKey: number,
  onError: (message: string) => void
): LogEntry[] {
  const [persisted, setPersisted] = useState<LogEntry[]>([]);

  useEffect(() => {
    setPersisted([]);
    if (!projectId) return;
    let cancelled = false;
    void window.desktop.logs
      .list({ projectId, limit: 500 })
      .then((entries) => {
        if (!cancelled) setPersisted(entries);
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
    // onError là hàm báo lỗi của trang — không cần đọc lại khi nó đổi tham chiếu.
  }, [projectId, reloadKey]);

  return useMemo(() => {
    const byId = new Map<string, LogEntry>();
    for (const entry of [...liveLogs, ...persisted]) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [liveLogs, persisted]);
}
