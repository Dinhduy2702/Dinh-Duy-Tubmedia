import { create } from 'zustand';
import { friendlyIssue, safeUiText } from '../utils/ui-error';
import type {
  AppSettings,
  AppUpdateStatus,
  AttentionNotice,
  AttentionSeverity,
  HardwareProfile,
  LogEntry,
  Project,
  QualityProfile,
  QueueJob,
  ResourceProfile,
  SystemStats,
  ToolStatus
} from '@shared/types/domain';

export type PageId =
  | 'editor-home'
  | 'download-workbench'
  | 'download-merge'
  | 'activity'
  | 'history'
  | 'diagnostics'
  | 'tools'
  | 'cleanup'
  | 'updates'
  | 'logs'
  | 'settings'
  | 'about';

export interface NotificationRecord extends AttentionNotice {
  createdAt: string;
  updatedAt: string;
  readAt?: string;
  outputPath?: string;
  pinned: boolean;
  count: number;
}

interface State {
  ready: boolean;
  loading: boolean;
  page: PageId;
  projects: Project[];
  jobs: QueueJob[];
  tools: ToolStatus[];
  settings: AppSettings | null;
  resources: ResourceProfile[];
  qualities: QualityProfile[];
  hardware: HardwareProfile | null;
  stats: SystemStats | null;
  logs: LogEntry[];
  selectedProjectId: string | null;
  error: unknown;
  attention: AttentionNotice | null;
  attentionQueue: AttentionNotice[];
  notifications: NotificationRecord[];
  notificationCenterOpen: boolean;
  updateStatus: AppUpdateStatus | null;
  bootstrap(): Promise<void>;
  setPage(page: PageId): void;
  selectProject(id: string | null): void;
  refreshProjects(): Promise<void>;
  refreshJobs(): Promise<void>;
  refreshTools(): Promise<void>;
  setSettings(settings: AppSettings): void;
  pushLog(entry: LogEntry): void;
  pushLogs(entries: LogEntry[]): void;
  updateJob(job: QueueJob): void;
  updateJobs(jobs: QueueJob[]): void;
  replaceJobs(jobs: QueueJob[]): void;
  setStats(stats: SystemStats): void;
  setError(error: unknown): void;
  setAttention(attention: AttentionNotice | null): void;
  dismissAttention(id?: string): void;
  dismissAttentionByCodes(codes: readonly string[], projectId?: string | null): void;
  openNotificationCenter(): void;
  closeNotificationCenter(): void;
  toggleNotificationCenter(): void;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  removeNotification(id: string): void;
  clearReadNotifications(): void;
  toggleNotificationPin(id: string): void;
  setUpdateStatus(status: AppUpdateStatus): void;
  clearProjectLogs(projectId: string): void;
}

const NOTIFICATION_STORAGE_KEY = 'tubmedia.notification-center.v1';
const MAX_NOTIFICATIONS = 150;
const DUPLICATE_WINDOW_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_MS: Record<AttentionSeverity, number> = {
  success: DAY_MS,
  info: 3 * DAY_MS,
  warning: 30 * DAY_MS,
  error: 30 * DAY_MS
};

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}


function outputPathFromUnknown(value: unknown): string | null {
  let candidate = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        candidate = JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  for (const key of ['outputPath', 'outputFile', 'outputFolder', 'destinationPath']) {
    const path = optionalText(record[key]);
    if (path) return path;
  }
  return null;
}

function validSeverity(value: unknown): value is AttentionSeverity {
  return value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function normalizeStoredNotification(value: unknown): NotificationRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = optionalText(record.id);
  const title = optionalText(record.title);
  const message = optionalText(record.message);
  if (!id || !title || !message || !validSeverity(record.severity)) return null;
  const now = new Date().toISOString();
  const createdAt = optionalText(record.createdAt) ?? now;
  const updatedAt = optionalText(record.updatedAt) ?? createdAt;
  const steps = Array.isArray(record.steps)
    ? record.steps
        .filter((step): step is string => typeof step === 'string' && Boolean(step.trim()))
        .map((step) => safeUiText(step, 'Kiểm tra lại thao tác.'))
    : [];
  const countValue = typeof record.count === 'number' ? Math.floor(record.count) : 1;
  const readAt = optionalText(record.readAt);
  const projectId = optionalText(record.projectId);
  const jobId = optionalText(record.jobId);
  const code = optionalText(record.code);
  const outputPath = optionalText(record.outputPath);
  return {
    id,
    severity: record.severity,
    title: safeUiText(title, 'Thông báo'),
    message: safeUiText(message, 'Ứng dụng đã cập nhật trạng thái.'),
    createdAt,
    updatedAt,
    pinned: record.pinned === true,
    count: Math.max(1, countValue),
    ...(readAt ? { readAt } : {}),
    ...(projectId ? { projectId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(code ? { code } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(steps.length > 0 ? { steps } : {}),
    ...(typeof record.sticky === 'boolean' ? { sticky: record.sticky } : {})
  };
}

function trimNotificationHistory(records: NotificationRecord[], now = Date.now()): NotificationRecord[] {
  return records
    .filter((record) => {
      if (record.pinned) return true;
      const timestamp = Date.parse(record.updatedAt);
      if (!Number.isFinite(timestamp)) return true;
      return now - timestamp <= RETENTION_MS[record.severity];
    })
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })
    .slice(0, MAX_NOTIFICATIONS);
}

function loadNotificationHistory(): NotificationRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return trimNotificationHistory(
      parsed
        .map((item) => normalizeStoredNotification(item))
        .filter((item): item is NotificationRecord => Boolean(item))
    );
  } catch {
    return [];
  }
}

