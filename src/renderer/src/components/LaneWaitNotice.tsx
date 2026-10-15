import { Hourglass } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

/**
 * Lag bước 1 (2026-10-12): danh sách tải / quy trình ghép đang chờ lượt vì đã đủ số chạy cùng lúc. Mỗi danh sách đang chạy
 * vẫn dùng đủ luồng theo hồ sơ; danh sách này tự bắt đầu khi một danh sách khác xong.
 */
export function LaneWaitNotice({ projectId, kind }: { projectId: string | null | undefined; kind: 'download' | 'merge' }): React.JSX.Element | null {
  const waiting = useAppStore((state) => {
    const lanes = state.stats?.laneWaits;
    if (!lanes || !projectId) return null;
    const ids = kind === 'download' ? lanes.downloadLists : lanes.mergeWorkflows;
    return ids.includes(projectId) ? (kind === 'download' ? lanes.downloadListCap : lanes.mergeWorkflowCap) : null;
  });
  if (waiting === null) return null;
  const text =
    kind === 'download'
      ? `Đang chờ lượt — đã có ${waiting} danh sách tải chạy cùng lúc. Tự bắt đầu khi một danh sách xong.`
      : `Đang chờ lượt — đã có ${waiting} quy trình ghép chạy cùng lúc. Tự bắt đầu khi một quy trình xong.`;
  const where =
    kind === 'download'
      ? 'Đổi ở Cài đặt › "Số danh sách tải chạy cùng lúc".'
      : 'Đổi ở "Mức xử lý song song" trên trang Ghép theo Timeline.';
  return (
    <div className="lane-wait-notice" role="status" data-lane-wait={kind} title={`Mỗi danh sách đang chạy vẫn dùng đủ luồng theo hồ sơ phần cứng. ${where}`}>
      <Hourglass size={14} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
