import { ChevronDown, Pause, Play, RefreshCcw, RotateCcw, Square, Trash2 } from 'lucide-react';
import { Fragment, useState, type ChangeEvent } from 'react';
import type { QueueJob } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { StatusBadge } from '../components/StatusBadge';
import { friendlyIssue } from '../utils/ui-error';
import { createUiEventId } from '../utils/ui-id';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CompactDetail } from '../components/CompactDetail';
import { jobTypeLabel } from '../utils/vi-labels';
import { shouldAnimateJobProgress } from '@shared/utils/progress-policy';
import { queueExecutionLane } from '@shared/utils/queue-lane';

const RUNNING = ['pending', 'analyzing', 'downloading', 'verifying', 'normalizing', 'processing', 'merging', 'retrying'];
const PAUSED = ['paused', 'interrupted'];

function inputText(job: QueueJob, key: string): string | null {
  const value = job.input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function inputNumber(job: QueueJob, key: string): number | null {
  const value = job.input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface ProgressPhaseView {
  key: string;
  label: string;
  percent: number;
  state: 'waiting' | 'active' | 'completed';
}

function inputProgressPhases(job: QueueJob): ProgressPhaseView[] {
  const value = job.input.progressPhases;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProgressPhaseView => {
    if (!item || typeof item !== 'object') return false;
    const phase = item as Partial<ProgressPhaseView>;
    return (
      typeof phase.key === 'string' &&
      typeof phase.label === 'string' &&
      typeof phase.percent === 'number' &&
      Number.isFinite(phase.percent) &&
      (phase.state === 'waiting' || phase.state === 'active' || phase.state === 'completed')
    );
  });
}

function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}


function cleanSpeed(value: string | null): string {
  if (!value || /unknown|undefined|null|nan/i.test(value)) return '—';
  return value.trim() || '—';
}

function compactPath(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '\\');
  const parts = normalized.split('\\');
  if (parts.length <= 2) return normalized;
  const file = parts.at(-1) ?? '';
  const shortFile = file.length > 38 ? `${file.slice(0, 28)}…${file.slice(-8)}` : file;
  return `${parts[0]}\\${parts[1]}\\…\\${shortFile}`;
}

function effectiveStage(job: QueueJob): string {
  if (job.status === 'completed') return 'Đã hoàn tất';
  if (job.status === 'skipped') return 'Đã tải trước đó';
  if (job.status === 'cancelled') return 'Đã hủy';
  if (job.status === 'failed') return 'Có lỗi';
  return inputText(job, 'progressStage') ?? (job.status === 'pending' ? 'Đang chờ tới lượt' : '');
}

