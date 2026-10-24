import { useState } from 'react';
import type { AppUpdateActiveWork } from '@shared/types/domain';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppStore } from '../stores/app-store';

/** Các dòng liệt kê việc đang chạy cho hộp hỏi lại. */
export function activeWorkLines(work: AppUpdateActiveWork): string[] {
  const lines: string[] = [];
  if (work.queueJobs > 0) lines.push(`${work.queueJobs} tác vụ tải, cắt hoặc ghép đang chạy`);
  if (work.quickDownload) lines.push('Tải nhanh đang chạy');
  if (work.otherProcesses > 0) lines.push(`${work.otherProcesses} tiến trình công cụ (yt-dlp, FFmpeg…) còn đang chạy`);
  return lines;
}

/**
 * 2026-10-24 (người dùng duyệt): MỘT luồng "Cài đặt & khởi động lại" dùng chung cho nút ở trang Cập nhật và nút trong thông
 * báo — trước đây nút trong thông báo chỉ mở trang Cập nhật. Đang có việc chạy thì hỏi lại, để người dùng tự quyết: Tubmedia
 * không tự hủy tác vụ, cũng không tự hoãn khởi động lại. Không có việc chạy thì cài và khởi động lại ngay.
 */
export function useInstallUpdate(): { start: () => Promise<void>; busy: boolean; dialog: React.JSX.Element } {
  const setError = useAppStore((state) => state.setError);
  const [busy, setBusy] = useState(false);
  const [pendingWork, setPendingWork] = useState<AppUpdateActiveWork | null>(null);
  const [confirming, setConfirming] = useState(false);

  const install = async (allowActiveWork: boolean): Promise<void> => {
    // Thành công thì app đóng để cài — không cần trả trạng thái nút về.
    await window.desktop.updates.install(allowActiveWork ? { allowActiveWork: true } : undefined);
  };

  const start = async (): Promise<void> => {
    if (busy || confirming) return;
    setBusy(true);
    try {
      const work = await window.desktop.updates.activeWork();
      if (activeWorkLines(work).length > 0) {
        setPendingWork(work);
        setBusy(false);
        return;
      }
      await install(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setConfirming(true);
    try {
      await install(true);
    } catch (error) {
      setPendingWork(null);
      setConfirming(false);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const dialog = (
    <ConfirmDialog
      open={pendingWork !== null}
      title="Đang có việc chạy — khởi động lại ngay?"
      message="Khởi động lại để cài bản mới sẽ dừng các việc đang chạy. Phần đang làm dở có thể phải làm lại. Tubmedia không hủy tác vụ: chúng được giữ ở trạng thái dở dang để bạn tiếp tục sau khi app mở lại."
      details={pendingWork ? activeWorkLines(pendingWork) : []}
      confirmLabel="Vẫn khởi động lại"
      cancelLabel="Để sau"
      danger
      busy={confirming}
      onConfirm={() => void confirm()}
      onCancel={() => setPendingWork(null)}
    />
  );

  return { start, busy: busy || confirming, dialog };
}
