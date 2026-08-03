import { Download, FileJson, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { QueueJob } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { StatusBadge } from '../components/StatusBadge';
import { jobTypeLabel } from '../utils/vi-labels';

const TERMINAL = new Set(['completed', 'skipped', 'cancelled', 'failed', 'interrupted']);

function text(job: QueueJob, key: string): string {
  const value = job.input[key];
  return typeof value === 'string' ? value : '';
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function saveFile(name: string, content: string): Promise<void> {
  await window.desktop.dialogs.saveTextFile({
    defaultName: name,
    content
  });
}

export function HistoryPage(): React.JSX.Element {
  const jobs = useAppStore((state) => state.jobs);
  const projects = useAppStore((state) => state.projects);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const history = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs
      .filter((job) => TERMINAL.has(job.status))
      .filter((job) => status === 'all' || job.status === status)
      .filter((job) => {
        if (!needle) return true;
        const project = projects.find((item) => item.id === job.projectId)?.name ?? '';
        return [project, job.type, job.status, text(job, 'url'), text(job, 'displayName'), text(job, 'outputPath')]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (b.finishedAt ?? b.updatedAt).localeCompare(a.finishedAt ?? a.updatedAt));
  }, [jobs, projects, query, status]);

  const exportJson = async (): Promise<void> => {
    await saveFile(
      `tubmedia-history-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(history, null, 2)
    );
  };

  const exportCsv = async (): Promise<void> => {
    const header = ['Thời gian', 'Dự án', 'Loại', 'Trạng thái', 'Nguồn', 'Đầu ra'];
    const rows = history.map((job) => [
      job.finishedAt ?? job.updatedAt,
      projects.find((item) => item.id === job.projectId)?.name ?? 'Toàn ứng dụng',
      jobTypeLabel(job.type),
      job.status,
      text(job, 'url'),
      text(job, 'outputPath')
    ]);
    await saveFile(
      `tubmedia-history-${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
    );
  };

  return (
    <div className="page-shell history-page">
      <div className="page-heading-row">
        <div><h1 className="text-2xl font-black">Lịch sử công việc</h1><p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Dữ liệu lấy trực tiếp từ hàng đợi đã lưu, không dùng kết quả giả.</p></div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => void exportCsv()}><Download size={16} />Xuất CSV</button>
          <button className="btn" onClick={() => void exportJson()}><FileJson size={16} />Xuất JSON</button>
        </div>
      </div>
      <div className="history-toolbar mt-4">
        <label className="history-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm dự án, URL, file đầu ra..." /></label>
        <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">Tất cả trạng thái</option><option value="completed">Hoàn tất</option><option value="skipped">Đã bỏ qua</option><option value="cancelled">Đã hủy</option><option value="failed">Có lỗi</option><option value="interrupted">Bị gián đoạn</option>
        </select>
        <span>{history.length} kết quả</span>
      </div>
      <div className="card history-table-wrap scroll mt-4">
        <table className="table"><thead><tr><th>Thời gian</th><th>Dự án</th><th>Tác vụ</th><th>Trạng thái</th><th>Nguồn / đầu ra</th></tr></thead>
          <tbody>{history.map((job) => <tr key={job.id}>
            <td>{new Date(job.finishedAt ?? job.updatedAt).toLocaleString('vi-VN')}</td>
            <td>{projects.find((item) => item.id === job.projectId)?.name ?? 'Toàn ứng dụng'}</td>
            <td>{jobTypeLabel(job.type)}</td>
            <td><StatusBadge status={job.status} fixed /></td>
            <td className="history-path-cell"><b>{text(job, 'displayName') || text(job, 'url') || 'Tác vụ hệ thống'}</b><span title={text(job, 'outputPath')}>{text(job, 'outputPath') || 'Chưa có tệp đầu ra'}</span></td>
          </tr>)}</tbody>
        </table>
        {!history.length && <div className="p-12 text-center text-sm" style={{ color: 'var(--muted)' }}>Không có lịch sử phù hợp với bộ lọc.</div>}
      </div>
    </div>
  );
}
