import {
  Activity,
  CircleAlert,
  Film,
  FolderClock,
  Gauge,
  ListVideo,
  ShieldCheck,
  Sparkles,
  Wrench
} from 'lucide-react';
import { WorkflowCard } from '../components/WorkflowCard';
import { useAppStore } from '../stores/app-store';

const ACTIVE = new Set([
  'pending',
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying'
]);

const FAILED = new Set(['failed', 'interrupted']);

function bytes(value: number | undefined): string {
  const safe = Math.max(0, value ?? 0);
  if (safe < 1024 ** 2) return `${Math.round(safe / 1024)} KB`;
  if (safe < 1024 ** 3) return `${(safe / 1024 ** 2).toFixed(1)} MB`;
  return `${(safe / 1024 ** 3).toFixed(1)} GB`;
}

export function EditorHomePage(): React.JSX.Element {
  const jobs = useAppStore((state) => state.jobs);
  const projects = useAppStore((state) => state.projects);
  const tools = useAppStore((state) => state.tools);
  const stats = useAppStore((state) => state.stats);
  const setPage = useAppStore((state) => state.setPage);

  const activeJobs = jobs.filter((job) => ACTIVE.has(job.status)).length;
  const failedJobs = jobs.filter((job) => FAILED.has(job.status)).length;
  const completedJobs = jobs.filter((job) => job.status === 'completed').length;
  const readyTools = tools.filter((tool) => tool.available).length;
  const requiredReady = ['yt-dlp', 'ffmpeg', 'ffprobe'].every(
    (name) => tools.find((tool) => tool.name === name)?.available
  );
  const disk = stats?.disks[0];

  return (
    <div className="page-shell editor-home-page">
      <section className="editor-hero">
        <div className="editor-hero-copy">
          <span className="editor-kicker">TUBMEDIA EDITOR STUDIO 1.3</span>
          <h1>Tải, kiểm tra và chuẩn bị video trong một quy trình rõ ràng</h1>
          <p>
            Bắt đầu từ một video, nhiều liên kết hoặc một quy trình tải–ghép. Hàng đợi, công cụ,
            lịch sử và chẩn đoán đều dùng dữ liệu thật của ứng dụng.
          </p>
          <div className="editor-hero-actions">
            <button className="btn btn-primary" onClick={() => setPage('download-workbench')}>
              <ListVideo size={18} /> Mở khu tải xuống
            </button>
            <button className="btn" onClick={() => setPage('download-merge')}>
              <Sparkles size={18} /> Tạo quy trình tải &amp; ghép
            </button>
          </div>
        </div>
        <div className="editor-readiness-card">
          <div className="editor-readiness-title">
            {requiredReady ? <ShieldCheck size={22} /> : <CircleAlert size={22} />}
            <div><b>{requiredReady ? 'Hệ thống sẵn sàng' : 'Cần kiểm tra công cụ'}</b><span>{readyTools}/{tools.length} công cụ khả dụng</span></div>
          </div>
          <dl>
            <div><dt>Công việc đang chạy</dt><dd>{activeJobs}</dd></div>
            <div><dt>Đã hoàn tất</dt><dd>{completedJobs}</dd></div>
            <div><dt>Cần xử lý</dt><dd>{failedJobs}</dd></div>
            <div><dt>Ổ đĩa còn trống</dt><dd>{disk ? bytes(disk.freeBytes) : '—'}</dd></div>
          </dl>
        </div>
      </section>

      <section className="editor-stat-strip" aria-label="Tổng quan ứng dụng">
        <div><Activity size={18} /><span>Hàng đợi</span><b>{jobs.length} tác vụ</b></div>
        <div><FolderClock size={18} /><span>Dự án</span><b>{projects.length} khu vực</b></div>
        <div><Gauge size={18} /><span>Bộ xử lý</span><b>{Math.round(stats?.cpuPercent ?? 0)}%</b></div>
        <div><Wrench size={18} /><span>Công cụ</span><b>{readyTools}/{tools.length}</b></div>
      </section>

      <section className="editor-workflow-grid">
        <WorkflowCard
          icon={ListVideo}
          eyebrow="NGUỒN VIDEO"
          title="Tải xuống"
          description="Tải nhanh một video hoặc quản lý tối đa bốn danh sách độc lập với kiểm tra công cụ tự động."
          meta="URL · TXT/CSV · kéo thả"
          actionLabel="Mở tải xuống"
          tone="primary"
          onOpen={() => setPage('download-workbench')}
        />
        <WorkflowCard
          icon={Film}
          eyebrow="WORKFLOW EDITOR"
          title="Tải & Ghép"
          description="Sắp xếp nguồn, cắt theo mốc, phân tích tương thích và dùng Smart Merge để tránh mã hóa không cần thiết."
          meta="Cắt · chuẩn hóa · ghép"
          actionLabel="Mở workflow"
          tone="good"
          onOpen={() => setPage('download-merge')}
        />
        <WorkflowCard
          icon={Activity}
          eyebrow="ĐIỀU PHỐI"
          title="Hàng đợi"
          description="Tìm kiếm, lọc, chọn nhiều và điều khiển toàn bộ tác vụ tải, cắt, chuẩn hóa và ghép."
          meta={`${activeJobs} đang chạy · ${failedJobs} cần xử lý`}
          actionLabel="Mở hàng đợi"
          tone={failedJobs > 0 ? 'warning' : 'neutral'}
          onOpen={() => setPage('activity')}
        />
        <WorkflowCard
          icon={FolderClock}
          eyebrow="KẾT QUẢ"
          title="Lịch sử"
          description="Tra cứu kết quả đã hoàn tất, bị hủy hoặc lỗi và xuất danh sách nguồn thành CSV/JSON."
          meta={`${completedJobs} tác vụ hoàn tất`}
          actionLabel="Xem lịch sử"
          onOpen={() => setPage('history')}
        />
      </section>
    </div>
  );
}
