import { FileArchive, FolderOpen, LoaderCircle, X } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import type { ErrorReportStatus } from '@shared/types/error-report';
import { useAppStore } from '../stores/app-store';

/*
 * Lượt xuất báo cáo chạy nền ở tiến trình chính (giải mã lại mọi nguồn có thể mất vài phút). Trạng thái giữ ở cấp mô-đun
 * để rời trang Lịch sử rồi quay lại vẫn thấy tiến độ, không bấm trùng.
 */
let current: ErrorReportStatus | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function publish(next: ErrorReportStatus | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function poll(): void {
  if (timer || current?.state !== 'running') return;
  timer = setTimeout(() => {
    timer = null;
    const runId = current?.runId;
    if (!runId) return;
    void window.desktop.errorReport
      .status(runId)
      .then((next) => {
        if (current?.runId === runId) publish(next);
        poll();
      })
      .catch(() => poll());
  }, 500);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ErrorReportButton({ jobId }: { jobId: string }): React.JSX.Element {
  const status = useSyncExternalStore(subscribe, () => current);
  const setError = useAppStore((state) => state.setError);
  const mine = status?.jobId === jobId ? status : null;
  const otherRunning = status?.state === 'running' && !mine;

  useEffect(() => poll(), [status]);

  const start = async (): Promise<void> => {
    try {
      const started = await window.desktop.errorReport.start(jobId);
      if (started) publish(started);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  if (mine?.state === 'running') {
    return (
      <span className="history-error-report" data-error-report="running">
        <LoaderCircle className="animate-spin" size={13} />
        <span title={mine.step}>{mine.total > 0 ? `Đang kiểm tệp ${Math.min(mine.current + 1, mine.total)}/${mine.total}` : mine.step}</span>
        <button className="btn btn-small btn-ghost" onClick={() => void window.desktop.errorReport.cancel(mine.runId).then(publish)}>
          <X size={13} />
          Hủy
        </button>
      </span>
    );
  }

  return (
    <span className="history-error-report" data-error-report={mine?.state ?? 'idle'}>
      <button
        className="btn btn-small"
        disabled={otherRunning}
        title={
          otherRunning
            ? 'Đang tạo một báo cáo lỗi khác — chờ xong hoặc hủy trước.'
            : 'Gói nhật ký, thông tin công cụ và kết quả giải mã lại từng video nguồn (kèm SHA256) vào một tệp .zip để gửi cho hỗ trợ.'
        }
        onClick={() => void start()}
      >
        <FileArchive size={13} />
        Xuất báo cáo lỗi
      </button>
      {mine?.state === 'completed' && (
        <button className="btn btn-small btn-ghost" onClick={() => void window.desktop.errorReport.reveal(mine.runId)}>
          <FolderOpen size={13} />
          Mở thư mục
        </button>
      )}
      {mine?.state === 'failed' && <span className="history-error-report-note" title={mine.error ?? ''}>Không tạo được: {mine.error}</span>}
      {mine?.state === 'cancelled' && <span className="history-error-report-note">Đã hủy</span>}
    </span>
  );
}
