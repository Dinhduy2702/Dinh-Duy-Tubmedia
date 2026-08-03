import {
  Activity,
  Download,
  FileClock,
  Gauge,
  HardDrive,
  History,
  Home,
  Info,
  RefreshCcw,
  Settings,
  Sparkles,
  Wrench
} from 'lucide-react';
import { APP_VERSION_LABEL } from '@shared/constants/app';
import { DeveloperSignature, TubmediaWordmark } from '../components/TubmediaBrand';
import { useAppStore, type PageId } from '../stores/app-store';

interface SidebarItem {
  id: PageId;
  label: string;
  hint: string;
  icon: typeof Home;
}

const groups: Array<{ label: string; items: SidebarItem[] }> = [
  {
    label: 'EDITOR STUDIO',
    items: [
      { id: 'editor-home', label: 'Tổng quan', hint: 'Bắt đầu workflow và xem trạng thái', icon: Home },
      {
        id: 'download-workbench',
        label: 'Tải xuống',
        hint: 'Một video, nhiều URL và danh sách',
        icon: Download
      },
      { id: 'download-merge', label: 'Tải & Ghép', hint: 'Cắt, chuẩn hóa và Smart Merge', icon: Sparkles },
      { id: 'activity', label: 'Hàng đợi', hint: 'Điều khiển mọi tác vụ', icon: Activity },
      { id: 'history', label: 'Lịch sử', hint: 'Tra cứu và xuất CSV/JSON', icon: History }
    ]
  },
  {
    label: 'HỆ THỐNG',
    items: [
      { id: 'diagnostics', label: 'Chẩn đoán', hint: 'Công cụ, tài nguyên và lỗi', icon: Gauge },
      { id: 'tools', label: 'Công cụ', hint: 'yt-dlp · FFmpeg · aria2c', icon: Wrench },
      { id: 'updates', label: 'Cập nhật', hint: 'Phiên bản và kênh phát hành', icon: RefreshCcw },
      { id: 'logs', label: 'Nhật ký', hint: 'Chi tiết kỹ thuật và sự kiện', icon: FileClock },
      { id: 'settings', label: 'Cài đặt', hint: 'Workflow, hiệu năng và lưu trữ', icon: Settings }
    ]
  },
  {
    label: 'CÔNG CỤ NÂNG CAO',
    items: [
      { id: 'cleanup', label: 'Dọn dẹp máy', hint: 'Quét trước, xóa sau khi xác nhận', icon: HardDrive },
      { id: 'about', label: 'Thông tin', hint: 'Ứng dụng và nhà phát triển', icon: Info }
    ]
  }
];

export function Sidebar(): React.JSX.Element {
  const page = useAppStore((state) => state.page);
  const setPage = useAppStore((state) => state.setPage);
  const activeJobs = useAppStore(
    (state) =>
      state.jobs.filter((job) =>
        [
          'pending',
          'analyzing',
          'downloading',
          'verifying',
          'normalizing',
          'processing',
          'merging',
          'retrying'
        ].includes(job.status)
      ).length
  );

  return (
    <aside className="app-sidebar editor-sidebar">
      <button
        className="sidebar-brand editor-sidebar-brand"
        type="button"
        onClick={() => setPage('editor-home')}
        aria-label="Mở Tổng quan Editor"
      >
        <TubmediaWordmark />
        <span className="sidebar-version">{APP_VERSION_LABEL}</span>
      </button>

      <nav className="sidebar-nav scroll" aria-label="Điều hướng chính">
        {groups.map((group) => (
          <section className="sidebar-group" key={group.label}>
            <span className="sidebar-group-label">{group.label}</span>
            {group.items.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setPage(id)}
                className={`sidebar-item ${page === id ? 'is-active' : ''}`}
                aria-current={page === id ? 'page' : undefined}
                title={`${label} — ${hint}`}
              >
                <span className="sidebar-item-icon">
                  <Icon size={18} />
                </span>
                <span className="sidebar-item-copy">
                  <b>{label}</b>
                </span>
                {id === 'activity' && activeJobs > 0 && <span className="sidebar-count">{activeJobs}</span>}
              </button>
            ))}
          </section>
        ))}
      </nav>

      <div className="sidebar-footer">
        <DeveloperSignature />
      </div>
    </aside>
  );
}
