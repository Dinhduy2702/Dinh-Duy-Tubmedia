import { Download, FolderOpen, RefreshCcw, Trash2 } from 'lucide-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import type { LogEntry, Project } from '@shared/types/domain';
import { StatusBadge } from '../components/StatusBadge';
import { CompactDetail } from '../components/CompactDetail';
import { useAppStore } from '../stores/app-store';
import { createUiEventId } from '../utils/ui-id';
import { moduleLabel } from '../utils/vi-labels';

function shouldDiscloseMessage(message: string): boolean {
  return message.length > 72 || /[\\/].{32,}/.test(message);
}

function projectLabel(project: Project): string {
  const match = project.code?.match(/^__WORKBENCH_DOWNLOAD_(\d)__$/);
  if (match) return `Danh sách tải ${match[1]} · ${project.name}`;
  const mergeMatch = project.code?.match(/^__WORKBENCH_MERGE_(\d)__$/);
  if (mergeMatch) return `Quy trình tải và ghép ${mergeMatch[1]} · ${project.name}`;
  if (project.code === '__WORKBENCH_DOWNLOAD_MERGE__') return `Quy trình tải và ghép 1 · ${project.name}`;
  return project.name;
}

export function LogsPage(): React.JSX.Element {
  const storeLogs = useAppStore((state) => state.logs);
  const projects = useAppStore((state) => state.projects);
  const [logs, setLogs] = useState<LogEntry[]>(storeLogs);
  const [projectId, setProjectId] = useState('all');
  const [level, setLevel] = useState('all');
  const [module, setModule] = useState('');
  const [loading, setLoading] = useState(false);
  const setAttention = useAppStore((state) => state.setAttention);
  const clearProjectLogs = useAppStore((state) => state.clearProjectLogs);

  const orderedProjects = useMemo(
    () => [...projects].sort((a, b) => projectLabel(a).localeCompare(projectLabel(b), 'vi')),
    [projects]
  );

  const effectiveLogs = [...storeLogs, ...logs]
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const filtered = effectiveLogs.filter(
    (entry) =>
      (projectId === 'all' || entry.projectId === projectId) &&
      (level === 'all' || entry.level === level) &&
      (!module || entry.module.toLowerCase().includes(module.toLowerCase()))
  );

  const reload = async (nextProjectId = projectId): Promise<void> => {
    setLoading(true);
    try {
      const nextLogs = await window.desktop.logs.list({
        ...(nextProjectId !== 'all' ? { projectId: nextProjectId } : {}),
        limit: 2000
      });
      setLogs(nextLogs);
      if (nextProjectId === 'all') useAppStore.setState({ logs: nextLogs });
    } finally {
      setLoading(false);
    }
  };

  const changeProject = (value: string): void => {
    setProjectId(value);
    void reload(value);
  };

  const clearSelected = async (): Promise<void> => {
    setLoading(true);
    try {
      const target = projectId === 'all' ? undefined : projectId;
      const result = await window.desktop.logs.clear(target);
      if (target) clearProjectLogs(target); else useAppStore.setState({ logs: [] });
      setLogs([]);
      setAttention({ id: createUiEventId('logs-clear'), severity: 'info', title: target ? 'Đã xóa nhật ký khu vực đã chọn' : 'Đã xóa toàn bộ nhật ký', message: `Đã dọn ${result.removed} bản ghi. Tệp nhật ký đang mở cũng được làm mới an toàn.`, sticky: false });
    } finally {
      setLoading(false);
    }
  };


  return <div className="page-shell logs-page">
    <div className="page-heading">
      <div>
        <h1 className="text-2xl font-black">Nhật ký vận hành</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Mỗi danh sách có bộ lọc và tệp nhật ký riêng. Màn hình này không trộn nhật ký khi bạn chọn một danh sách cụ thể.
        </p>
      </div>
    </div>

    <div className="page-action-toolbar logs-action-toolbar" aria-label="Công cụ nhật ký">
      <div className="page-action-group">
        <button className="btn" onClick={() => void window.desktop.logs.openFolder()}><FolderOpen size={17}/>Mở thư mục nhật ký</button>
        <button className="btn" onClick={() => void window.desktop.logs.exportDiagnostics()}><Download size={17}/>Gói chẩn đoán</button>
        <button className="btn" disabled={loading} onClick={() => void reload()}><RefreshCcw size={17}/>{loading ? 'Đang tải...' : 'Làm mới'}</button>
      </div>
      <div className="page-action-group page-action-danger">
        <button className="btn btn-danger" disabled={loading || effectiveLogs.length === 0} onClick={() => void clearSelected()}><Trash2 size={17}/>{projectId === 'all' ? 'Xóa toàn bộ nhật ký' : 'Xóa nhật ký đang chọn'}</button>
      </div>
    </div>

    <div className="logs-filter-grid mt-4 grid gap-3 xl:grid-cols-[minmax(260px,420px)_180px_minmax(220px,360px)]">
      <label><span className="label">Nguồn nhật ký</span><select className="select" value={projectId} onChange={(event: ChangeEvent<HTMLSelectElement>) => changeProject(event.target.value)}><option value="all">Tất cả ứng dụng</option>{orderedProjects.map((project) => <option key={project.id} value={project.id}>{projectLabel(project)}</option>)}</select></label>
      <label><span className="label">Mức</span><select className="select" value={level} onChange={(event: ChangeEvent<HTMLSelectElement>) => setLevel(event.target.value)}><option value="all">Tất cả mức</option><option value="debug">Gỡ lỗi</option><option value="info">Thông tin</option><option value="warn">Cảnh báo</option><option value="error">Lỗi</option></select></label>
      <label><span className="label">Thành phần</span><input className="input" value={module} onChange={(event: ChangeEvent<HTMLInputElement>) => setModule(event.target.value)} placeholder="Ví dụ: tải xuống, hàng đợi, tiến trình"/></label>
    </div>

    <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--muted)' }}>
      Đang hiển thị <b style={{ color: 'var(--text)' }}>{filtered.length}</b> sự kiện. Tệp nhật ký theo danh sách nằm trong thư mục <code>logs\projects</code>; cookies, mã truy cập và thông tin xác thực được che trước khi ghi.
    </div>

    <div className="card logs-table scroll mt-4 max-h-[calc(100vh-270px)] overflow-auto">
      <table className="table logs-data-table">
        <colgroup>
          <col className="logs-col-time"/>
          <col className="logs-col-level"/>
          <col className="logs-col-module"/>
          <col className="logs-col-code"/>
          <col className="logs-col-message"/>
          <col className="logs-col-job"/>
        </colgroup>
        <thead><tr><th>Thời gian</th><th>Mức</th><th>Thành phần</th><th>Mã sự kiện</th><th>Nội dung</th><th>Tác vụ</th></tr></thead>
        <tbody>
          {filtered.map((entry) => <tr key={entry.id}>
            <td className="logs-time-cell">{new Date(entry.timestamp).toLocaleString('vi-VN')}</td>
            <td className="logs-level-cell"><StatusBadge status={entry.level} fixed/></td>
            <td className="logs-module-cell" title={moduleLabel(entry.module)}>{moduleLabel(entry.module)}</td>
            <td className="logs-code-cell" title={entry.eventCode}>{entry.eventCode}</td>
            <td className="logs-message-cell">
              <div className="logs-message-compact">
                <span>{entry.message}</span>
                {shouldDiscloseMessage(entry.message) && <CompactDetail
                  label="Nội dung đầy đủ của nhật ký"
                  tone={entry.level === 'error' ? 'danger' : entry.level === 'warn' ? 'warning' : 'info'}
                >
                  <p>{entry.message}</p>
                  <dl>
                    <div><dt>Thời gian</dt><dd>{new Date(entry.timestamp).toLocaleString('vi-VN')}</dd></div>
                    <div><dt>Thành phần</dt><dd>{moduleLabel(entry.module)}</dd></div>
                    <div><dt>Mã sự kiện</dt><dd>{entry.eventCode}</dd></div>
                    {entry.jobId && <div><dt>Mã tác vụ</dt><dd>{entry.jobId}</dd></div>}
                  </dl>
                </CompactDetail>}
              </div>
            </td>
            <td className="logs-job-cell" title={entry.jobId ?? undefined}>{entry.jobId ?? '—'}</td>
          </tr>)}
          {filtered.length === 0 && <tr><td colSpan={6} className="py-10 text-center" style={{ color: 'var(--muted)' }}>Chưa có nhật ký phù hợp bộ lọc.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