function persistNotificationHistory(records: NotificationRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Lịch sử thông báo là tiện ích phụ; lỗi bộ nhớ trình duyệt không được chặn ứng dụng.
  }
}

function cleanNotice(attention: AttentionNotice): AttentionNotice {
  const sanitizedSteps = attention.steps
    ?.filter((step) => Boolean(step.trim()))
    .map((step) => safeUiText(step, 'Kiểm tra lại thao tác.'));
  return {
    ...attention,
    title: safeUiText(attention.title, 'Thông báo'),
    message: safeUiText(attention.message, 'Ứng dụng đã cập nhật trạng thái.'),
    ...(sanitizedSteps && sanitizedSteps.length > 0 ? { steps: sanitizedSteps } : {})
  };
}

function notificationFromNotice(
  notice: AttentionNotice,
  timestamp: string,
  options?: { pinned?: boolean; count?: number; createdAt?: string; outputPath?: string }
): NotificationRecord {
  return {
    ...notice,
    createdAt: options?.createdAt ?? timestamp,
    updatedAt: timestamp,
    pinned: options?.pinned ?? false,
    count: options?.count ?? 1,
    ...(options?.outputPath ? { outputPath: options.outputPath } : {})
  };
}

function addNotification(
  current: NotificationRecord[],
  rawNotice: AttentionNotice,
  now = Date.now(),
  outputPath?: string
): NotificationRecord[] {
  const notice = cleanNotice(rawNotice);
  const timestamp = new Date(now).toISOString();
  const sameId = current.find((item) => item.id === notice.id);
  if (sameId) {
    const replacementOutputPath = outputPath ?? sameId.outputPath;
    const replacement = notificationFromNotice(notice, timestamp, {
      pinned: sameId.pinned,
      count: sameId.count,
      createdAt: sameId.createdAt,
      ...(replacementOutputPath ? { outputPath: replacementOutputPath } : {})
    });
    const next = trimNotificationHistory([
      replacement,
      ...current.filter((item) => item.id !== notice.id)
    ], now);
    persistNotificationHistory(next);
    return next;
  }

  const duplicate = current.find((item) => {
    if (item.pinned || item.readAt || item.sticky || notice.sticky) return false;
    const elapsed = now - Date.parse(item.updatedAt);
    return (
      Number.isFinite(elapsed) &&
      elapsed >= 0 &&
      elapsed <= DUPLICATE_WINDOW_MS &&
      item.severity === notice.severity &&
      item.title === notice.title &&
      (item.code ?? '') === (notice.code ?? '')
    );
  });

  if (duplicate) {
    const groupedOutputPath = outputPath ?? duplicate.outputPath;
    const grouped = notificationFromNotice(notice, timestamp, {
      pinned: duplicate.pinned,
      count: duplicate.count + 1,
      createdAt: duplicate.createdAt,
      ...(groupedOutputPath ? { outputPath: groupedOutputPath } : {})
    });
    const next = trimNotificationHistory([
      grouped,
      ...current.filter((item) => item.id !== duplicate.id)
    ], now);
    persistNotificationHistory(next);
    return next;
  }

  const next = trimNotificationHistory([
    notificationFromNotice(notice, timestamp, { ...(outputPath ? { outputPath } : {}) }),
    ...current
  ], now);
  persistNotificationHistory(next);
  return next;
}

function sameJob(left: QueueJob, right: QueueJob): boolean {
  return (
    left.updatedAt === right.updatedAt &&
    left.status === right.status &&
    left.progress === right.progress &&
    left.speed === right.speed &&
    left.etaSeconds === right.etaSeconds &&
    left.errorCode === right.errorCode &&
    left.errorMessage === right.errorMessage
  );
}