export function QueuePage({ mode }: { mode: 'downloads' | 'processing' | 'all' }): React.JSX.Element {
  const jobs = useAppStore((state) => state.jobs);
  const projects = useAppStore((state) => state.projects);
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const [projectId, setProjectId] = useState('all');
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [removeAllConfirmOpen, setRemoveAllConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<QueueJob | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  const filtered = jobs.filter((job) =>
    (mode === 'all' ? true : mode === 'downloads' ? job.type === 'download' : job.type !== 'download') &&
    (projectId === 'all' || job.projectId === projectId)
  ).sort((a, b) => {
    const rank = (job: QueueJob): number => {
      if (['analyzing', 'downloading', 'verifying', 'normalizing', 'processing', 'merging', 'retrying'].includes(job.status)) return 0;
      if (['pending', 'ready', 'downloaded'].includes(job.status)) return 1;
      if (['paused', 'interrupted', 'failed'].includes(job.status)) return 2;
      return 3;
    };
    return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt);
  });
  const controllable = jobs.filter((job) => RUNNING.includes(job.status) || PAUSED.includes(job.status));
  const allPaused = controllable.length > 0 && controllable.every((job) => PAUSED.includes(job.status));
  const activeDownloadLane = jobs.filter(
    (job) => queueExecutionLane(job) === 'download-list' && RUNNING.includes(job.status)
  ).length;
  const activeMergeLane = jobs.filter(
    (job) => queueExecutionLane(job) === 'merge-workflow' && RUNNING.includes(job.status)
  ).length;

  const action = async (kind: 'pause' | 'resume' | 'cancel' | 'retry', job: QueueJob): Promise<void> => {
    setBusyJob(job.id);
    try {
      await window.desktop.queue[kind](job.id);
      await refreshJobs();
      const labels = { pause: 'đã tạm dừng', resume: 'đã tiếp tục', cancel: 'đã hủy', retry: 'đã đưa về hàng chờ' } as const;
      setAttention({
        id: createUiEventId('queue-action'),
        severity: kind === 'cancel' ? 'warning' : 'success',
        title: `Tác vụ ${labels[kind]}`,
        message: `Thao tác chỉ áp dụng cho tác vụ ${jobTypeLabel(job.type)} đã chọn.`,
        sticky: false
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyJob(null);
    }
  };

  const toggleAll = async (): Promise<void> => {
    setBusyJob('global-control');
    try {
      if (allPaused) await window.desktop.queue.resumeAll();
      else await window.desktop.queue.pauseAll();
      await refreshJobs();
      setAttention({
        id: createUiEventId('queue-global-control'),
        severity: allPaused ? 'success' : 'warning',
        title: allPaused ? 'Đã tiếp tục tất cả' : 'Đã tạm dừng tất cả',
        message: 'Lệnh đã áp dụng cho mọi danh sách tải và mọi quy trình tải–ghép trong ứng dụng.',
        sticky: false
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyJob(null);
    }
  };

  const removeJob = async (job: QueueJob, deleteOutput = false): Promise<void> => {
    setBusyJob(job.id);
    try {
      const result = await window.desktop.queue.remove(job.id, deleteOutput);
      await refreshJobs();
      setAttention({
        id: createUiEventId('queue-remove'),
        severity: result.removed ? 'info' : 'warning',
        title: result.removed ? 'Đã xóa dòng tiến trình' : 'Không tìm thấy dòng tiến trình',
        message: !result.removed
          ? 'Tác vụ có thể đã được xóa trước đó.'
          : result.outputDeleted
            ? 'Đã xóa dòng tiến trình và tệp đầu ra theo xác nhận của bạn.'
            : deleteOutput && result.outputMissing
              ? 'Đã xóa dòng tiến trình; tệp đầu ra không còn tồn tại hoặc tác vụ chưa tạo tệp.'
              : 'Chỉ dữ liệu tiến trình trong ứng dụng bị xóa; tệp video trên ổ đĩa được giữ nguyên.',
        sticky: false
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyJob(null);
    }
  };

  const clearFinished = async (): Promise<void> => {
    setBusyJob('clear-finished');
    try {
      const count = await window.desktop.queue.clearFinished(projectId === 'all' ? undefined : projectId);
      await refreshJobs();
      setAttention({
        id: createUiEventId('queue-clear-finished'),
        severity: 'info',
        title: 'Đã dọn lịch sử tiến trình',
        message: count > 0 ? `Đã xóa ${count} tác vụ đã kết thúc trong khu vực được chọn.` : 'Không có tác vụ đã kết thúc đủ điều kiện để xóa.',
        sticky: false
      });
      setClearConfirmOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyJob(null);
    }
  };

  const removeAll = async (): Promise<void> => {
    setBusyJob('remove-all');
    try {
      const result = await window.desktop.workbench.removeAll();
      const [, , remainingLogs] = await Promise.all([
        refreshJobs(),
        refreshProjects(),
        window.desktop.logs.list({ limit: 300 })
      ]);
      // Đọc lại nhật ký từ SQLite để giao diện không giữ bất kỳ dòng cũ nào
      // sau thao tác xóa toàn bộ.
      useAppStore.setState({ logs: remainingLogs });
      setProjectId('all');
      setAttention({
        id: createUiEventId('queue-remove-all'),
        severity: 'warning',
        title: 'Đã xóa toàn bộ danh sách và quy trình ghép',
        message: `Đã xóa ${result.projectsRemoved} khu vực làm việc và ${result.jobsRemoved} dòng tiến trình khỏi dữ liệu ứng dụng. Video và thành phẩm trên ổ đĩa không bị xóa.`,
        sticky: false
      });
      setRemoveAllConfirmOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyJob(null);
    }
  };

  const retryFiltered = async (): Promise<void> => {
    setBusyJob('retry-filtered');
    try {
      const count = await window.desktop.queue.retryFailed(projectId === 'all' ? undefined : projectId);
      await refreshJobs();
      setAttention({
        id: createUiEventId('retry-all'),
        severity: 'info',
        title: 'Đã quét các tác vụ lỗi',
        message: count ? `Đã đưa ${count} tác vụ về hàng chờ trong khu vực đang chọn.` : 'Không có tác vụ lỗi cần thử lại.',
        sticky: false
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyJob(null);
    }
  };

  return <div className="page-shell activity-page">
    <header className="page-heading">
      <div>
        <h1>{mode === 'downloads' ? 'Tiến trình tải' : mode === 'processing' ? 'Tiến trình xử lý' : 'Toàn bộ tiến trình'}</h1>
        <p>Điều khiển tập trung cho tất cả danh sách tải và quy trình tải–ghép. Mọi thao tác xóa đều được ghi trực tiếp vào dữ liệu ứng dụng.</p>
      </div>
    </header>

    <div className="page-action-toolbar activity-action-toolbar" aria-label="Điều khiển tiến trình">
      <div className="page-action-group page-action-primary">
        <button className="btn btn-primary" disabled={busyJob !== null || controllable.length === 0} onClick={() => void toggleAll()}>
          {allPaused ? <Play size={17}/> : <Pause size={17}/>} {allPaused ? 'Tiếp tục tất cả' : 'Tạm dừng tất cả'}
        </button>
        <button className="btn" disabled={busyJob !== null} onClick={() => void retryFiltered()}><RotateCcw size={17}/>Thử lại tác vụ lỗi</button>
        <button className="btn" disabled={busyJob !== null} onClick={() => void refreshJobs()}><RefreshCcw size={17}/>Làm mới</button>
      </div>
      <div className="page-action-group page-action-maintenance">
        <button className="btn" disabled={busyJob !== null} onClick={() => setClearConfirmOpen(true)}><Trash2 size={17}/>Dọn tác vụ đã kết thúc</button>
      </div>
      <div className="page-action-group page-action-danger">
        <button className="btn btn-danger" disabled={busyJob !== null} onClick={() => setRemoveAllConfirmOpen(true)}><Trash2 size={17}/>Dừng và xóa toàn bộ danh sách</button>
      </div>
    </div>

    <div className="activity-lane-overview mt-4">
      <div className="activity-lane-card">
        <span>LUỒNG TẢI DANH SÁCH</span>
        <b>{activeDownloadLane} tác vụ đang hoạt động</b>
      </div>
      <div className="activity-lane-card">
        <span>LUỒNG TẢI & GHÉP VIDEO</span>
        <b>{activeMergeLane} tác vụ đang hoạt động</b>
      </div>
    </div>

    <div className="activity-filter mt-4 max-w-xl">
      <label><span className="label">Chỉ xem một danh sách hoặc quy trình ghép</span>
        <select className="select" value={projectId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setProjectId(event.target.value)}>
          <option value="all">Tất cả khu vực</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
    </div>

    <div className="card activity-table scroll mt-5 max-h-[calc(100vh-220px)] overflow-auto">
      <table className="table queue-data-table">
        <colgroup>
          <col className="queue-col-project"/>
          <col className="queue-col-job"/>
          <col className="queue-col-status"/>
          <col className="queue-col-progress"/>
          <col className="queue-col-time"/>
          <col className="queue-col-message"/>
          <col className="queue-col-actions"/>
        </colgroup>
        <thead><tr><th>Danh sách / Quy trình ghép</th><th>Tác vụ</th><th>Trạng thái</th><th>Tiến trình</th><th>Tốc độ / Thời gian</th><th>Thông báo</th><th>Điều khiển</th></tr></thead>
        <tbody>{filtered.map((job) => {
          const issue = job.errorMessage ? friendlyIssue(job.errorMessage) : null;
          const resultMessage = inputText(job, 'resultMessage');
          const active = RUNNING.includes(job.status);
          const paused = PAUSED.includes(job.status);
          const failed = job.status === 'failed';
          const cancellable = active || paused;
          const stage = effectiveStage(job);
          const expanded = expandedJobs.has(job.id);
          const elapsed = inputNumber(job, 'progressElapsedSeconds');
          const phases = inputProgressPhases(job);
          const messageTitle = issue?.title ?? (job.status === 'skipped'
            ? 'Đã tải trước đó – đã bỏ qua'
            : job.status === 'completed'
              ? 'Đã hoàn tất'
              : 'Không có sự cố');
          const messageDetail = issue?.message ?? resultMessage;
          const discloseMessage = Boolean(issue || (messageDetail && messageDetail.length > 72));
          return <Fragment key={job.id}><tr>
            <td className="queue-project-cell" title={projects.find((project) => project.id === job.projectId)?.name ?? 'Toàn ứng dụng'}>{projects.find((project) => project.id === job.projectId)?.name ?? 'Toàn ứng dụng'}</td>
            <td className="queue-job-cell">
              <b>{jobTypeLabel(job.type)}</b>
              <div className="queue-job-name" title={inputText(job, 'displayName') ?? inputText(job, 'productName') ?? inputText(job, 'url') ?? undefined}>
                {inputText(job, 'displayName') ?? inputText(job, 'productName') ?? inputText(job, 'url') ?? 'Tác vụ hệ thống'}
              </div>
              {inputText(job, 'outputPath') && <div className="queue-output-path" title={inputText(job, 'outputPath') ?? undefined}>{compactPath(inputText(job, 'outputPath'))}</div>}
            </td>
            <td className="queue-status-cell"><StatusBadge status={job.status} fixed/></td>
            <td className="queue-progress-cell"><div className={`progress ${shouldAnimateJobProgress(job.status) ? 'is-animated' : 'is-static'}`}><span style={{ width: `${job.progress}%` }}/></div><div className="queue-progress-caption"><b>{job.progress.toFixed(1)}%</b><span>{stage ?? (job.status === 'pending' ? 'Đang chờ tới lượt' : '')}</span></div></td>
            <td className="queue-time-cell">
              <b>{cleanSpeed(job.speed)}</b>
              {elapsed !== null && <span>Đã chạy {durationLabel(elapsed)}</span>}
              {job.etaSeconds !== null && job.etaSeconds > 0 && <span>Còn khoảng {durationLabel(job.etaSeconds)}</span>}
            </td>
            <td className="queue-message-cell">
              <div className="queue-message-block">
                <div className="queue-message-compact">
                  <b
                    title={messageTitle}
                    style={{ color: issue?.tone === 'warning' ? 'var(--warn)' : issue ? 'var(--bad)' : job.status === 'skipped' || job.status === 'completed' ? 'var(--good)' : 'var(--muted)' }}
                  >
                    {messageTitle}
                  </b>
                  {discloseMessage && messageDetail && <CompactDetail
                    label={issue ? 'Thông tin sự cố' : 'Thông tin kết quả tác vụ'}
                    tone={issue?.tone === 'warning' ? 'warning' : issue ? 'danger' : 'good'}
                  >
                    <p>{messageDetail}</p>
                    {issue && issue.steps.length > 0 && <ol>{issue.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
                    {issue?.technical && <details><summary>Thông tin kỹ thuật</summary><pre>{issue.technical}</pre></details>}
                  </CompactDetail>}
                </div>
                {!discloseMessage && messageDetail && <small>{messageDetail}</small>}
              </div>
            </td>
            <td className="queue-actions-cell"><div className="queue-actions">
              {active && <button className="btn p-1.5" disabled={busyJob === job.id} title="Tạm dừng tác vụ" onClick={() => void action('pause', job)}><Pause size={14}/></button>}
              {paused && <button className="btn p-1.5" disabled={busyJob === job.id} title="Tiếp tục tác vụ" onClick={() => void action('resume', job)}><Play size={14}/></button>}
              {failed && <button className="btn p-1.5" disabled={busyJob === job.id} title="Thử lại tác vụ" onClick={() => void action('retry', job)}><RotateCcw size={14}/></button>}
              {cancellable && <button className="btn btn-danger p-1.5" disabled={busyJob === job.id} title="Hủy tác vụ" onClick={() => void action('cancel', job)}><Square size={14}/></button>}
              <button className="btn p-1.5" title={expanded ? 'Thu gọn chi tiết' : 'Mở chi tiết tiến trình'} aria-expanded={expanded} onClick={() => setExpandedJobs((current) => { const next = new Set(current); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next; })}><ChevronDown size={14}/></button>
              <button className="btn btn-danger p-1.5" disabled={busyJob === job.id} title="Xóa tác vụ" onClick={() => setDeleteTarget(job)}><Trash2 size={14}/></button>
            </div></td>
          </tr>
          {expanded && <tr className="queue-detail-row"><td colSpan={7}><div className="queue-detail-panel">
            {phases.length > 0 && <div className="queue-phase-list" aria-label="Các bước tiến trình">
              {phases.map((phase) => <div className={`queue-phase-item is-${phase.state}`} key={phase.key}>
                <div className="queue-phase-heading"><span>{phase.label}</span><b>{Math.max(0, Math.min(100, phase.percent)).toFixed(1)}%</b></div>
                <div className={`progress ${phase.state === 'active' ? 'is-animated' : 'is-static'}`}><span style={{ width: `${Math.max(0, Math.min(100, phase.percent))}%` }}/></div>
                <small>{phase.state === 'completed' ? 'Đã hoàn tất' : phase.state === 'active' ? 'Đang xử lý' : 'Đang chờ'}</small>
              </div>)}
            </div>}
            <div className="queue-detail-grid">
              <div><span>Giai đoạn hiện tại</span><b>{stage || '—'}</b></div>
              <div><span>Tiến độ tổng</span><b>{job.progress.toFixed(1)}%</b></div>
              <div><span>Tốc độ</span><b>{cleanSpeed(job.speed)}</b></div>
              <div><span>Thời gian còn lại</span><b>{job.etaSeconds && job.etaSeconds > 0 ? durationLabel(job.etaSeconds) : '—'}</b></div>
              <div className="queue-detail-wide"><span>Đường dẫn đầy đủ</span><b title={inputText(job, 'outputPath') ?? ''}>{inputText(job, 'outputPath') ?? 'Chưa có tệp đầu ra'}</b></div>
            </div>
          </div></td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
      {!filtered.length && <div className="p-12 text-center text-sm" style={{ color: 'var(--muted)' }}>Chưa có tác vụ phù hợp với bộ lọc.</div>}
    </div>

    <ConfirmDialog
      open={deleteTarget !== null}
      title={deleteTarget ? `Xóa tác vụ ${jobTypeLabel(deleteTarget.type)}?` : 'Xóa tác vụ?'}
      message={deleteTarget && RUNNING.includes(deleteTarget.status) ? 'Tác vụ đang hoạt động sẽ được dừng an toàn trước khi xóa.' : 'Chọn phạm vi dữ liệu bạn muốn xóa.'}
      details={[
        '“Chỉ xóa khỏi danh sách” là lựa chọn an toàn và giữ nguyên video trên ổ đĩa.',
        '“Xóa cả tệp đầu ra” chỉ xóa đúng tệp đầu ra hiển thị của tác vụ, không xóa cả thư mục.',
        'Dữ liệu xóa được ghi ngay và không xuất hiện lại sau khi mở ứng dụng.'
      ]}
      confirmLabel="Chỉ xóa khỏi danh sách"
      secondaryLabel={deleteTarget && inputText(deleteTarget, 'outputPath') ? 'Xóa khỏi danh sách và xóa tệp' : undefined}
      secondaryDanger
      danger
      busy={deleteTarget !== null && busyJob === deleteTarget.id}
      onCancel={() => setDeleteTarget(null)}
      onSecondary={() => { if (deleteTarget) void removeJob(deleteTarget, true).finally(() => setDeleteTarget(null)); }}
      onConfirm={() => { if (deleteTarget) void removeJob(deleteTarget, false).finally(() => setDeleteTarget(null)); }}
    />

    <ConfirmDialog
      open={clearConfirmOpen}
      title="Dọn các tác vụ đã kết thúc?"
      message="Các dòng Hoàn tất, Đã bỏ qua, Đã hủy và Có lỗi đủ điều kiện sẽ bị xóa khỏi bảng tiến trình."
      details={['Tác vụ đang chạy hoặc đang chờ không bị xóa.', 'Tệp video và thành phẩm trên ổ đĩa không bị ảnh hưởng.', 'Danh sách còn tác vụ chưa kết thúc được giữ nguyên để bảo vệ thứ tự xử lý.']}
      confirmLabel="Dọn lịch sử"
      busy={busyJob === 'clear-finished'}
      onCancel={() => setClearConfirmOpen(false)}
      onConfirm={() => void clearFinished()}
    />

    <ConfirmDialog
      open={removeAllConfirmOpen}
      title="Dừng và xóa toàn bộ danh sách tải, quy trình ghép?"
      message="Ứng dụng sẽ tạm dừng, hủy an toàn mọi tiến trình nền rồi xóa toàn bộ danh sách tải, quy trình ghép, liên kết, tiến trình và nhật ký khỏi cơ sở dữ liệu."
      details={['Thay đổi được ghi trực tiếp và dữ liệu cũ sẽ không xuất hiện lại ở lần mở sau.', 'Video đã tải, nguồn và thành phẩm trên ổ đĩa vẫn được giữ nguyên.', 'Thao tác này áp dụng cho tất cả khu vực, không chỉ các tác vụ đã hoàn tất.']}
      confirmLabel="Dừng và xóa tất cả"
      danger
      busy={busyJob === 'remove-all'}
      onCancel={() => setRemoveAllConfirmOpen(false)}
      onConfirm={() => void removeAll()}
    />
  </div>;
}
