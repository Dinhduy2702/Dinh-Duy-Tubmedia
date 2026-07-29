import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Cookie,
  Cpu,
  FileText,
  FolderOpen,
  Gauge,
  ListPlus,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Trash2
} from 'lucide-react';
import type {
  AppSettings,
  DownloadLaneId,
  HardwareProfile,
  LogEntry,
  QueueJob,
  ResourceProfile,
  WorkbenchSlot,
  WorkbenchSlotState
} from '@shared/types/domain';
import { planForListCount, recommendDownloadConcurrency } from '@shared/utils/hardware-recommendation';
import { shouldShowInlineBlockingIssue } from '@shared/utils/notification-policy';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CookieManagerDialog } from '../components/CookieManagerDialog';
import { InfoDisclosure } from '../components/InfoDisclosure';
import { ToolReadinessPanel } from '../components/ToolReadinessPanel';
import { FolderField } from '../components/FolderField';
import { StatusBadge } from '../components/StatusBadge';
import { CompactLogRow } from '../components/CompactLogRow';
import { useAppStore } from '../stores/app-store';
import { createUiEventId } from '../utils/ui-id';
import { loadWorkbenchPath, saveWorkbenchPath } from '../utils/workbench-path-memory';
import { friendlyIssue } from '../utils/ui-error';
import { statusLabel } from '../utils/vi-labels';
import { QuickDownloadPanel } from '../components/QuickDownloadPanel';

interface LaneForm {
  name: string;
  linksText: string;
  outputFolder: string;
  tempFolder: string;
  resourceProfileId: string;
  downloadWorkers: number;
}

type LaneMap<T> = Record<DownloadLaneId, T>;
const LANE_IDS: DownloadLaneId[] = ['download-1', 'download-2', 'download-3', 'download-4'];
const ACTIVE = [
  'pending',
  'analyzing',
  'downloading',
  'retrying',
  'normalizing',
  'processing',
  'verifying',
  'merging'
];
const BLOCKING_CODES = [
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED',
  'TOOL_NOT_FOUND',
  'TOOL_HEALTH_CHECK_FAILED',
  'DISK_FULL',
  'PERMISSION_DENIED',
  'NETWORK_CIRCUIT_OPEN'
] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function laneNumber(slot: DownloadLaneId): number {
  return Number(slot.slice('download-'.length));
}
function clampWorker(value: number): number {
  return Math.max(1, Math.min(16, Math.round(value || 1)));
}
function clampCount(value: number): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(4, Math.round(value || 1))) as 1 | 2 | 3 | 4;
}
function childFolder(base: string, name: string): string {
  return base ? `${base.replace(/[\\/]+$/, '')}\\${name}` : '';
}
function profileById(resources: ResourceProfile[], id: string): ResourceProfile | undefined {
  return resources.find((profile) => profile.id === id);
}
function mapOf<T>(factory: (slot: DownloadLaneId) => T): LaneMap<T> {
  return Object.fromEntries(LANE_IDS.map((slot) => [slot, factory(slot)])) as LaneMap<T>;
}
function emptyLane(
  slot: DownloadLaneId,
  profile: ResourceProfile | undefined,
  settings: AppSettings | null
): LaneForm {
  const number = laneNumber(slot);
  const rememberedOutput = loadWorkbenchPath('download-output');
  const rememberedTemp = loadWorkbenchPath('download-temp');
  return {
    name: `Danh sách tải ${number}`,
    linksText: '',
    outputFolder: rememberedOutput ?? childFolder(settings?.defaultOutputFolder ?? '', `Danh_sach_${number}`),
    tempFolder: rememberedTemp ?? childFolder(settings?.defaultTempFolder ?? '', `Danh_sach_${number}`),
    resourceProfileId: profile?.id ?? 'resource-balanced',
    downloadWorkers: profile?.downloadWorkers ?? 2
  };
}
function qualityLabel(settings: AppSettings | null): string {
  if (!settings) return 'Chưa đọc cấu hình';
  if (settings.downloadCompatibilityMode === 'capcut_sdr_1080p') {
    return 'CapCut trực tiếp · SDR 1080p · H.264/AAC · không Proxy';
  }
  if (settings.downloadCompatibilityMode === 'capcut_sdr_2k') {
    return 'CapCut trực tiếp · SDR 1080p–2K · H.264/AAC · không Proxy';
  }
  if (
    settings.downloadCompatibilityMode === 'source' &&
    settings.downloadMinHeight === 720 &&
    settings.downloadMaxHeight === 1080 &&
    settings.downloadCodecPreference === 'h264' &&
    settings.downloadContainerPreference === 'mp4' &&
    settings.downloadAllowBelowMinimum
  ) {
    return 'Đa nền tảng 720p–1080p · H.264/MP4 · KHUYÊN DÙNG';
  }
  const min = settings.downloadMinHeight > 0 ? `${settings.downloadMinHeight}p` : 'không giới hạn tối thiểu';
  const max = settings.downloadMaxHeight > 0 ? `${settings.downloadMaxHeight}p` : 'cao nhất theo nguồn';
  const verification = settings.downloadVerifyEntireFile
    ? 'kiểm tra chuyên sâu'
    : ({ fast: 'kiểm tra nhanh', standard: 'kiểm tra tiêu chuẩn', deep: 'kiểm tra chuyên sâu' } as const)[
        settings.verificationLevel
      ];
  return `${min} → ${max} · tối đa ${settings.downloadMaxFps || 'FPS nguồn'} FPS · ${settings.downloadCodecPreference.toUpperCase()} · ${verification}`;
}
function workflowState(jobs: QueueJob[]): 'idle' | 'running' | 'paused' | 'failed' | 'completed' {
  if (jobs.some((job) => ACTIVE.includes(job.status))) return 'running';
  if (jobs.some((job) => job.status === 'paused' || job.status === 'interrupted')) return 'paused';
  if (jobs.some((job) => job.status === 'failed')) return 'failed';
  if (jobs.length > 0 && jobs.every((job) => ['completed', 'skipped', 'cancelled'].includes(job.status)))
    return 'completed';
  return 'idle';
}

