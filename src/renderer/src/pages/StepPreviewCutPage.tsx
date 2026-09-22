import { useEffect, useState } from 'react';
import { FolderOpen, ImagePlay, Scissors } from 'lucide-react';
import type { QuickDownloadStatus } from '@shared/quick-download';
import { StepTabs } from '../components/StepTabs';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useAppStore } from '../stores/app-store';

/** Bước ② Xem trước & Cắt — hành trình một video (điều hướng 3 bước, đặc tả GĐ 2a).
 * Tải nhanh (bước ①) chưa có lịch sử nhiều tệp qua IPC, nên trang này cho thấy TRUNG THỰC kết quả tải
 * gần nhất (nếu đã xong) và trỏ sang Ghép theo Timeline — nơi đã có đủ công cụ cắt/chuẩn hóa thật —
 * thay vì dựng một bộ cắt video giả không hoạt động. */
export function StepPreviewCutPage(): React.JSX.Element {
  const setPage = useAppStore((state) => state.setPage);
  const [latest, setLatest] = useState<QuickDownloadStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.desktop.quickDownload
      .current()
      .then((current) => {
        if (mounted) setLatest(current);
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const ready = latest?.phase === 'completed' && Boolean(latest.outputPath);

  return <div className="page-shell step-preview-cut-page">
    <div className="tm-step-heading">
      <div>
        <h1>Xem trước & Cắt</h1>
        <p>Xem lại video vừa tải và cắt đoạn cần dùng trước khi ghép.</p>
      </div>
      <StepTabs current="step-preview-cut"/>
    </div>

    <Card icon={ImagePlay} title="Video vừa tải" subtitle="Kết quả gần nhất từ bước ① Tải">
      {!loaded ? null : ready && latest ? (
        <div className="step-preview-ready">
          <div>
            <b>{latest.title || 'Video đã tải'}</b>
            <small>{latest.outputPath}</small>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void window.desktop.quickDownload.revealOutput(latest.taskId)}
          >
            <FolderOpen size={15}/>
            Mở vị trí file
          </button>
        </div>
      ) : (
        <EmptyState
          icon={ImagePlay}
          title="Chưa có video nào tải xong"
          description="Sang bước ① Tải để tải một video, rồi quay lại đây để xem trước và cắt."
          action={<button type="button" className="btn btn-primary" onClick={() => setPage('step-download')}>Đi tới bước ① Tải</button>}
        />
      )}
    </Card>

    <Card icon={Scissors} title="Công cụ cắt và chuẩn hóa" subtitle="Cắt đoạn, đổi tỉ lệ và chuẩn hóa nhiều tệp cùng lúc">
      <EmptyState
        icon={Scissors}
        title="Dùng Ghép theo Timeline để cắt"
        description="Bộ cắt/chuẩn hóa đầy đủ (nhiều đoạn, xem trước khung hình, Smart Merge) nằm ở trang Ghép theo Timeline trong nhóm VIỆC CHÍNH. Trang này sẽ có bộ cắt riêng, đơn giản hơn, ở một giai đoạn sau."
        action={<button type="button" className="btn" onClick={() => setPage('download-merge')}>Mở Ghép theo Timeline</button>}
      />
    </Card>
  </div>;
}