function mergeJobUpdates(current: QueueJob[], updates: QueueJob[]): QueueJob[] {
  if (updates.length === 0) return current;
  const map = new Map(updates.map((job) => [job.id, job]));
  let changed = false;
  const next = current.map((job) => {
    const update = map.get(job.id);
    if (!update) return job;
    map.delete(job.id);
    if (sameJob(job, update)) return job;
    changed = true;
    return update;
  });
  if (map.size > 0) {
    changed = true;
    next.unshift(...map.values());
  }
  return changed ? next : current;
}

// TUBMEDIA STALE DISK NOTICE RECONCILIATION R28
function reconcileDiskFullNotifications(
  notifications: NotificationRecord[],
  jobs: QueueJob[]
): NotificationRecord[] {
  const activeProjects = new Set(
    jobs
      .filter(
        (job) =>
          job.errorCode === 'DISK_FULL' &&
          (job.status === 'paused' || job.status === 'interrupted')
      )
      .map((job) => job.projectId)
      .filter((projectId): projectId is string => Boolean(projectId))
  );
  const anyActiveDiskBlock = jobs.some(
    (job) =>
      job.errorCode === 'DISK_FULL' &&
      (job.status === 'paused' || job.status === 'interrupted')
  );
  const next = notifications.filter((notice) => {
    if (notice.code !== 'DISK_FULL') return true;
    return notice.projectId ? activeProjects.has(notice.projectId) : anyActiveDiskBlock;
  });
  if (next.length !== notifications.length) persistNotificationHistory(next);
  return next.length === notifications.length ? notifications : next;
}

function mergeLogs(current: LogEntry[], entries: LogEntry[]): LogEntry[] {
  if (entries.length === 0) return current;
  const seen = new Set<string>();
  return [...entries.slice().reverse(), ...current]
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .slice(0, 1000);
}

const initialNotifications = loadNotificationHistory();

