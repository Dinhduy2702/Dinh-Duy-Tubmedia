import { useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { useAppStore } from '../stores/app-store';
import { safeUiText } from '../utils/ui-error';

// Hỏi tiến trình chính ĐÚNG MỘT LẦN cho mỗi lần nạp renderer: React StrictMode gọi hiệu ứng hai lần, và
// lần gọi IPC thứ hai luôn trả về 0 (tiến trình chính chỉ trả số thật ở lần đầu mỗi lần mở app).
let startupPromptRequest: Promise<{ count: number }> | null = null;
function requestStartupPrompt(): Promise<{ count: number }> {
  startupPromptRequest ??= window.desktop.queue.startupPrompt().catch(() => ({ count: 0 }));
  return startupPromptRequest;
}

/**
 * Đợt 1 mục 2 (2026-10-02): khi mở app mà còn tác vụ chưa xong, KHÔNG tự chạy — hỏi "Tiếp tục / Để sau".
 * Đóng bằng Esc, nút X hoặc bấm ra ngoài đều tính là "Để sau" (tác vụ vẫn tạm dừng, có thể Tiếp tục sau).
 */
export function StartupResumeDialog(): React.JSX.Element | null {
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void requestStartupPrompt().then((result) => {
      if (active) setCount(result.count);
    });
    return () => {
      active = false;
    };
  }, []);

  const later = (): void => {
    if (!busy) setCount(0);
  };

  useEffect(() => {
    if (count === 0) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') later();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const resume = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.desktop.queue.resumeStartupHeld();
      await refreshJobs();
      setCount(0);
    } catch (resumeError) {
      setError(safeUiText(resumeError, 'Không thể tiếp tục các tác vụ. Hãy thử Tiếp tục ở từng danh sách.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={count > 0}
      title={`Có ${count} tác vụ chưa xong`}
      message={
        'Ứng dụng đã đóng khi các tác vụ này đang chạy hoặc đang chờ. Tubmedia chưa tự chạy lại để bạn kiểm ' +
        'tra trước. Chọn Tiếp tục để chạy lại ngay, hoặc Để sau — bạn vẫn có thể bấm Tiếp tục ở từng danh sách.'
      }
      details={error ? [error] : []}
      confirmLabel="Tiếp tục"
      cancelLabel="Để sau"
      busy={busy}
      onConfirm={() => void resume()}
      onCancel={later}
    />
  );
}
