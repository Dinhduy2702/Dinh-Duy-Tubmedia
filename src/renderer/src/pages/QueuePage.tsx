import {
  CheckSquare,
  ChevronDown,
  ExternalLink,
  Filter,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { QueueJob } from '@shared/types/domain';
import type { QuickDownloadStatus } from '@shared/quick-download';
import { useAppStore } from '../stores/app-store';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CompactDetail } from '../components/CompactDetail';
import { UnifiedDownloadProgress } from '../components/UnifiedDownloadProgress';
import { useVirtualTableWindow } from '../components/VirtualTableWindow';
import { jobTypeLabel, statusLabel } from '../utils/vi-labels';
import { createUiEventId } from '../utils/ui-id';
import { friendlyIssue, safeUiText } from '../utils/ui-error';

const ACTIVE = new Set<QueueJob['status']>([
  'pending',
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying'
]);
const RUNNING = new Set<QueueJob['status']>([
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying'
]);
const PAUSED = new Set<QueueJob['status']>(['paused', 'interrupted']);
const COMPLETED = new Set<QueueJob['status']>(['completed', 'skipped']);
const QUICK_TERMINAL = new Set<QuickDownloadStatus['phase']>([
  'completed',
  'cancelled',
  'failed',
  'interrupted'
]);

type QueueAction = 'pause' | 'resume' | 'cancel' | 'retry';
type ConfirmAction = 'cancel-selected' | 'remove-selected' | 'remove-one' | 'remove-all';

interface WorkflowGroup {
  key: string;
  projectId: string | null;
  title: string;
  subtitle: string;
  status: QueueJob['status'];
  progress: number;
  completed: number;
  total: number;
  running: number;
  paused: number;
  failed: number;
  detail: string;
  secondary: string;
  jobs: QueueJob[];
}

function quickPhaseLabel(phase: QuickDownloadStatus['phase']): string {
  const labels: Record<QuickDownloadStatus['phase'], string> = {
    queued: 'Đang xếp hàng',
    preparing: 'Đang chuẩn bị',
    downloading: 'Đang tải',
    processing: 'Đang xử lý',
    verifying: 'Đang kiểm tra',
    pausing: 'Đang tạm dừng',
    paused: 'Đã tạm dừng',
    resuming: 'Đang tiếp tục',
    completed: 'Đã hoàn tất',
    cancelling: 'Đang hủy',
    cancelled: 'Đã hủy',
    failed: 'Tải thất bại',
    interrupted: 'Bị gián đoạn'
  };
  return labels[phase];
}

function quickPhaseStatus(phase: QuickDownloadStatus['phase']): QueueJob['status'] {
  if (phase === 'queued') return 'pending';
  if (phase === 'preparing') return 'analyzing';
  if (phase === 'pausing' || phase === 'paused') return 'paused';
  if (phase === 'resuming' || phase === 'downloading') return 'downloading';
  if (phase === 'processing') return 'processing';
  if (phase === 'verifying') return 'verifying';
  if (phase === 'cancelling' || phase === 'cancelled') return 'cancelled';
  if (phase === 'completed') return 'completed';
  if (phase === 'interrupted') return 'interrupted';
  return 'failed';
}

function inputText(job: QueueJob, key: string): string {
  const value = job.input[key];
  return typeof value === 'string' ? value : '';
}

function jobTitle(job: QueueJob): string {
  return (
    inputText(job, 'displayName') ||
    inputText(job, 'productName') ||
    inputText(job, 'url') ||
    'Tác vụ hệ thống'
  );
}

function projectName(job: QueueJob, projects: ReturnType<typeof useAppStore.getState>['projects']): string {
  return projects.find((project) => project.id === job.projectId)?.name ?? 'Toàn ứng dụng';
}

function groupStatus(jobs: QueueJob[]): QueueJob['status'] {
  const running = jobs.find((job) => RUNNING.has(job.status));
  if (running) return running.status;
  if (jobs.some((job) => job.status === 'pending')) return 'pending';
  if (jobs.some((job) => PAUSED.has(job.status))) return 'paused';
  if (jobs.some((job) => job.status === 'failed')) return 'failed';
  if (jobs.length > 0 && jobs.every((job) => COMPLETED.has(job.status) || job.status === 'cancelled')) {
    return 'completed';
  }
  return jobs[0]?.status ?? 'pending';
}

function workflowSubtitle(mode: 'downloads' | 'processing' | 'all', jobs: QueueJob[]): string {
  if (mode === 'downloads') return 'Danh sách tải độc lập · chạy song song với các danh sách khác';
  if (mode === 'processing') return 'Workflow xử lý video';
  const types = new Set(jobs.map((job) => job.type));
  return types.size > 1
    ? 'Workflow đầy đủ của dự án'
    : `${jobTypeLabel(jobs[0]?.type ?? 'download')} workflow`;
}