export function DownloadWorkbenchPage(): React.JSX.Element {
  const resources = useAppStore((state) => state.resources);
  const settings = useAppStore((state) => state.settings);
  const hardware = useAppStore((state) => state.hardware);
  const jobs = useAppStore((state) => state.jobs);
  const logs = useAppStore((state) => state.logs);
  const setSettings = useAppStore((state) => state.setSettings);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const clearProjectLogs = useAppStore((state) => state.clearProjectLogs);
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const refreshProjects = useAppStore((state) => state.refreshProjects);

  const defaultProfile = profileById(resources, settings?.defaultResourceProfileId ?? '') ?? resources[0];
  const [forms, setForms] = useState<LaneMap<LaneForm>>(() =>
    mapOf((slot) => emptyLane(slot, defaultProfile, settings))
  );
  const [states, setStates] = useState<LaneMap<WorkbenchSlotState | null>>(() => mapOf(() => null));
  const [busy, setBusy] = useState<WorkbenchSlot | 'global' | null>(null);
  const [recommendBusy, setRecommendBusy] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieTarget, setCookieTarget] = useState<DownloadLaneId | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DownloadLaneId | null>(null);
  const [activeLane, setActiveLane] = useState<DownloadLaneId>('download-1');
  const initializedRef = useRef(false);
  const dirtySlotsRef = useRef<Set<DownloadLaneId>>(new Set());
  const deletedSlotsRef = useRef<Set<DownloadLaneId>>(new Set());
  const revisionRef = useRef<LaneMap<number>>(mapOf(() => 0));
  const laneCount = settings?.downloadLaneCount ?? 2;

  useEffect(() => {
    const snapshot = useAppStore.getState();
    const fallback =
      profileById(snapshot.resources, snapshot.settings?.defaultResourceProfileId ?? '') ??
      snapshot.resources[0];
    void window.desktop.workbench
      .state()
      .then((workbench) => {
        const firstProject = workbench.downloadLanes.find((lane) => lane.project)?.project;
        if (firstProject) {
          if (!loadWorkbenchPath('download-output'))
            saveWorkbenchPath('download-output', firstProject.sourceFolder);
          if (!loadWorkbenchPath('download-temp'))
            saveWorkbenchPath('download-temp', firstProject.tempFolder);
        }
        const nextStates = mapOf<WorkbenchSlotState | null>(() => null);
        const nextForms = mapOf((slot) => emptyLane(slot, fallback, snapshot.settings));
        for (const current of workbench.downloadLanes) {
          const slot = current.slot as DownloadLaneId;
          if (!LANE_IDS.includes(slot)) continue;
          nextStates[slot] = current;
          if (current.project) {
            const profile = profileById(snapshot.resources, current.project.resourceProfileId);
            nextForms[slot] = {
              name: current.project.name,
              linksText: current.items.map((item) => item.originalText).join('\n'),
              outputFolder: current.project.sourceFolder,
              tempFolder: current.project.tempFolder,
              resourceProfileId: current.project.resourceProfileId,
              downloadWorkers: profile?.downloadWorkers ?? fallback?.downloadWorkers ?? 2
            };
          }
        }
        setStates(nextStates);
        setForms(nextForms);
        initializedRef.current = true;
      })
      .catch((error: unknown) => setError(messageOf(error)));
  }, [setError]);

  const notify = (
    title: string,
    message: string,
    severity: 'info' | 'success' | 'warning' = 'success'
  ): void => {
    setAttention({ id: createUiEventId('action'), severity, title, message });
  };

  const updateForm = (slot: DownloadLaneId, update: (current: LaneForm) => LaneForm): void => {
    deletedSlotsRef.current.delete(slot);
    dirtySlotsRef.current.add(slot);
    revisionRef.current[slot] += 1;
    setForms((current) => ({ ...current, [slot]: update(current[slot]) }));
  };

  useEffect(() => {
    if (!initializedRef.current || dirtySlotsRef.current.size === 0) return;
    const timer = window.setTimeout(() => {
      const pending = [...dirtySlotsRef.current].map((slot) => ({
        slot,
        revision: revisionRef.current[slot]
      }));
      void Promise.all(
        pending.map(async ({ slot, revision }) => {
          if (deletedSlotsRef.current.has(slot)) return;
          const projectId = states[slot]?.project?.id;
          const currentState = projectId
            ? workflowState(jobs.filter((job) => job.projectId === projectId))
            : 'idle';
          if (currentState === 'running' || currentState === 'paused') return;
          const form = forms[slot];
          const next = await window.desktop.workbench.saveDownloadDraft({
            slot,
            name: form.name,
            linksText: form.linksText,
            outputFolder: form.outputFolder,
            tempFolder: form.tempFolder,
            resourceProfileId: form.resourceProfileId,
            downloadWorkers: clampWorker(form.downloadWorkers)
          });
          if (revisionRef.current[slot] === revision) {
            dirtySlotsRef.current.delete(slot);
          }
          setStates((current) => ({ ...current, [slot]: next }));
        })
      )
        .then(() => refreshProjects())
        .catch((error: unknown) => setError(messageOf(error)));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [forms, jobs, refreshProjects, setError, states]);

  const saveProfile = async (slot: DownloadLaneId): Promise<ResourceProfile> => {
    const form = forms[slot];
    const base = profileById(resources, form.resourceProfileId) ?? defaultProfile;
    if (!base) throw new Error('Không có cấu hình tài nguyên để chạy danh sách.');
    const workers = clampWorker(form.downloadWorkers);
    const saved = await window.desktop.settings.saveResourceProfile({
      ...base,
      id: `resource-${slot}-custom`,
      name: `Danh sách ${laneNumber(slot)} · ${workers} luồng tải`,
      description: `Cấu hình riêng của danh sách ${laneNumber(slot)}; không ảnh hưởng hàng đợi của danh sách khác.`,
      downloadWorkers: workers,
      builtIn: false
    });
    useAppStore.setState((current) => ({
      resources: [...current.resources.filter((item) => item.id !== saved.id), saved]
    }));
    return saved;
  };

  const start = async (slot: DownloadLaneId): Promise<void> => {
    setBusy(slot);
    try {
      const profile = await saveProfile(slot);
      const form = forms[slot];
      const next = await window.desktop.workbench.startDownload({
        slot,
        name: form.name,
        linksText: form.linksText,
        outputFolder: form.outputFolder,
        tempFolder: form.tempFolder,
        resourceProfileId: profile.id
      });
      setStates((current) => ({ ...current, [slot]: next }));
      await Promise.all([refreshJobs(), refreshProjects()]);
      notify(
        `Danh sách ${laneNumber(slot)} đã bắt đầu`,
        `${profile.downloadWorkers} video tối đa trong danh sách này; toàn ứng dụng không vượt ${settings?.maxGlobalDownloadWorkers ?? 4} video tải đồng thời.`
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const control = async (slot: DownloadLaneId, action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
    setBusy(slot);
    try {
      const next = await window.desktop.workbench[action](slot);
      setStates((current) => ({ ...current, [slot]: next }));
      await refreshJobs();
      const label = action === 'pause' ? 'đã tạm dừng' : action === 'resume' ? 'đã tiếp tục' : 'đã hủy';
      notify(
        `Danh sách ${laneNumber(slot)} ${label}`,
        action === 'pause'
          ? 'Các tiến trình của danh sách khác không bị ảnh hưởng.'
          : `Thao tác chỉ áp dụng cho danh sách ${laneNumber(slot)}.`,
        action === 'cancel' ? 'warning' : 'success'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const clearProgress = async (slot: DownloadLaneId): Promise<void> => {
    setBusy(slot);
    try {
      const next = await window.desktop.workbench.clearProgress(slot);
      setStates((current) => ({ ...current, [slot]: next }));
      await refreshJobs();
      notify(
        `Đã dọn tiến trình danh sách ${laneNumber(slot)}`,
        'Các hàng tiến trình cũ đã được xóa; link và cài đặt danh sách vẫn giữ nguyên.',
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const clearLogs = async (slot: DownloadLaneId, projectId?: string): Promise<void> => {
    setBusy(slot);
    try {
      const next = await window.desktop.workbench.clearLogs(slot);
      setStates((current) => ({ ...current, [slot]: next }));
      if (projectId) clearProjectLogs(projectId);
      notify(
        `Đã dọn nhật ký danh sách ${laneNumber(slot)}`,
        'Nhật ký của các danh sách khác được giữ nguyên.',
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const retryFailed = async (slot: DownloadLaneId, projectId?: string): Promise<void> => {
    if (!projectId) return;
    setBusy(slot);
    try {
      const count = await window.desktop.queue.retryFailed(projectId);
      await refreshJobs();
      notify(
        `Thử lại danh sách ${laneNumber(slot)}`,
        count > 0 ? `Đã đưa ${count} tác vụ về hàng chờ.` : 'Không có tác vụ lỗi cần thử lại.',
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const removeLane = async (slot: DownloadLaneId): Promise<void> => {
    setBusy(slot);
    deletedSlotsRef.current.add(slot);
    dirtySlotsRef.current.delete(slot);
    revisionRef.current[slot] += 1;
    try {
      const previousProjectId = states[slot]?.project?.id;
      const next = await window.desktop.workbench.remove(slot);
      setStates((current) => ({ ...current, [slot]: next }));
      setForms((current) => ({ ...current, [slot]: emptyLane(slot, defaultProfile, settings) }));
      if (previousProjectId) clearProjectLogs(previousProjectId);
      await Promise.all([refreshJobs(), refreshProjects()]);
      notify(
        `Đã xóa danh sách ${laneNumber(slot)}`,
        'Hàng đợi, tiến trình, liên kết và nhật ký của danh sách đã được dọn. Video đã tải trong thư mục lưu không bị xóa.',
        'info'
      );
      setDeleteTarget(null);
    } catch (error) {
      deletedSlotsRef.current.delete(slot);
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const openCookies = (slot: DownloadLaneId | null): void => {
    setCookieTarget(slot);
    setCookieOpen(true);
  };

  const resumeAfterCookie = async (): Promise<void> => {
    if (!cookieTarget) return;
    const workbench = await window.desktop.workbench.state();
    const next = workbench.downloadLanes.find((lane) => lane.slot === cookieTarget) ?? null;
    setStates((current) => ({ ...current, [cookieTarget]: next }));
    await refreshJobs();
  };

  const changeLaneCount = async (value: number): Promise<void> => {
    const nextCount = clampCount(value);
    if (nextCount < laneCount) {
      const hiddenRunning = LANE_IDS.slice(nextCount).some((slot) => {
        const projectId = states[slot]?.project?.id;
        return projectId
          ? workflowState(jobs.filter((job) => job.projectId === projectId)) === 'running'
          : false;
      });
      if (hiddenRunning) {
        setError('Một danh sách sắp bị ẩn vẫn đang chạy. Hãy tạm dừng hoặc hủy riêng danh sách đó trước.');
        return;
      }
    }
    setBusy('global');
    try {
      if (nextCount > laneCount) {
        const source = forms[activeLane] ?? forms[LANE_IDS[Math.max(0, laneCount - 1)]!];
        const target = LANE_IDS[laneCount]!;
        const rememberedOutput = loadWorkbenchPath('download-output') ?? source.outputFolder;
        const rememberedTemp = loadWorkbenchPath('download-temp') ?? source.tempFolder;
        setForms((current) => ({
          ...current,
          [target]: {
            ...current[target],
            outputFolder: rememberedOutput,
            tempFolder: rememberedTemp,
            resourceProfileId: source.resourceProfileId,
            downloadWorkers: source.downloadWorkers
          }
        }));
        setActiveLane(target);
      } else if (laneNumber(activeLane) > nextCount) {
        setActiveLane(LANE_IDS[nextCount - 1]!);
      }
      const nextSettings = await window.desktop.settings.update({ downloadLaneCount: nextCount });
      setSettings(nextSettings);
      notify(
        'Đã thay đổi số danh sách',
        `Hiện có ${nextCount} danh sách tải độc lập. Dữ liệu của danh sách bị ẩn vẫn được giữ.`,
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const applyRecommendation = async (): Promise<void> => {
    setRecommendBusy(true);
    try {
      const detected = await window.desktop.settings.hardware();
      const recommendation = recommendDownloadConcurrency(detected);
      const plan = planForListCount(recommendation, laneCount, settings?.downloadVerifyEntireFile ?? false);
      const base = await window.desktop.settings.recommend();
      const saved = await window.desktop.settings.saveResourceProfile({
        ...base,
        downloadWorkers: plan.workersPerList,
        builtIn: false
      });
      const nextSettings = await window.desktop.settings.update({
        defaultResourceProfileId: saved.id,
        maxGlobalDownloadWorkers: plan.globalWorkers,
        downloadConcurrentFragments: recommendation.recommendedConcurrentFragments,
        aria2Connections: recommendation.recommendedAria2Connections
      });
      useAppStore.setState((current) => ({
        hardware: detected,
        settings: nextSettings,
        resources: [...current.resources.filter((item) => item.id !== saved.id), saved]
      }));
      LANE_IDS.forEach((slot) => {
        dirtySlotsRef.current.add(slot);
        revisionRef.current[slot] += 1;
      });
      setForms((current) =>
        mapOf((slot) => ({
          ...current[slot],
          resourceProfileId: saved.id,
          downloadWorkers: plan.workersPerList
        }))
      );
      notify(
        'Đã áp dụng cấu hình khuyến nghị',
        `${laneCount} danh sách · ${plan.workersPerList} luồng tải mỗi danh sách · ${plan.globalWorkers} luồng tải toàn ứng dụng.`
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setRecommendBusy(false);
    }
  };

  const applyReferenceQuality = async (): Promise<void> => {
    try {
      const next = await window.desktop.settings.update({
        downloadCompatibilityMode: 'source',
        downloadMinHeight: 720,
        downloadMaxHeight: 1080,
        downloadMinFps: 0,
        downloadMaxFps: 0,
        downloadCodecPreference: 'h264',
        downloadContainerPreference: 'mp4',
        downloadMinVideoBitrateKbps: 0,
        downloadVideoBitrateKbps: 0,
        downloadMinAudioBitrateKbps: 0,
        downloadAudioBitrateKbps: 0,
        downloadAllowBelowMinimum: true,
        useAria2c: true,
        aria2Connections: 16,
        downloadConcurrentFragments: 2,
        maxGlobalDownloadWorkers: 2
      });
      setSettings(next);
      notify(
        'Đã áp dụng chuẩn đa nền tảng 1080p',
        'H.264/MP4, 720p–1080p, fallback thông minh, aria2c 16 kết nối, 2 fragment và tối đa 2 video tải đồng thời toàn ứng dụng.'
      );
    } catch (error) {
      setError(messageOf(error));
    }
  };

  return (
    <div className="page-shell">
      <QuickDownloadPanel />
      <header className="page-heading">
        <div>
          <h1>Tải danh sách đa nền tảng</h1>
          <p>Nhiều danh sách độc lập, bỏ qua theo link và kiểm tra tệp trước khi hoàn tất.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={busy === 'global' || laneCount <= 1}
            onClick={() => void changeLaneCount(laneCount - 1)}
          >
            <Minus size={16} />
            Bớt danh sách
          </button>
          <div className="badge badge-strong">
            <ListPlus size={15} />
            {laneCount}/4 danh sách
          </div>
          <button
            className="btn btn-primary"
            disabled={busy === 'global' || laneCount >= 4}
            onClick={() => void changeLaneCount(laneCount + 1)}
          >
            <Plus size={16} />
            Thêm danh sách
          </button>
        </div>
      </header>

      <div className="workflow-utility-stack mt-4">
        <ToolReadinessPanel workflow="download" />
        <PreflightPanel
          hardware={hardware}
          settings={settings}
          laneCount={laneCount}
          recommendBusy={recommendBusy}
          onRecommend={applyRecommendation}
          onReferenceQuality={applyReferenceQuality}
          onCookies={() => openCookies(null)}
        />
      </div>

      <nav className="workflow-tabs mt-4" aria-label="Danh sách tải">
        {LANE_IDS.slice(0, laneCount).map((slot) => {
          const projectId = states[slot]?.project?.id;
          const laneJobs = projectId ? jobs.filter((job) => job.projectId === projectId) : [];
          const laneState = workflowState(laneJobs);
          return (
            <button
              key={slot}
              className={`workflow-tab workflow-state-${laneState} ${activeLane === slot ? 'is-active' : ''}`}
              onClick={() => setActiveLane(slot)}
            >
              <b>{forms[slot].name || `Danh sách ${laneNumber(slot)}`}</b>
              <span>
                {laneState === 'running'
                  ? 'Đang tải'
                  : laneState === 'completed'
                    ? 'Hoàn tất'
                    : laneState === 'failed'
                      ? 'Có lỗi'
                      : laneState === 'paused'
                        ? 'Tạm dừng'
                        : 'Sẵn sàng'}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="lane-grid lane-grid-single mt-4">
        {LANE_IDS.slice(0, laneCount)
          .filter((slot) => slot === activeLane)
          .map((slot) => {
            const projectId = states[slot]?.project?.id;
            return (
              <LaneCard
                key={slot}
                slot={slot}
                form={forms[slot]}
                update={(updater) => updateForm(slot, updater)}
                resources={resources}
                settings={settings}
                jobs={projectId ? jobs.filter((job) => job.projectId === projectId) : []}
                logs={projectId ? logs.filter((entry) => entry.projectId === projectId) : []}
                {...(projectId ? { projectId } : {})}
                busy={busy === slot}
                onStart={() => start(slot)}
                onControl={(action) => control(slot, action)}
                onRetry={() => retryFailed(slot, projectId)}
                onClearProgress={() => clearProgress(slot)}
                onClearLogs={() => clearLogs(slot, projectId)}
                onDelete={() => setDeleteTarget(slot)}
                onCookies={() => openCookies(slot)}
                onNotice={notify}
                setError={setError}
              />
            );
          })}
      </div>

      <CookieManagerDialog
        open={cookieOpen}
        onClose={() => setCookieOpen(false)}
        onConfigured={resumeAfterCookie}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Xóa danh sách ${laneNumber(deleteTarget)}?` : 'Xóa danh sách?'}
        message="Ứng dụng sẽ hủy tiến trình nền của danh sách này, xóa hàng đợi, liên kết và nhật ký khỏi ứng dụng."
        details={[
          'Các danh sách khác không bị ảnh hưởng.',
          'Video đã tải trong thư mục lưu vẫn được giữ nguyên.',
          'Thao tác này không thể hoàn tác trong ứng dụng.'
        ]}
        confirmLabel="Xóa danh sách"
        danger
        busy={deleteTarget !== null && busy === deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void removeLane(deleteTarget);
        }}
      />
    </div>
  );
}

function PreflightPanel({
  hardware,
  settings,
  laneCount,
  recommendBusy,
  onRecommend,
  onReferenceQuality,
  onCookies
}: {
  hardware: HardwareProfile | null;
  settings: AppSettings | null;
  laneCount: 1 | 2 | 3 | 4;
  recommendBusy: boolean;
  onRecommend: () => Promise<void>;
  onReferenceQuality: () => Promise<void>;
  onCookies: () => void;
}): React.JSX.Element {
  const recommendation = hardware ? recommendDownloadConcurrency(hardware) : null;
  const plan = recommendation
    ? planForListCount(recommendation, laneCount, settings?.downloadVerifyEntireFile ?? false)
    : null;
  return (
    <InfoDisclosure
      className="preflight-disclosure"
      icon={Gauge}
      title="Thiết lập tải đang dùng"
      summary={qualityLabel(settings)}
      status={plan ? `${plan.workersPerList}/danh sách · ${plan.globalWorkers} tổng` : 'Đang nhận diện máy'}
      tone="info"
      actions={
        <>
          <button
            className="icon-action"
            title="Thiết lập cookies"
            aria-label="Thiết lập cookies"
            onClick={onCookies}
          >
            <Cookie size={16} />
          </button>
          <button className="btn btn-small" onClick={() => void onReferenceQuality()}>
            <Settings2 size={15} />
            Chuẩn 1080p
          </button>
          <button
            className="btn btn-small btn-primary"
            disabled={recommendBusy}
            onClick={() => void onRecommend()}
          >
            {recommendBusy ? <LoaderCircle className="animate-spin" size={15} /> : <Cpu size={15} />}Theo máy
          </button>
        </>
      }
    >
      <div className="preflight-grid">
        <Metric title="Chất lượng tải" value={qualityLabel(settings)} />
        <Metric
          title="Cookies"
          value={
            settings && settings.cookiesBrowser !== 'none'
              ? `Đã lưu ${settings.cookiesBrowser} · chỉ dùng khi video yêu cầu`
              : settings?.cookiesFilePath
                ? 'Đã lưu tệp · chỉ dùng khi video yêu cầu'
                : 'Không dùng trước khi video yêu cầu'
          }
        />
        <Metric
          title="Khuyến nghị"
          value={
            plan
              ? `${plan.workersPerList} luồng tải/danh sách · ${plan.globalWorkers} tổng`
              : 'Chưa đọc cấu hình máy'
          }
        />
      </div>
      {recommendation && plan && (
        <div className="recommend-strip">
          <b>{recommendation.summary}</b> {plan.note}
        </div>
      )}
    </InfoDisclosure>
  );
}

function Metric({ title, value, good }: { title: string; value: string; good?: boolean }): React.JSX.Element {
  return (
    <div className="metric">
      <span>{title}</span>
      <b style={good === undefined ? undefined : { color: good ? 'var(--good)' : 'var(--bad)' }}>{value}</b>
    </div>
  );
}

function LaneCard({
  slot,
  form,
  update,
  resources,
  settings,
  jobs,
  logs,
  projectId,
  busy,
  onStart,
  onControl,
  onRetry,
  onClearProgress,
  onClearLogs,
  onDelete,
  onCookies,
  onNotice,
  setError
}: {
  slot: DownloadLaneId;
  form: LaneForm;
  update: (updater: (current: LaneForm) => LaneForm) => void;
  resources: ResourceProfile[];
  settings: AppSettings | null;
  jobs: QueueJob[];
  logs: LogEntry[];
  projectId?: string;
  busy: boolean;
  onStart: () => Promise<void>;
  onControl: (action: 'pause' | 'resume' | 'cancel') => Promise<void>;
  onRetry: () => Promise<void>;
  onClearProgress: () => Promise<void>;
  onClearLogs: () => Promise<void>;
  onDelete: () => void;
  onCookies: () => void;
  onNotice: (title: string, message: string, severity?: 'info' | 'success' | 'warning') => void;
  setError: (error: string | null) => void;
}): React.JSX.Element {
  const [showLogs, setShowLogs] = useState(false);
  const [persisted, setPersisted] = useState<LogEntry[]>([]);
  const state = workflowState(jobs);
  const number = laneNumber(slot);
  const completed = jobs.filter((job) => ['completed', 'skipped'].includes(job.status)).length;
  const skipped = jobs.filter((job) => job.status === 'skipped').length;
  const failed = jobs.filter((job) => job.status === 'failed');
  const blocking = jobs.find((job) => shouldShowInlineBlockingIssue(job, BLOCKING_CODES));
  const progress = jobs.length ? jobs.reduce((sum, job) => sum + job.progress, 0) / jobs.length : 0;
  const activeJob = jobs.find((job) => ACTIVE.includes(job.status));
  const progressDetail = activeJob
    ? [skipped > 0 ? `${skipped} video đã tải trước đó` : null, activeJob.speed ?? 'Đang tải phần còn lại']
        .filter(Boolean)
        .join(' · ')
    : failed.length > 0
      ? `${failed.length} lỗi`
      : skipped > 0
        ? `${skipped} video đã tải trước đó – đã bỏ qua`
        : completed > 0
          ? `${completed} video mới đã hoàn tất`
          : 'Chưa có tác vụ';

  useEffect(() => {
    if (!projectId || !showLogs) return;
    void window.desktop.logs
      .list({ projectId, limit: 500 })
      .then(setPersisted)
      .catch((error: unknown) => setError(messageOf(error)));
  }, [projectId, setError, showLogs]);

  const combinedLogs = useMemo(() => {
    const byId = new Map<string, LogEntry>();
    for (const entry of [...logs, ...persisted]) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [logs, persisted]);

  const paste = async (): Promise<void> => {
    try {
      const text = await window.desktop.app.readClipboard();
      if (text) {
        update((current) => ({ ...current, linksText: text }));
        onNotice(
          `Đã dán vào danh sách ${number}`,
          `${text.split(/\r?\n/).filter((line) => line.trim()).length} dòng được nhập.`,
          'info'
        );
      }
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const importText = async (): Promise<void> => {
    try {
      const file = await window.desktop.dialogs.chooseTextFile();
      if (file) {
        update((current) => ({ ...current, linksText: file.text }));
        onNotice(`Đã nhập TXT vào danh sách ${number}`, `Đã đọc danh sách từ ${file.path}.`, 'info');
      }
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const openOutput = async (): Promise<void> => {
    try {
      await window.desktop.app.showPath(form.outputFolder);
      onNotice(`Đã mở thư mục danh sách ${number}`, form.outputFolder, 'info');
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const selectProfile = (id: string): void => {
    const profile = profileById(resources, id);
    update((current) => ({
      ...current,
      resourceProfileId: id,
      downloadWorkers: profile?.downloadWorkers ?? current.downloadWorkers
    }));
  };

  const primary =
    state === 'running'
      ? { label: 'Tạm dừng danh sách', icon: Pause, action: () => onControl('pause') }
      : state === 'paused'
        ? { label: 'Tiếp tục danh sách', icon: RotateCcw, action: () => onControl('resume') }
        : { label: failed.length > 0 ? 'Chạy lại danh sách' : 'Bắt đầu tải', icon: Play, action: onStart };
  const PrimaryIcon = primary.icon;
  const canStart = Boolean(form.linksText.trim() && form.outputFolder && form.tempFolder);
  const locked = state === 'running' || state === 'paused' || busy;

  return (
    <section className={`lane-card lane-state-${state}`}>
      <header className="lane-header">
        <div className="lane-title">Danh sách {number}</div>
        <div className="flex items-center gap-2">
          {state === 'running' && (
            <span className="live-indicator">
              <i />
              ĐANG TẢI
            </span>
          )}
          <StatusBadge status={state === 'running' ? 'downloading' : state} />
        </div>
      </header>
      <div className="lane-body">
        {blocking && <FriendlyBlockingCard job={blocking} onCookies={onCookies} />}
        <label>
          <span className="label">Tên danh sách</span>
          <input
            className="input"
            disabled={locked}
            value={form.name}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              update((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <div>
          <div className="field-heading">
            <span className="label mb-0">Danh sách link</span>
            <div className="flex gap-2">
              <button className="btn btn-small" disabled={locked} onClick={() => void paste()}>
                <ClipboardPaste size={14} />
                Dán
              </button>
              <button className="btn btn-small" disabled={locked} onClick={() => void importText()}>
                <FileText size={14} />
                TXT
              </button>
            </div>
          </div>
          <textarea
            className="textarea lane-textarea font-mono text-xs"
            disabled={locked}
            value={form.linksText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              update((current) => ({ ...current, linksText: event.target.value }))
            }
            placeholder="Mỗi dòng một link..."
          />
          <div className="field-hint">
            {form.linksText.split(/\r?\n/).filter((line) => line.trim()).length} dòng có nội dung
          </div>
        </div>
        <div className="compact-config-grid download-config-grid">
          <div className="compact-config-output">
            <FolderField
              label="Thư mục lưu video"
              disabled={locked}
              value={form.outputFolder}
              onChange={(value) => {
                saveWorkbenchPath('download-output', value);
                update((current) => ({ ...current, outputFolder: value }));
              }}
            />
          </div>
          <div className="compact-config-temp">
            <FolderField
              label="Thư mục tạm"
              disabled={locked}
              value={form.tempFolder}
              onChange={(value) => {
                saveWorkbenchPath('download-temp', value);
                update((current) => ({ ...current, tempFolder: value }));
              }}
            />
          </div>
          <label className="compact-config-profile">
            <span className="label">Cấu hình hiệu năng</span>
            <select
              className="select"
              disabled={locked}
              value={form.resourceProfileId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => selectProfile(event.target.value)}
            >
              {resources.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-config-workers">
            <span className="label">Video cùng lúc</span>
            <input
              className="input"
              disabled={locked}
              type="number"
              min={1}
              max={16}
              value={form.downloadWorkers}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                update((current) => ({
                  ...current,
                  downloadWorkers: clampWorker(Number(event.target.value))
                }))
              }
            />
          </label>
        </div>
        <div className="lane-quality">
          <Settings2 size={15} />
          <span>{qualityLabel(settings)}</span>
        </div>
        <div className="lane-progress">
          <div className="flex justify-between gap-3">
            <b>
              {state === 'running'
                ? activeJob
                  ? statusLabel(activeJob.status)
                  : 'Đang xử lý'
                : state === 'paused'
                  ? 'Đã tạm dừng'
                  : state === 'completed'
                    ? 'Đã hoàn tất'
                    : 'Sẵn sàng'}
            </b>
            <strong>
              {completed}/{jobs.length}
            </strong>
          </div>
          <div className={`progress progress-large ${state === 'running' ? 'is-animated' : 'is-static'}`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-meta">
            <span>{progress.toFixed(1)}% toàn danh sách</span>
            <span>{progressDetail}</span>
          </div>
        </div>
        <div className="lane-primary-actions">
          <button
            className={`btn btn-primary workflow-primary ${state === 'running' ? 'is-running' : ''}`}
            disabled={busy || (state !== 'running' && state !== 'paused' && !canStart)}
            onClick={() => void primary.action()}
          >
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : <PrimaryIcon size={18} />}{' '}
            {busy ? 'Đang thực hiện...' : primary.label}
          </button>
          <button
            className="btn btn-danger"
            disabled={busy || jobs.length === 0 || state === 'idle'}
            onClick={() => void onControl('cancel')}
          >
            <Square size={17} />
            Hủy riêng danh sách
          </button>
        </div>
        <div className="lane-secondary-actions compact-actions">
          <button
            className="icon-action"
            title="Thiết lập cookies"
            aria-label="Thiết lập cookies"
            onClick={onCookies}
          >
            <Cookie size={16} />
          </button>
          <button
            className="icon-action"
            title="Thử lại tác vụ lỗi"
            aria-label="Thử lại tác vụ lỗi"
            disabled={busy || failed.length === 0}
            onClick={() => void onRetry()}
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="icon-action"
            title="Dọn tiến trình"
            aria-label="Dọn tiến trình"
            disabled={busy || state === 'running' || jobs.length === 0}
            onClick={() => void onClearProgress()}
          >
            <Trash2 size={16} />
          </button>
          <button
            className="icon-action"
            title="Xóa nhật ký"
            aria-label="Xóa nhật ký"
            disabled={busy || !projectId}
            onClick={() => void onClearLogs()}
          >
            <FileText size={16} />
          </button>
          <button
            className="icon-action"
            title="Mở thư mục video"
            aria-label="Mở thư mục video"
            disabled={!form.outputFolder}
            onClick={() => void openOutput()}
          >
            <FolderOpen size={16} />
          </button>
          <button
            className="icon-action is-danger"
            title="Xóa danh sách"
            aria-label="Xóa danh sách"
            disabled={busy || !projectId}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <LaneLogPanel logs={combinedLogs} open={showLogs} onToggle={() => setShowLogs((value) => !value)} />
      </div>
    </section>
  );
}

function FriendlyBlockingCard({
  job,
  onCookies
}: {
  job: QueueJob;
  onCookies: () => void;
}): React.JSX.Element {
  const issue = friendlyIssue(job.errorMessage ?? job.errorCode ?? '');
  const cookie = ['AUTHENTICATION_REQUIRED', 'COOKIES_EXPIRED', 'BROWSER_COOKIE_DATABASE_LOCKED'].includes(
    job.errorCode ?? ''
  );
  return (
    <div className={`blocking-card blocking-${issue.tone}`}>
      <AlertTriangle size={21} />
      <div className="min-w-0 flex-1">
        <b>{issue.title}</b>
        <p>{issue.message}</p>
        <ol>
          {issue.steps.map((step, index) => (
            <li key={step}>
              {index + 1}. {step}
            </li>
          ))}
        </ol>
        {cookie && (
          <button className="btn btn-primary mt-3" onClick={onCookies}>
            <Cookie size={16} />
            Mở 3 cách thêm cookies
          </button>
        )}
      </div>
    </div>
  );
}

function LaneLogPanel({
  logs,
  open,
  onToggle
}: {
  logs: LogEntry[];
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const [level, setLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const filtered = logs.filter((entry) => level === 'all' || entry.level === level).slice(0, 100);
  return (
    <div className="lane-log">
      <button className="lane-log-toggle" onClick={onToggle}>
        <span>
          <ShieldCheck size={15} />
          Nhật ký riêng
        </span>
        <span>
          {logs.length} sự kiện {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>
      {open && (
        <div className="lane-log-body">
          <div className="log-filters">
            {(['all', 'info', 'warn', 'error'] as const).map((item) => (
              <button key={item} className={level === item ? 'active' : ''} onClick={() => setLevel(item)}>
                {item === 'all'
                  ? 'Tất cả'
                  : item === 'info'
                    ? 'Thông tin'
                    : item === 'warn'
                      ? 'Cảnh báo'
                      : 'Lỗi'}
              </button>
            ))}
          </div>
          <div className="log-list">
            {filtered.length === 0 && <div className="empty-state">Chưa có nhật ký cho danh sách này.</div>}
            {filtered.map((entry) => (
              <CompactLogRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
