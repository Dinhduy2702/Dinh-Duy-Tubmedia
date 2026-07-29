import { ExternalLink, HardDrive, ShieldAlert } from 'lucide-react';
import { SystemCleanupPanel } from '../components/SystemCleanupPanel';
import { useAppStore } from '../stores/app-store';

export function CachePage(): React.JSX.Element {
  const projects = useAppStore((state) => state.projects);

  return (
    <div className="page-shell">
      <header className="page-heading">
        <div>
          <h1>Bộ nhớ đệm nguồn</h1>
          <p>
            Mỗi nguồn được nhận diện theo nền tảng, bộ trích xuất và mã phương tiện để có thể dùng lại ở nhiều
            vị trí trong dòng thời gian.
          </p>
        </div>
      </header>

      <SystemCleanupPanel />

      <div className="mt-5 grid gap-3">
        {projects.map((project) => (
          <div className="card flex items-center gap-4 p-4" key={project.id}>
            <div className="rounded-xl p-2" style={{ background: 'var(--panel2)', color: 'var(--accent)' }}>
              <HardDrive size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-extrabold">{project.name}</div>
              <div className="mt-1 truncate font-mono text-xs" style={{ color: 'var(--muted)' }}>
                {project.sourceFolder}
              </div>
            </div>
            <button className="btn" onClick={() => void window.desktop.app.showPath(project.sourceFolder)}>
              <ExternalLink size={16} />
              Mở bộ nhớ đệm
            </button>
          </div>
        ))}

        {!projects.length && (
          <div className="card p-10 text-center" style={{ color: 'var(--muted)' }}>
            <ShieldAlert className="mx-auto mb-2" />
            Chưa có dự án hoặc dữ liệu đệm.
          </div>
        )}
      </div>
    </div>
  );
}