function aggregateWorkflowGroups(
  jobs: QueueJob[],
  projects: ReturnType<typeof useAppStore.getState>['projects'],
  mode: 'downloads' | 'processing' | 'all'
): WorkflowGroup[] {
  const grouped = new Map<string, QueueJob[]>();

  for (const job of jobs) {
    const key = job.projectId ? `project:${job.projectId}` : `global:${job.type}`;
    const groupJobs = grouped.get(key) ?? [];
    groupJobs.push(job);
    grouped.set(key, groupJobs);
  }

  return [...grouped.entries()]
    .map(([key, groupJobs]) => {
      const sortedJobs = [...groupJobs].sort((left, right) => {
        const rank = (job: QueueJob): number =>
          RUNNING.has(job.status)
            ? 0
            : job.status === 'pending'
              ? 1
              : PAUSED.has(job.status)
                ? 2
                : job.status === 'failed'
                  ? 3
                  : 4;
        return rank(left) - rank(right) || right.updatedAt.localeCompare(left.updatedAt);
      });
      const completed = groupJobs.filter((job) => COMPLETED.has(job.status)).length;
      const runningJobs = groupJobs.filter((job) => RUNNING.has(job.status));
      const paused = groupJobs.filter((job) => PAUSED.has(job.status)).length;
      const failed = groupJobs.filter((job) => job.status === 'failed').length;
      const progress =
        groupJobs.reduce((sum, job) => sum + Math.max(0, Math.min(100, job.progress)), 0) /
        Math.max(1, groupJobs.length);
      const speeds = [...new Set(runningJobs.map((job) => job.speed).filter(Boolean))].slice(0, 2);
      const activeTitle = runningJobs[0] ? jobTitle(runningJobs[0]) : null;
      const project = groupJobs[0]?.projectId
        ? projects.find((item) => item.id === groupJobs[0]?.projectId)
        : null;

      return {
        key,
        projectId: groupJobs[0]?.projectId ?? null,
        title: project?.name ?? projectName(groupJobs[0]!, projects),
        subtitle: workflowSubtitle(mode, groupJobs),
        status: groupStatus(groupJobs),
        progress,
        completed,
        total: groupJobs.length,
        running: runningJobs.length,
        paused,
        failed,
        detail:
          runningJobs.length > 1
            ? `${runningJobs.length} tác vụ đang chạy song song${speeds.length ? ` · ${speeds.join(' · ')}` : ''}`
            : activeTitle
              ? `${activeTitle}${speeds.length ? ` · ${speeds[0]}` : ''}`
              : failed > 0
                ? `${failed} tác vụ cần xử lý lại`
                : paused > 0
                  ? `${paused} tác vụ đang tạm dừng`
                  : completed === groupJobs.length
                    ? 'Toàn bộ tác vụ đã hoàn tất'
                    : `${completed}/${groupJobs.length} tác vụ đã hoàn tất`,
        secondary: `${completed}/${groupJobs.length} hoàn tất · ${runningJobs.length} đang chạy · ${paused} tạm dừng · ${failed} lỗi`,
        jobs: sortedJobs
      };
    })
    .sort((left, right) => {
      const rank = (group: WorkflowGroup): number =>
        group.running > 0
          ? 0
          : group.status === 'pending'
            ? 1
            : group.paused > 0
              ? 2
              : group.failed > 0
                ? 3
                : 4;
      return rank(left) - rank(right) || left.title.localeCompare(right.title, 'vi');
    });
}

