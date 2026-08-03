import { Activity, CircleAlert, Cpu, HardDrive, RefreshCcw, ShieldCheck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../stores/app-store';

function bytes(value: number | undefined): string {
  const safe = Math.max(0, value ?? 0);
  if (safe < 1024 ** 3) return `${(safe / 1024 ** 2).toFixed(1)} MB`;
  return `${(safe / 1024 ** 3).toFixed(1)} GB`;
}

export function DiagnosticsPage(): React.JSX.Element {
  const tools = useAppStore((state) => state.tools);
  const stats = useAppStore((state) => state.stats);
  const hardware = useAppStore((state) => state.hardware);
  const logs = useAppStore((state) => state.logs);
  const refreshTools = useAppStore((state) => state.refreshTools);
  const pushLogs = useAppStore((state) => state.pushLogs);
  const setError = useAppStore((state) => state.setError);
  const setPage = useAppStore((state) => state.setPage);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const [, latestLogs] = await Promise.all([
        refreshTools(),
        window.desktop.logs.list({ limit: 200 })
      ]);
      pushLogs(latestLogs);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const unhealthy = tools.filter((tool) => !tool.available || tool.health === 'broken');
  const errors = logs.filter((entry) => entry.level === 'error').slice(0, 12);

  return (
    <div className="page-shell diagnostics-page">
      <div className="page-heading-row">
        <div><h1 className="text-2xl font-black">Chẩn đoán hệ thống</h1><p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Tổng hợp trạng thái công cụ, tài nguyên và lỗi gần nhất từ dữ liệu thật.</p></div>
        <button className="btn btn-primary" disabled={busy} onClick={() => void refresh()}><RefreshCcw className={busy ? 'animate-spin' : ''} size={17} />{busy ? 'Đang kiểm tra...' : 'Kiểm tra lại'}</button>
      </div>

      <div className="diagnostics-summary mt-5">
        <div><Cpu size={19} /><span>Bộ xử lý</span><b>{Math.round(stats?.cpuPercent ?? 0)}%</b><small>{hardware?.cpuModel ?? 'Chưa đọc phần cứng'}</small></div>
        <div><Activity size={19} /><span>Tiến trình</span><b>{stats?.activeProcesses ?? 0}</b><small>{stats?.activeJobs ?? 0} tác vụ đang hoạt động</small></div>
        <div><HardDrive size={19} /><span>Bộ nhớ</span><b>{Math.round(stats?.memoryPercent ?? 0)}%</b><small>{bytes(stats?.memoryUsedBytes)} / {bytes(stats?.memoryTotalBytes)}</small></div>
        <div><Wrench size={19} /><span>Công cụ</span><b>{tools.length - unhealthy.length}/{tools.length}</b><small>{unhealthy.length ? 'Có công cụ cần xử lý' : 'Các công cụ chính sẵn sàng'}</small></div>
      </div>

      <div className="diagnostics-grid mt-5">
        <section className="card p-5">
          <div className="diagnostics-section-title"><ShieldCheck size={20} /><div><h2>Công cụ media</h2><p>Trạng thái lấy từ ToolManager.</p></div><button className="btn btn-small" onClick={() => setPage('tools')}>Mở trung tâm công cụ</button></div>
          <div className="diagnostics-tool-list">{tools.map((tool) => <div key={tool.name} className={tool.available && tool.health !== 'broken' ? 'is-good' : 'is-bad'}>
            {tool.available && tool.health !== 'broken' ? <ShieldCheck size={17} /> : <CircleAlert size={17} />}
            <div><b>{tool.name}</b><span>{tool.version ?? tool.error ?? 'Chưa xác minh'}</span></div><small>{tool.source ?? '—'}</small>
          </div>)}</div>
        </section>
        <section className="card p-5">
          <div className="diagnostics-section-title"><CircleAlert size={20} /><div><h2>Lỗi gần nhất</h2><p>Không hiển thị token hoặc cookies nhạy cảm.</p></div><button className="btn btn-small" onClick={() => setPage('logs')}>Mở nhật ký</button></div>
          <div className="diagnostics-error-list">{errors.map((entry) => <article key={entry.id}><b>{entry.module} · {entry.eventCode}</b><p>{entry.message}</p><time>{new Date(entry.timestamp).toLocaleString('vi-VN')}</time></article>)}</div>
          {!errors.length && <div className="diagnostics-empty"><ShieldCheck size={24} /><span>Chưa có lỗi được ghi trong phiên hiện tại.</span></div>}
        </section>
      </div>
    </div>
  );
}
