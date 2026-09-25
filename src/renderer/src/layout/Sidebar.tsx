import {
  Activity,
  Download,
  FileClock,
  Gauge,
  HardDrive,
  History,
  Info,
  ListFilter,
  RefreshCcw,
  Scissors,
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
  icon: typeof Download;
  /** Có mặt ở 3 mục "Tải 1 video/Xem trước & Cắt/Ghép & Xuất": đánh dấu icon của mục này hiển thị trong
   * vòng tròn bước riêng thay vì icon trần như các mục khác (đặc tả GĐ 2a; B4 2026-09-24 đổi nội dung
   * vòng tròn từ số trần 1/2/3 sang icon đúng chức năng từng bước — vẫn giữ nguyên vòng tròn/màu/chuyển
   * động cũ). Giá trị số chỉ còn dùng để SẮP THỨ TỰ hiển thị, không còn hiển thị ra giao diện. */
  step?: number;
}

// Việc CHÍNH thật sự dùng hàng ngày là tải một DANH SÁCH nhiều video rồi GHÉP đúng thứ tự thành 1 file
// (2 trang cũ, logic không đổi — chỉ đổi vị trí/nhãn cho đúng vai trò). "Tải 1 video" (hành trình 3 bước
// Tải → Xem trước & Cắt → Ghép & Xuất) chỉ là tiện ích phụ, tải nhanh một video đơn — xem TIEN_DO.md phần
// "Điều chỉnh thứ tự thanh bên" (2026-09-22).
const groups: Array<{ label: string; items: SidebarItem[] }> = [
  {
    label: 'VIỆC CHÍNH',
    items: [
      {
        id: 'download-workbench',
        label: 'Tải danh sách',
        hint: 'Nhiều video, nhiều danh sách chạy song song',
        icon: Download
      },
      {
        id: 'download-merge',
        label: 'Ghép theo Timeline',
        hint: 'Ghép đúng thứ tự thành 1 file, tối đa 6 quy trình',
        icon: Sparkles
      },
      { id: 'activity', label: 'Hàng đợi', hint: 'Điều khiển mọi tác vụ', icon: Activity },
      { id: 'history', label: 'Lịch sử', hint: 'Tra cứu và xuất CSV/JSON', icon: History }
    ]
  },
  {
    label: 'CÔNG CỤ',
    items: [
      {
        id: 'step-download',
        label: 'Tải 1 video',
        // A2 mục 4 (2026-09-25): làm rõ quan hệ với "Tải danh sách" ở nhóm VIỆC CHÍNH — người dùng mới dễ
        // nhầm hai lối vào tưởng như trùng việc. Không đổi kiến trúc/không gộp trang, chỉ thêm gợi ý.
        hint: 'Chỉ 1 video — cần nhiều video cùng lúc thì dùng Tải danh sách ở trên',
        icon: Download,
        step: 1
      },
      { id: 'step-preview-cut', label: 'Xem trước & Cắt', hint: 'Xem và cắt đoạn đã tải', icon: Scissors, step: 2 },
      { id: 'step-merge-export', label: 'Ghép & Xuất', hint: 'Ghép các đoạn và xuất thành phẩm', icon: Sparkles, step: 3 },
      {
        id: 'filter-by-links',
        label: 'Lọc video theo link',
        hint: 'Đối chiếu link với video đã tải',
        icon: ListFilter
      },
      { id: 'cleanup', label: 'Dọn dẹp máy', hint: 'Quét trước, xóa sau khi xác nhận', icon: HardDrive }
    ]
  },
  {
    label: 'HỆ THỐNG',
    items: [
      { id: 'settings', label: 'Cài đặt', hint: 'Workflow, hiệu năng và lưu trữ', icon: Settings },
      { id: 'updates', label: 'Cập nhật', hint: 'Phiên bản và kênh phát hành', icon: RefreshCcw },
      { id: 'tools', label: 'Công cụ', hint: 'yt-dlp · FFmpeg · aria2c', icon: Wrench },
      { id: 'diagnostics', label: 'Chẩn đoán', hint: 'Công cụ, tài nguyên và lỗi', icon: Gauge },
      { id: 'logs', label: 'Nhật ký', hint: 'Chi tiết kỹ thuật và sự kiện', icon: FileClock },
      { id: 'about', label: 'Giới thiệu', hint: 'Ứng dụng và nhà phát triển', icon: Info }
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
            {group.items.map(({ id, label, hint, icon: Icon, step }) => (
              <button
                key={id}
                data-page-id={id}
                onClick={() => setPage(id)}
                className={`sidebar-item ${page === id ? 'is-active' : ''}`}
                aria-current={page === id ? 'page' : undefined}
                title={`${label} — ${hint}`}
              >
                <span className="sidebar-item-icon">
                  {step ? (
                    <span className="sidebar-step-badge" aria-hidden="true">
                      <Icon size={12} />
                    </span>
                  ) : (
                    <Icon size={18} />
                  )}
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
        <DeveloperSignature intro />
      </div>
    </aside>
  );
}