function QueueChildRows({
  jobs,
  selectedIds,
  busy,
  onToggleSelected,
  onRunOne,
  onOpenDetail,
  onRemove
}: {
  jobs: QueueJob[];
  selectedIds: Set<string>;
  busy: string | null;
  onToggleSelected: (jobId: string) => void;
  onRunOne: (kind: QueueAction, job: QueueJob) => Promise<void>;
  onOpenDetail: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}): React.JSX.Element {
  const virtual = useVirtualTableWindow(jobs, 108, 520, 8, true);

  return (
    <div className="queue-window queue-group-child-window" onScroll={virtual.onScroll}>
      {virtual.topSpacerHeight > 0 && <div style={{ height: virtual.topSpacerHeight }} aria-hidden="true" />}
      {virtual.visibleItems.map((job) => {
        const selected = selectedIds.has(job.id);
        const outputPath = inputText(job, 'outputPath');
        const issue = job.errorMessage ? friendlyIssue(job.errorMessage) : null;
        const resultMessage = inputText(job, 'resultMessage');
        const messageTitle =
          issue?.title ??
          (job.status === 'skipped'
            ? 'Đã tải trước đó – đã bỏ qua'
            : job.status === 'completed'
              ? 'Đã hoàn tất'
              : job.status === 'cancelled'
                ? 'Đã hủy'
                : statusLabel(job.status));
        const messageDetail = issue?.message ?? resultMessage ?? inputText(job, 'progressStage');
        const discloseMessage = Boolean(issue || (messageDetail && messageDetail.length > 72));
        const progressDetail =
          job.speed || (job.etaSeconds ? `Còn ${job.etaSeconds}s` : messageDetail || 'Đang chờ');

        return (
          <article className={`queue-studio-row ${selected ? 'is-selected' : ''}`} key={job.id}>
            <span className="queue-row-selector">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelected(job.id)}
                aria-label={`Chọn ${jobTitle(job)}`}
              />
            </span>

            <div className="queue-task-stack">
              <div className="queue-row-heading">
                <div className="queue-studio-source">
                  <b title={jobTitle(job)}>{jobTitle(job)}</b>
                  <span>{jobTypeLabel(job.type)}</span>
                  {outputPath && <small title={outputPath}>{outputPath}</small>}
                </div>
                <StatusBadge status={job.status} fixed />
              </div>

              <div
                className={`progress queue-row-progress ${RUNNING.has(job.status) ? 'is-animated' : 'is-static'}`}
              >
                <span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
              </div>

              <div className="queue-row-progress-meta">
                <b>{job.progress.toFixed(1)}% tác vụ</b>
                <span>{progressDetail}</span>
              </div>

              <div className="queue-message-compact">
                <b
                  title={messageTitle}
                  style={{
                    color:
                      issue?.tone === 'warning'
                        ? 'var(--warn)'
                        : issue
                          ? 'var(--bad)'
                          : job.status === 'skipped' || job.status === 'completed'
                            ? 'var(--good)'
                            : 'var(--muted)'
                  }}
                >
                  {messageTitle}
                </b>
                {discloseMessage && messageDetail && (
                  <CompactDetail
                    label={issue ? 'Thông tin sự cố' : 'Thông tin kết quả tác vụ'}
                    tone={issue?.tone === 'warning' ? 'warning' : issue ? 'danger' : 'good'}
                  >
                    <p>{messageDetail}</p>
                    {issue && issue.steps.length > 0 && (
                      <ol>
                        {issue.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </CompactDetail>
                )}
                {!discloseMessage && messageDetail && <small>{messageDetail}</small>}
              </div>
            </div>

            <div className="queue-row-actions">
              {ACTIVE.has(job.status) && (
                <button
                  className="btn btn-small"
                  disabled={busy === job.id}
                  onClick={() => void onRunOne('pause', job)}
                  title="Tạm dừng"
                >
                  <Pause size={14} />
                </button>
              )}
              {PAUSED.has(job.status) && (
                <button
                  className="btn btn-small btn-primary"
                  disabled={busy === job.id}
                  onClick={() => void onRunOne('resume', job)}
                  title="Tiếp tục"
                >
                  <Play size={14} />
                </button>
              )}
              {(job.status === 'failed' || job.status === 'interrupted') && (
                <button
                  className="btn btn-small"
                  disabled={busy === job.id}
                  onClick={() => void onRunOne('retry', job)}
                  title="Thử lại"
                >
                  <RotateCcw size={14} />
                </button>
              )}
              {outputPath && (
                <button
                  className="btn btn-small"
                  onClick={() => void window.desktop.app.showPath(outputPath)}
                  title="Mở đầu ra"
                >
                  <ExternalLink size={14} />
                </button>
              )}
              <button
                className="btn btn-small"
                onClick={() => onOpenDetail(job.id)}
                title="Mở chi tiết tiến trình"
              >
                <Search size={14} />
              </button>
              {!ACTIVE.has(job.status) && (
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => onRemove(job.id)}
                  title="Xóa tác vụ"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </article>
        );
      })}
      {virtual.bottomSpacerHeight > 0 && (
        <div style={{ height: virtual.bottomSpacerHeight }} aria-hidden="true" />
      )}
    </div>
  );
}

function WorkflowAccordion({
  group,
  expanded,
  busy,
  selectedIds,
  actions,
  onToggleExpanded,
  onToggleSelected,
  onRunOne,
  onOpenDetail,
  onRemove
}: {
  group: WorkflowGroup;
  expanded: boolean;
  busy: string | null;
  selectedIds: Set<string>;
  actions: ReactNode;
  onToggleExpanded: () => void;
  onToggleSelected: (jobId: string) => void;
  onRunOne: (kind: QueueAction, job: QueueJob) => Promise<void>;
  onOpenDetail: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}): React.JSX.Element {
  return (
    <article className={`queue-workflow-card ${expanded ? 'is-expanded' : ''}`} data-status={group.status}>
      <div className="queue-workflow-summary-row">
        <UnifiedDownloadProgress
          compact
          className="queue-workflow-total-progress"
          title={group.title}
          subtitle={group.subtitle}
          status={group.status}
          progress={group.progress}
          completed={group.completed}
          total={group.total}
          detail={group.detail}
          secondary={group.secondary}
          actions={actions}
        />
        <button
          className="queue-workflow-expander"
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Thu gọn' : 'Mở'} ${group.title}`}
          onClick={onToggleExpanded}
        >
          <ChevronDown size={20} />
          <span>{expanded ? 'Thu gọn' : `${group.total} mục`}</span>
        </button>
      </div>

      <div className={`queue-workflow-collapse ${expanded ? 'is-open' : ''}`}>
        <div className="queue-workflow-collapse-inner">
          <div className="queue-group-child-heading">
            <div>
              <b>Tiến trình thành phần</b>
              <span>Mỗi dòng là một video hoặc công đoạn bên trong workflow tổng.</span>
            </div>
            <strong>{group.total} tác vụ</strong>
          </div>
          <QueueChildRows
            jobs={group.jobs}
            selectedIds={selectedIds}
            busy={busy}
            onToggleSelected={onToggleSelected}
            onRunOne={onRunOne}
            onOpenDetail={onOpenDetail}
            onRemove={onRemove}
          />
        </div>
      </div>
    </article>
  );
}

function QuickDownloadAccordion({
  status,
  expanded,
  busy,
  onToggleExpanded,
  onControl
}: {
  status: QuickDownloadStatus;
  expanded: boolean;
  busy: string | null;
  onToggleExpanded: () => void;
  onControl: (action: 'pause' | 'resume' | 'cancel' | 'reveal') => Promise<void>;
}): React.JSX.Element {
  const mappedStatus = quickPhaseStatus(status.phase);
  const active = !QUICK_TERMINAL.has(status.phase) && status.phase !== 'paused';
  const paused = status.phase === 'paused';
  const completed = status.phase === 'completed';

  return (
    <article
      className={`queue-workflow-card is-quick-download ${expanded ? 'is-expanded' : ''}`}
      data-status={mappedStatus}
    >
      <div className="queue-workflow-summary-row">
        <UnifiedDownloadProgress
          compact
          className="queue-workflow-total-progress"
          title={status.title || 'Tải nhanh 1 video'}
          subtitle={`Tải nhanh · ${quickPhaseLabel(status.phase)} · ProcessManager chung`}
          status={mappedStatus}
          progress={status.progress}
          completed={completed ? 1 : 0}
          total={1}
          detail={status.speed || (status.eta ? `Còn ${status.eta}` : safeUiText(status.message, quickPhaseLabel(status.phase)))}
          secondary="Một video độc lập · có thể chạy song song với mọi danh sách tải"
          outputPath={status.outputPath}
          actions={
            <>
              {active && (
                <button
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => void onControl('pause')}
                >
                  <Pause size={14} />
                  Tạm dừng
                </button>
              )}
              {paused && (
                <button
                  className="btn btn-small btn-primary"
                  disabled={busy !== null}
                  onClick={() => void onControl('resume')}
                >
                  <Play size={14} />
                  Tiếp tục
                </button>
              )}
              {(active || paused) && (
                <button
                  className="btn btn-small btn-danger"
                  disabled={busy !== null}
                  onClick={() => void onControl('cancel')}
                >
                  <Square size={14} />
                  Hủy
                </button>
              )}
              {completed && status.outputPath && (
                <button
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => void onControl('reveal')}
                >
                  <ExternalLink size={14} />
                  Mở file
                </button>
              )}
            </>
          }
        />
        <button
          className="queue-workflow-expander"
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Thu gọn' : 'Mở'} Tải nhanh`}
          onClick={onToggleExpanded}
        >
          <ChevronDown size={20} />
          <span>{expanded ? 'Thu gọn' : 'Chi tiết'}</span>
        </button>
      </div>

      <div className={`queue-workflow-collapse ${expanded ? 'is-open' : ''}`}>
        <div className="queue-workflow-collapse-inner">
          <div className="quick-progress-child-card">
            <div>
              <span>TRẠNG THÁI CHI TIẾT</span>
              <b>{quickPhaseLabel(status.phase)}</b>
              <p>{safeUiText(status.message, 'Đang đồng bộ dữ liệu Tải nhanh.')}</p>
            </div>
            <dl>
              <div>
                <dt>Đã tải</dt>
                <dd>{status.downloadedBytes.toLocaleString('vi-VN')} B</dd>
              </div>
              <div>
                <dt>Tổng dung lượng</dt>
                <dd>
                  {status.totalBytes > 0 ? `${status.totalBytes.toLocaleString('vi-VN')} B` : 'Đang xác định'}
                </dd>
              </div>
              <div>
                <dt>Tốc độ</dt>
                <dd>{status.speed || '—'}</dd>
              </div>
              <div>
                <dt>Còn lại</dt>
                <dd>{status.eta || '—'}</dd>
              </div>
            </dl>
            {status.error && (() => {
              const issue = friendlyIssue(status.error);
              return (
                <div className={`queue-detail-error queue-detail-${issue.tone}`}>
                  <b>{issue.title}</b>
                  <p>{issue.message}</p>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </article>
  );
}

export function QueuePage({ mode }: { mode: 'downloads' | 'processing' | 'all' }): React.JSX.Element {
  const jobs = useAppStore((state) => state.jobs);
  const projects = useAppStore((state) => state.projects);
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [quickStatus, setQuickStatus] = useState<QuickDownloadStatus | null>(null);
  const expansionInitializedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const refreshQuickStatus = async (): Promise<void> => {
      try {
        const current = await window.desktop.quickDownload.current();
        if (mounted) setQuickStatus(current);
      } catch {
        if (mounted) setQuickStatus(null);
      }
    };

    void refreshQuickStatus();
    const timer = window.setInterval(() => void refreshQuickStatus(), 650);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs
      .filter(
        (job) => mode === 'all' || (mode === 'downloads' ? job.type === 'download' : job.type !== 'download')
      )
      .filter((job) => projectId === 'all' || job.projectId === projectId)
      .filter((job) => status === 'all' || job.status === status)
      .filter((job) => {
        if (!needle) return true;
        return [
          projectName(job, projects),
          job.type,
          job.status,
          jobTitle(job),
          inputText(job, 'outputPath'),
          job.errorMessage ?? ''
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      });
  }, [jobs, mode, projectId, projects, query, status]);

  const workflowGroups = useMemo(
    () => aggregateWorkflowGroups(filtered, projects, mode),
    [filtered, mode, projects]
  );

  useEffect(() => {
    if (expansionInitializedRef.current) return;
    const firstActive = workflowGroups.find((group) => group.running > 0 || group.status === 'pending');
    if (!firstActive) return;
    expansionInitializedRef.current = true;
    setExpandedKeys(new Set([firstActive.key]));
  }, [workflowGroups]);

  const detailJob = jobs.find((job) => job.id === detailId) ?? null;
  const selectedJobs = jobs.filter((job) => selectedIds.has(job.id));
  const allVisibleSelected = filtered.length > 0 && filtered.every((job) => selectedIds.has(job.id));
  const quickIsPaused = quickStatus?.phase === 'paused';
  const quickIsActive = Boolean(
    quickStatus && !QUICK_TERMINAL.has(quickStatus.phase) && quickStatus.phase !== 'paused'
  );
  const activeCount = jobs.filter((job) => RUNNING.has(job.status)).length + (quickIsActive ? 1 : 0);
  const pausedCount = jobs.filter((job) => PAUSED.has(job.status)).length + (quickIsPaused ? 1 : 0);
  const failedCount =
    jobs.filter((job) => job.status === 'failed').length + (quickStatus?.phase === 'failed' ? 1 : 0);

  const notify = (
    title: string,
    message: string,
    severity: 'success' | 'warning' | 'info' = 'success'
  ): void => {
    setAttention({ id: createUiEventId('queue-studio'), severity, title, message, sticky: false });
  };

  const runOne = async (kind: QueueAction, job: QueueJob): Promise<void> => {
    setBusy(job.id);
    try {
      await window.desktop.queue[kind](job.id);
      await refreshJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const runGroup = async (kind: QueueAction, group: WorkflowGroup): Promise<void> => {
    const candidates = group.jobs.filter((job) => {
      if (kind === 'pause') return ACTIVE.has(job.status);
      if (kind === 'resume') return PAUSED.has(job.status);
      if (kind === 'retry') return job.status === 'failed' || job.status === 'interrupted';
      return ACTIVE.has(job.status) || PAUSED.has(job.status);
    });
    if (candidates.length === 0) return;

    setBusy(`group-${group.key}-${kind}`);
    try {
      const results = await Promise.allSettled(candidates.map((job) => window.desktop.queue[kind](job.id)));
      await refreshJobs();
      const completed = results.filter((result) => result.status === 'fulfilled').length;
      notify(
        `${group.title}: ${kind === 'pause' ? 'đã tạm dừng' : kind === 'resume' ? 'đã tiếp tục' : kind === 'retry' ? 'đã thử lại' : 'đã hủy'}`,
        `${completed}/${candidates.length} tác vụ đã nhận lệnh. Các danh sách khác vẫn chạy độc lập.`,
        completed === candidates.length ? 'success' : 'warning'
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const controlQuickDownload = async (action: 'pause' | 'resume' | 'cancel' | 'reveal'): Promise<void> => {
    if (!quickStatus) return;
    setBusy(`quick-${action}`);
    try {
      if (action === 'pause') {
        const next = await window.desktop.quickDownload.pause(quickStatus.taskId);
        if (next) setQuickStatus(next);
      } else if (action === 'resume') {
        const next = await window.desktop.quickDownload.resume(quickStatus.taskId);
        if (next) setQuickStatus(next);
      } else if (action === 'cancel') {
        const next = await window.desktop.quickDownload.cancel(quickStatus.taskId);
        if (next) setQuickStatus(next);
      } else {
        const revealed = await window.desktop.quickDownload.revealOutput(quickStatus.taskId);
        if (!revealed) setError('File đầu ra của Tải nhanh không còn tồn tại.');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const runBulk = async (kind: QueueAction): Promise<void> => {
    const candidates = selectedJobs.filter((job) => {
      if (kind === 'pause') return ACTIVE.has(job.status);
      if (kind === 'resume') return PAUSED.has(job.status);
      if (kind === 'retry') return job.status === 'failed' || job.status === 'interrupted';
      return ACTIVE.has(job.status) || PAUSED.has(job.status);
    });
    if (candidates.length === 0) return;

    setBusy(`bulk-${kind}`);
    try {
      const results = await Promise.allSettled(candidates.map((job) => window.desktop.queue[kind](job.id)));
      await refreshJobs();
      const completed = results.filter((result) => result.status === 'fulfilled').length;
      notify(
        'Đã xử lý tác vụ đã chọn',
        `${completed}/${candidates.length} tác vụ hoàn tất thao tác ${kind}.`,
        completed === candidates.length ? 'success' : 'warning'
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      if (kind === 'cancel') setConfirm(null);
    }
  };

  const removeSelected = async (): Promise<void> => {
    setBusy('remove-selected');
    try {
      const removable = selectedJobs.filter((job) => !ACTIVE.has(job.status));
      const results = await Promise.allSettled(
        removable.map((job) => window.desktop.queue.remove(job.id, false))
      );
      await refreshJobs();
      setSelectedIds(new Set());
      setConfirm(null);
      notify(
        'Đã dọn hàng đợi',
        `Đã xóa ${results.filter((result) => result.status === 'fulfilled').length} dòng tiến trình; tệp đầu ra được giữ nguyên.`,
        'info'
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const removeOne = async (deleteOutput: boolean): Promise<void> => {
    if (!detailJob || ACTIVE.has(detailJob.status)) return;
    setBusy(`remove-${detailJob.id}`);
    try {
      const result = await window.desktop.queue.remove(detailJob.id, deleteOutput);
      await refreshJobs();
      setConfirm(null);
      setDetailId(null);
      notify(
        'Đã xóa tác vụ',
        result.outputDeleted
          ? 'Đã xóa dòng tiến trình và tệp đầu ra thuộc sở hữu của tác vụ.'
          : result.outputMissing
            ? 'Đã xóa dòng tiến trình; tệp đầu ra không còn tồn tại.'
            : 'Đã xóa dòng tiến trình và giữ nguyên tệp đầu ra.',
        deleteOutput ? 'warning' : 'info'
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const removeAll = async (): Promise<void> => {
    setBusy('remove-all');
    try {
      const result = await window.desktop.workbench.removeAll();
      await Promise.all([refreshJobs(), refreshProjects()]);
      setSelectedIds(new Set());
      setDetailId(null);
      setConfirm(null);
      notify(
        'Đã xóa dữ liệu hàng đợi',
        `Đã xóa ${result.jobsRemoved} tác vụ và ${result.projectsRemoved} khu vực làm việc. Video trên ổ đĩa được giữ nguyên.`,
        'warning'
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const toggleGlobal = async (): Promise<void> => {
    const allPaused = activeCount === 0 && pausedCount > 0;
    setBusy('global');
    try {
      if (allPaused) await window.desktop.queue.resumeAll();
      else await window.desktop.queue.pauseAll();
      await refreshJobs();
      notify(
        allPaused ? 'Đã tiếp tục tất cả' : 'Đã tạm dừng tất cả',
        'Lệnh áp dụng cho download, clip, normalize, merge và Quick Download đang được quản lý.',
        allPaused ? 'success' : 'warning'
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const toggleVisible = (): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) filtered.forEach((job) => next.delete(job.id));
      else filtered.forEach((job) => next.add(job.id));
      return next;
    });
  };

  const toggleSelected = (jobId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const toggleExpanded = (key: string): void => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="page-shell queue-studio-page">
      <div className="page-heading-row">
        <div>
          <h1 className="text-2xl font-black">Trung tâm tiến trình</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Mỗi danh sách là một workflow độc lập, chạy song song và có thể mở từng tiến trình con.
          </p>
        </div>
        <div className="queue-global-actions">
          <button
            className="btn"
            disabled={busy !== null || activeCount + pausedCount === 0}
            onClick={() => void toggleGlobal()}
          >
            {activeCount > 0 ? <Pause size={17} /> : <Play size={17} />}
            {activeCount > 0 ? 'Tạm dừng tất cả' : 'Tiếp tục tất cả'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => void refreshJobs()}>
            <RefreshCcw size={17} />
            Làm mới
          </button>
          <button
            className="btn btn-danger"
            disabled={busy !== null || jobs.length === 0}
            onClick={() => setConfirm('remove-all')}
          >
            <Trash2 size={17} />
            Xóa toàn bộ dữ liệu
          </button>
        </div>
      </div>

      <div className="queue-stat-strip mt-4">
        <div>
          <span>Workflow đang chạy</span>
          <b>{workflowGroups.filter((group) => group.running > 0).length + (quickIsActive ? 1 : 0)}</b>
        </div>
        <div>
          <span>Tác vụ hoạt động</span>
          <b>{activeCount}</b>
        </div>
        <div>
          <span>Đang tạm dừng</span>
          <b>{pausedCount}</b>
        </div>
        <div>
          <span>Cần xử lý lại</span>
          <b>{failedCount}</b>
        </div>
      </div>

      <div className="queue-studio-toolbar mt-4">
        <label className="queue-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm danh sách, tên video, URL, đầu ra hoặc lỗi..."
          />
        </label>
        <label className="queue-filter">
          <Filter size={15} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Mọi trạng thái</option>
            {[
              'pending',
              'analyzing',
              'downloading',
              'verifying',
              'normalizing',
              'processing',
              'merging',
              'paused',
              'retrying',
              'completed',
              'failed',
              'cancelled',
              'interrupted'
            ].map((value) => (
              <option value={value} key={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="all">Tất cả workflow</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className={`queue-bulk-bar ${selectedJobs.length ? 'is-visible' : ''}`}>
        <button className="btn btn-small" onClick={toggleVisible}>
          <CheckSquare size={15} />
          {allVisibleSelected ? 'Bỏ chọn kết quả' : 'Chọn tất cả kết quả'}
        </button>
        <b>{selectedJobs.length} tác vụ đã chọn</b>
        <button className="btn btn-small" disabled={busy !== null} onClick={() => void runBulk('pause')}>
          <Pause size={14} />
          Tạm dừng
        </button>
        <button className="btn btn-small" disabled={busy !== null} onClick={() => void runBulk('resume')}>
          <Play size={14} />
          Tiếp tục
        </button>
        <button className="btn btn-small" disabled={busy !== null} onClick={() => void runBulk('retry')}>
          <RotateCcw size={14} />
          Thử lại
        </button>
        <button
          className="btn btn-small btn-danger"
          disabled={busy !== null}
          onClick={() => setConfirm('cancel-selected')}
        >
          <Square size={14} />
          Hủy
        </button>
        <button
          className="btn btn-small btn-danger"
          disabled={busy !== null}
          onClick={() => setConfirm('remove-selected')}
        >
          <Trash2 size={14} />
          Xóa dòng
        </button>
        <button className="btn btn-ghost btn-small" onClick={() => setSelectedIds(new Set())}>
          <X size={14} />
          Bỏ chọn
        </button>
      </div>

      <div className={`queue-studio-layout mt-4 ${detailJob ? 'has-detail' : ''}`}>
        <section className="queue-workflow-stack" aria-label="Các workflow tiến trình">
          {mode !== 'processing' && quickStatus && (
            <QuickDownloadAccordion
              status={quickStatus}
              expanded={expandedKeys.has('quick-download')}
              busy={busy}
              onToggleExpanded={() => toggleExpanded('quick-download')}
              onControl={controlQuickDownload}
            />
          )}

          {workflowGroups.map((group) => {
            const groupBusy = busy?.startsWith(`group-${group.key}-`) ?? false;
            return (
              <WorkflowAccordion
                key={group.key}
                group={group}
                expanded={expandedKeys.has(group.key)}
                busy={busy}
                selectedIds={selectedIds}
                onToggleExpanded={() => toggleExpanded(group.key)}
                onToggleSelected={toggleSelected}
                onRunOne={runOne}
                onOpenDetail={setDetailId}
                onRemove={(jobId) => {
                  setDetailId(jobId);
                  setConfirm('remove-one');
                }}
                actions={
                  <>
                    {group.jobs.some((job) => ACTIVE.has(job.status)) && (
                      <button
                        className="btn btn-small"
                        disabled={busy !== null}
                        onClick={() => void runGroup('pause', group)}
                      >
                        <Pause size={14} />
                        Tạm dừng
                      </button>
                    )}
                    {group.jobs.some((job) => PAUSED.has(job.status)) && (
                      <button
                        className="btn btn-small btn-primary"
                        disabled={busy !== null}
                        onClick={() => void runGroup('resume', group)}
                      >
                        <Play size={14} />
                        Tiếp tục
                      </button>
                    )}
                    {group.jobs.some((job) => job.status === 'failed' || job.status === 'interrupted') && (
                      <button
                        className="btn btn-small"
                        disabled={busy !== null}
                        onClick={() => void runGroup('retry', group)}
                      >
                        <RotateCcw size={14} />
                        Thử lại lỗi
                      </button>
                    )}
                    {group.jobs.some((job) => ACTIVE.has(job.status) || PAUSED.has(job.status)) && (
                      <button
                        className="btn btn-small btn-danger"
                        disabled={busy !== null || groupBusy}
                        onClick={() => void runGroup('cancel', group)}
                      >
                        <Square size={14} />
                        Hủy workflow
                      </button>
                    )}
                  </>
                }
              />
            );
          })}

          {!quickStatus && workflowGroups.length === 0 && (
            <div className="queue-empty card">Không có workflow phù hợp với bộ lọc.</div>
          )}
        </section>

        {detailJob && (
          <aside className="card queue-detail-drawer">
            <button className="btn btn-ghost queue-detail-close" onClick={() => setDetailId(null)}>
              <X size={16} />
            </button>
            <span className="queue-detail-kicker">CHI TIẾT TÁC VỤ</span>
            <h2>{jobTitle(detailJob)}</h2>
            <StatusBadge status={detailJob.status} fixed />
            <dl>
              <div>
                <dt>Dự án</dt>
                <dd>{projectName(detailJob, projects)}</dd>
              </div>
              <div>
                <dt>Loại</dt>
                <dd>{jobTypeLabel(detailJob.type)}</dd>
              </div>
              <div>
                <dt>Tiến độ</dt>
                <dd>{detailJob.progress.toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Lần thử</dt>
                <dd>
                  {detailJob.attempts}/{detailJob.maxAttempts}
                </dd>
              </div>
              <div>
                <dt>Bắt đầu</dt>
                <dd>
                  {detailJob.startedAt
                    ? new Date(detailJob.startedAt).toLocaleString('vi-VN')
                    : 'Chưa bắt đầu'}
                </dd>
              </div>
              <div>
                <dt>Cập nhật</dt>
                <dd>{new Date(detailJob.updatedAt).toLocaleString('vi-VN')}</dd>
              </div>
            </dl>
            {detailJob.errorMessage && (() => {
              const issue = friendlyIssue(detailJob.errorMessage);
              return (
                <div className={`queue-detail-error queue-detail-${issue.tone}`}>
                  <b>{issue.title}</b>
                  <p>{issue.message}</p>
                  {issue.steps.length > 0 && (
                    <ol>
                      {issue.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                </div>
              );
            })()}
            {!ACTIVE.has(detailJob.status) && (
              <button className="btn btn-danger" title="Xóa tác vụ" onClick={() => setConfirm('remove-one')}>
                <Trash2 size={15} />
                Xóa tác vụ
              </button>
            )}
            <section className="queue-detail-result">
              <b>Thông tin tác vụ</b>
              <dl>
                {inputText(detailJob, 'url') && (
                  <div>
                    <dt>Nguồn</dt>
                    <dd title={inputText(detailJob, 'url')}>{inputText(detailJob, 'displayName') || inputText(detailJob, 'url')}</dd>
                  </div>
                )}
                {inputText(detailJob, 'progressStage') && (
                  <div>
                    <dt>Trạng thái</dt>
                    <dd>{safeUiText(inputText(detailJob, 'progressStage'), 'Đang cập nhật trạng thái.')}</dd>
                  </div>
                )}
                {inputText(detailJob, 'outputPath') && (
                  <div>
                    <dt>Tệp đầu ra</dt>
                    <dd title={inputText(detailJob, 'outputPath')}>{inputText(detailJob, 'outputPath')}</dd>
                  </div>
                )}
                {inputText(detailJob, 'resultMessage') && (
                  <div>
                    <dt>Kết quả</dt>
                    <dd>{safeUiText(inputText(detailJob, 'resultMessage'), 'Tác vụ đã hoàn tất.')}</dd>
                  </div>
                )}
              </dl>
            </section>
          </aside>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'cancel-selected'}
        title="Hủy các tác vụ đã chọn?"
        message="ProcessManager sẽ dừng cây tiến trình thật của từng tác vụ trước khi cập nhật trạng thái."
        details={[
          'Không xóa tệp đầu ra đã hoàn tất.',
          'Tệp tạm chỉ được dọn trong phạm vi sở hữu của tác vụ.',
          'Tác vụ không còn hoạt động sẽ được bỏ qua.'
        ]}
        confirmLabel="Hủy tác vụ đã chọn"
        danger
        busy={busy === 'bulk-cancel'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runBulk('cancel')}
      />
      <ConfirmDialog
        open={confirm === 'remove-one'}
        title="Xóa tác vụ này?"
        message="Bạn có thể chỉ xóa dữ liệu khỏi danh sách hoặc xóa cả tệp đầu ra khi ownership đã được backend xác minh."
        details={[
          'Tác vụ đang chạy không thể bị xóa.',
          'Không xóa source dùng chung hoặc tệp ngoài thư mục được quản lý.',
          'Khi ownership không khớp, backend chỉ xóa record và giữ tệp.'
        ]}
        confirmLabel="Chỉ xóa khỏi danh sách"
        secondaryLabel="Xóa khỏi danh sách và xóa tệp"
        secondaryDanger
        danger
        busy={Boolean(detailJob && busy === `remove-${detailJob.id}`)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void removeOne(false)}
        onSecondary={() => void removeOne(true)}
      />
      <ConfirmDialog
        open={confirm === 'remove-selected'}
        title="Xóa các dòng đã chọn?"
        message="Chỉ xóa dữ liệu tiến trình; tệp video và thành phẩm trên ổ đĩa được giữ nguyên."
        details={[
          'Tác vụ đang chạy không bị xóa.',
          'Thay đổi được ghi bền vững và không xuất hiện lại sau khi mở ứng dụng.'
        ]}
        confirmLabel="Xóa khỏi hàng đợi"
        danger
        busy={busy === 'remove-selected'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void removeSelected()}
      />
      <ConfirmDialog
        open={confirm === 'remove-all'}
        title="Xóa toàn bộ dữ liệu danh sách và workflow?"
        message="Thao tác xóa mọi khu vực làm việc và dòng tiến trình khỏi cơ sở dữ liệu ứng dụng."
        details={[
          'Video, source cache và thành phẩm trên ổ đĩa không bị xóa.',
          'Không thể hoàn tác dữ liệu dự án sau khi xác nhận.'
        ]}
        confirmLabel="Xóa toàn bộ dữ liệu ứng dụng"
        danger
        busy={busy === 'remove-all'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void removeAll()}
      />
    </div>
  );
}
