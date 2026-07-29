import {
  Activity,
  FileClock,
  Info,
  ListVideo,
  RefreshCcw,
  Settings,
  WandSparkles,
  Wrench
} from 'lucide-react';
import { APP_VERSION_LABEL } from '@shared/constants/app';
import { DeveloperSignature, TubmediaWordmark } from '../components/TubmediaBrand';
import { useAppStore, type PageId } from '../stores/app-store';

const items: Array<{ id: PageId; label: string; hint: string; icon: typeof ListVideo }> = [
  { id: 'download-workbench', label: 'Tải nhiều danh sách', hint: '1–4 danh sách độc lập', icon: ListVideo },
  { id: 'download-merge', label: 'Tải và Ghép', hint: 'Quy trình ghép chất lượng cao', icon: WandSparkles },
  { id: 'activity', label: 'Tiến trình', hint: 'Theo dõi và dọn lịch sử', icon: Activity },
  { id: 'tools', label: 'Trung tâm công cụ', hint: 'yt-dlp · FFmpeg · aria2c', icon: Wrench },
  { id: 'updates', label: 'Cập nhật', hint: 'Phiên bản mới và kênh phát hành', icon: RefreshCcw },
  { id: 'logs', label: 'Nhật ký', hint: 'Chẩn đoán theo khu vực', icon: FileClock },
  { id: 'settings', label: 'Cài đặt', hint: 'Giao diện và hiệu năng', icon: Settings },
  { id: 'about', label: 'Thông tin', hint: 'Ứng dụng và nhà phát triển', icon: Info }
];

export function Sidebar(): React.JSX.Element {
  const page = useAppStore((state) => state.page);
  const setPage = useAppStore((state) => state.setPage);

  return <aside className="app-sidebar">
    <div className="sidebar-brand">
      <TubmediaWordmark/>
      <span className="sidebar-version">{APP_VERSION_LABEL}</span>
    </div>

    <nav className="sidebar-nav scroll" aria-label="Điều hướng chính">
      {items.map(({ id, label, hint, icon: Icon }) => <button
        key={id}
        onClick={() => setPage(id)}
        className={`sidebar-item ${page === id ? 'is-active' : ''}`}
        aria-current={page === id ? 'page' : undefined}
        title={`${label} — ${hint}`}
      >
        <span className="sidebar-item-icon"><Icon size={19}/></span>
        <span className="sidebar-item-copy"><b>{label}</b></span>
      </button>)}
    </nav>

    <div className="sidebar-footer">
      <DeveloperSignature/>
    </div>
  </aside>;
}