export const useAppStore = create<State>((set, get) => ({
  ready: false,
  loading: false,
  page: 'editor-home',
  projects: [],
  jobs: [],
  tools: [],
  settings: null,
  resources: [],
  qualities: [],
  hardware: null,
  stats: null,
  logs: [],
  selectedProjectId: null,
  error: null,
  attention: null,
  attentionQueue: [],
  notifications: initialNotifications,
  notificationCenterOpen: false,
  updateStatus: null,
  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const [data, updateStatus] = await Promise.all([
        window.desktop.app.bootstrap(),
        window.desktop.updates.status().catch(() => null)
      ]);
      set({
        ready: true,
        loading: false,
        projects: data.projects,
        jobs: data.jobs,
        notifications: reconcileDiskFullNotifications(initialNotifications, data.jobs),
        tools: data.tools,
        settings: data.settings,
        resources: data.profiles.resources,
        qualities: data.profiles.qualities,
        hardware: data.hardware,
        updateStatus,
        logs: []
      });
      void window.desktop.logs
        .list({ limit: 100 })
        .then((persisted) => {
          set((state) => ({ logs: mergeLogs(state.logs, persisted) }));
        })
        .catch(() => undefined);
      void window.desktop.settings
        .hardware()
        .then((hardware) => set({ hardware }))
        .catch(() => undefined);
    } catch (error) {
      set({ loading: false, error });
    }
  },
  setPage: (page) => set({ page }),
  selectProject: (id) => set({ selectedProjectId: id, page: get().page }),
  refreshProjects: async () => set({ projects: await window.desktop.projects.list() }),
  refreshJobs: async () => {
    const jobs = await window.desktop.queue.list();
    set((state) => ({
      jobs,
      notifications: reconcileDiskFullNotifications(state.notifications, jobs)
    }));
  },
  refreshTools: async () => set({ tools: await window.desktop.tools.list() }),
  setSettings: (settings) => set({ settings }),
  pushLog: (entry) => set((state) => ({ logs: mergeLogs(state.logs, [entry]) })),
  pushLogs: (entries) => set((state) => ({ logs: mergeLogs(state.logs, entries) })),
  updateJob: (job) =>
    set((state) => {
      const jobs = mergeJobUpdates(state.jobs, [job]);
      return { jobs, notifications: reconcileDiskFullNotifications(state.notifications, jobs) };
    }),
  updateJobs: (updates) =>
    set((state) => {
      const jobs = mergeJobUpdates(state.jobs, updates);
      return { jobs, notifications: reconcileDiskFullNotifications(state.notifications, jobs) };
    }),
  replaceJobs: (jobs) =>
    set((state) => {
      const jobsUnchanged =
        state.jobs.length === jobs.length &&
        jobs.every((job, index) => {
          const current = state.jobs[index];
          return current ? sameJob(current, job) : false;
        });
      const notifications = reconcileDiskFullNotifications(state.notifications, jobs);
      if (jobsUnchanged && notifications === state.notifications) return state;
      return { jobs: jobsUnchanged ? state.jobs : jobs, notifications };
    }),
  setStats: (stats) =>
    set((state) => {
      const previous = state.stats;
      if (
        previous &&
        Math.abs(previous.cpuPercent - stats.cpuPercent) < 0.5 &&
        Math.abs(previous.memoryPercent - stats.memoryPercent) < 0.25 &&
        previous.activeJobs === stats.activeJobs &&
        previous.activeProcesses === stats.activeProcesses
      )
        return state;
      return { stats };
    }),
  setError: (error) =>
    set((state) => {
      if (error === null || error === undefined || error === '') return { error: null };
      const issue = friendlyIssue(error);
      const notice: AttentionNotice = {
        id: `ui-result-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        severity: issue.tone,
        title: issue.title,
        message: issue.message,
        ...(issue.steps.length > 0 ? { steps: issue.steps } : {}),
        sticky: false
      };
      const notifications = addNotification(
        state.notifications,
        notice,
        Date.now(),
        outputPathFromUnknown(error) ?? undefined
      );
      if (issue.tone === 'success' || issue.tone === 'info') {
        if (!state.attention) return { error: null, attention: notice, notifications };
        return {
          error: null,
          notifications,
          attentionQueue: [
            ...state.attentionQueue.filter((item) => item.id !== notice.id),
            notice
          ].slice(-5)
        };
      }
      return { error, notifications };
    }),
  setAttention: (attention) =>
    set((state) => {
      if (!attention) {
        const [next, ...rest] = state.attentionQueue;
        return { attention: next ?? null, attentionQueue: rest };
      }
      const cleanAttention = cleanNotice(attention);
      const notifications = addNotification(state.notifications, cleanAttention);
      if (state.attention?.id === cleanAttention.id) {
        return { attention: cleanAttention, notifications };
      }
      if (!state.attention) return { attention: cleanAttention, notifications };
      const queue = [
        ...state.attentionQueue.filter((item) => item.id !== cleanAttention.id),
        cleanAttention
      ].slice(-5);
      return { attentionQueue: queue, notifications };
    }),
  dismissAttention: (id) =>
    set((state) => {
      if (id && state.attention?.id !== id) {
        return { attentionQueue: state.attentionQueue.filter((item) => item.id !== id) };
      }
      const [next, ...rest] = state.attentionQueue;
      return { attention: next ?? null, attentionQueue: rest };
    }),
  dismissAttentionByCodes: (codes, projectId) =>
    set((state) => {
      const blocked = new Set(codes);
      const matches = (notice: AttentionNotice): boolean =>
        Boolean(
          notice.code &&
            blocked.has(notice.code) &&
            (!projectId || notice.projectId === projectId)
        );
      const remaining = [state.attention, ...state.attentionQueue]
        .filter((notice): notice is AttentionNotice => Boolean(notice))
        .filter((notice) => !matches(notice));
      const [attention, ...attentionQueue] = remaining;
      const notifications = state.notifications.filter((notice) => !matches(notice));
      persistNotificationHistory(notifications);
      return { attention: attention ?? null, attentionQueue, notifications };
    }),
  openNotificationCenter: () => set({ notificationCenterOpen: true }),
  closeNotificationCenter: () => set({ notificationCenterOpen: false }),
  toggleNotificationCenter: () =>
    set((state) => ({ notificationCenterOpen: !state.notificationCenterOpen })),
  markNotificationRead: (id) =>
    set((state) => {
      const now = new Date().toISOString();
      const notifications = state.notifications.map((notice) =>
        notice.id === id && !notice.readAt ? { ...notice, readAt: now } : notice
      );
      persistNotificationHistory(notifications);
      return { notifications };
    }),
  markAllNotificationsRead: () =>
    set((state) => {
      const now = new Date().toISOString();
      const notifications = state.notifications.map((notice) =>
        notice.readAt ? notice : { ...notice, readAt: now }
      );
      persistNotificationHistory(notifications);
      return { notifications };
    }),
  removeNotification: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((notice) => notice.id !== id);
      persistNotificationHistory(notifications);
      return { notifications };
    }),
  clearReadNotifications: () =>
    set((state) => {
      const notifications = state.notifications.filter((notice) => !notice.readAt || notice.pinned);
      persistNotificationHistory(notifications);
      return { notifications };
    }),
  toggleNotificationPin: (id) =>
    set((state) => {
      const notifications = state.notifications.map((notice) =>
        notice.id === id ? { ...notice, pinned: !notice.pinned } : notice
      );
      persistNotificationHistory(notifications);
      return { notifications };
    }),
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  clearProjectLogs: (projectId) =>
    set((state) => ({ logs: state.logs.filter((entry) => entry.projectId !== projectId) }))
}));
