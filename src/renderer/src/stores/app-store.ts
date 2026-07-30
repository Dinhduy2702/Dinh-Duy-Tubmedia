import { create } from 'zustand';
import type {
  AppSettings,
  AppUpdateStatus,
  AttentionNotice,
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
  | 'download-workbench'
  | 'download-merge'
  | 'activity'
  | 'tools'
  | 'cleanup'
  | 'updates'
  | 'logs'
  | 'settings'
  | 'about';

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
  error: string | null;
  attention: AttentionNotice | null;
  attentionQueue: AttentionNotice[];
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
  setError(error: string | null): void;
  setAttention(attention: AttentionNotice | null): void;
  dismissAttention(id?: string): void;
  dismissAttentionByCodes(codes: readonly string[]): void;
  setUpdateStatus(status: AppUpdateStatus): void;
  clearProjectLogs(projectId: string): void;
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

export const useAppStore = create<State>((set, get) => ({
  ready: false,
  loading: false,
  page: 'download-workbench',
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
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
  setPage: (page) => set({ page }),
  selectProject: (id) => set({ selectedProjectId: id, page: get().page }),
  refreshProjects: async () => set({ projects: await window.desktop.projects.list() }),
  refreshJobs: async () => set({ jobs: await window.desktop.queue.list() }),
  refreshTools: async () => set({ tools: await window.desktop.tools.list() }),
  setSettings: (settings) => set({ settings }),
  pushLog: (entry) => set((state) => ({ logs: mergeLogs(state.logs, [entry]) })),
  pushLogs: (entries) => set((state) => ({ logs: mergeLogs(state.logs, entries) })),
  updateJob: (job) => set((state) => ({ jobs: mergeJobUpdates(state.jobs, [job]) })),
  updateJobs: (jobs) => set((state) => ({ jobs: mergeJobUpdates(state.jobs, jobs) })),
  replaceJobs: (jobs) =>
    set((state) => {
      if (
        state.jobs.length === jobs.length &&
        jobs.every((job, index) => {
          const current = state.jobs[index];
          return current ? sameJob(current, job) : false;
        })
      )
        return state;
      return { jobs };
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
  setError: (error) => set({ error }),
  setAttention: (attention) =>
    set((state) => {
      if (!attention) {
        const [next, ...rest] = state.attentionQueue;
        return { attention: next ?? null, attentionQueue: rest };
      }
      if (state.attention?.id === attention.id) return { attention };
      if (!state.attention) return { attention };
      const queue = [...state.attentionQueue.filter((item) => item.id !== attention.id), attention].slice(-5);
      return { attentionQueue: queue };
    }),
  dismissAttention: (id) =>
    set((state) => {
      if (id && state.attention?.id !== id) {
        return { attentionQueue: state.attentionQueue.filter((item) => item.id !== id) };
      }
      const [next, ...rest] = state.attentionQueue;
      return { attention: next ?? null, attentionQueue: rest };
    }),
  dismissAttentionByCodes: (codes) =>
    set((state) => {
      const blocked = new Set(codes);
      const remaining = [state.attention, ...state.attentionQueue]
        .filter((notice): notice is AttentionNotice => Boolean(notice))
        .filter((notice) => !notice.code || !blocked.has(notice.code));
      const [attention, ...attentionQueue] = remaining;
      return { attention: attention ?? null, attentionQueue };
    }),
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  clearProjectLogs: (projectId) =>
    set((state) => ({ logs: state.logs.filter((entry) => entry.projectId !== projectId) }))
}));
