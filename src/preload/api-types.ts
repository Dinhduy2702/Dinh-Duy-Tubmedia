import type {
  AppSettings,
  AppUpdateStatus,
  AttentionNotice,
  CookieConfigurationStatus,
  DownloadLaneDraftInput,
  DownloadLaneInput,
  DownloadMergeInput,
  HardwareProfile,
  LogEntry,
  ParsedInputLine,
  Project,
  ProjectCreateInput,
  ProjectItem,
  QualityProfile,
  QueueJob,
  ResourceProfile,
  SystemStats,
  ToolStatus,
  ToolUpdateCheck,
  WorkbenchSlot,
  WorkbenchStorageSummary,
  WorkbenchSlotState,
  WorkbenchState
} from '@shared/types/domain.js';

import type { SystemCleanupRequest, SystemCleanupStatus } from '@shared/system-cleanup.js';
import type { QuickDownloadRequest, QuickDownloadStatus } from '@shared/quick-download.js';
export interface DesktopApi {
  workbench: {
    state(): Promise<WorkbenchState>;
    startDownload(input: DownloadLaneInput): Promise<WorkbenchSlotState>;
    startMerge(input: DownloadMergeInput): Promise<WorkbenchSlotState>;
    saveDownloadDraft(input: DownloadLaneDraftInput): Promise<WorkbenchSlotState>;
    saveMergeDraft(input: DownloadMergeInput): Promise<WorkbenchSlotState>;
    storage(slot: WorkbenchSlot): Promise<WorkbenchStorageSummary>;
    pause(slot: WorkbenchSlot): Promise<WorkbenchSlotState>;
    resume(slot: WorkbenchSlot): Promise<WorkbenchSlotState>;
    cancel(slot: WorkbenchSlot): Promise<WorkbenchSlotState>;
    clearProgress(slot: WorkbenchSlot): Promise<WorkbenchSlotState>;
    clearLogs(slot: WorkbenchSlot): Promise<WorkbenchSlotState>;
    remove(slot: WorkbenchSlot): Promise<WorkbenchSlotState>;
    removeAll(): Promise<{ projectsRemoved: number; jobsRemoved: number }>;
  };
  app: {
    bootstrap(): Promise<{
      settings: AppSettings;
      profiles: { resources: ResourceProfile[]; qualities: QualityProfile[] };
      projects: Project[];
      jobs: QueueJob[];
      tools: ToolStatus[];
      hardware: HardwareProfile;
    }>;
    systemStats(): Promise<SystemStats>;
    showPath(path: string): Promise<string>;
    readClipboard(): Promise<string>;
    writeClipboard(text: string): Promise<boolean>;
  };
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project | null>;
    create(input: ProjectCreateInput): Promise<Project>;
    update(input: { id: string } & Partial<ProjectCreateInput>): Promise<Project>;
    archive(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    duplicate(id: string): Promise<Project>;
  };
  input: {
    parse(text: string): Promise<ParsedInputLine[]>;
    importText(projectId: string, text: string, mode: 'append' | 'replace'): Promise<ProjectItem[]>;
    listItems(projectId: string): Promise<ProjectItem[]>;
    reorder(projectId: string, itemIds: string[]): Promise<ProjectItem[]>;
    removeItems(ids: string[]): Promise<void>;
  };
  cookies: {
    status(): Promise<CookieConfigurationStatus>;
    saveText(text: string): Promise<CookieConfigurationStatus>;
    useBrowser(browser: 'chrome' | 'edge' | 'firefox', profile?: string): Promise<CookieConfigurationStatus>;
    useFile(path: string): Promise<CookieConfigurationStatus>;
    clear(): Promise<CookieConfigurationStatus>;
  };
  dialogs: {
    chooseFolder(
      defaultPath?: string
    ): Promise<{
      path: string;
      writable: boolean;
      freeBytes: number;
      totalBytes: number;
      warnings: string[];
    } | null>;
    chooseTextFile(): Promise<{ path: string; text: string } | null>;
    chooseCookiesFile(): Promise<string | null>;
    chooseBackupFile(): Promise<string | null>;
    saveTextFile(input: {
      defaultName: string;
      content: string;
      defaultFolder?: string;
    }): Promise<string | null>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    hardware(): Promise<HardwareProfile>;
    profiles(): Promise<{ resources: ResourceProfile[]; qualities: QualityProfile[] }>;
    saveResourceProfile(profile: ResourceProfile): Promise<ResourceProfile>;
    saveQualityProfile(profile: QualityProfile): Promise<QualityProfile>;
    recommend(): Promise<ResourceProfile>;
  };
  queue: {
    list(): Promise<QueueJob[]>;
    enqueueProject(projectId: string): Promise<QueueJob[]>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;
    pause(jobId: string): Promise<void>;
    resume(jobId: string): Promise<void>;
    cancel(jobId: string): Promise<void>;
    retry(jobId: string): Promise<void>;
    retryFailed(projectId?: string): Promise<number>;
    remove(
      jobId: string,
      deleteOutput?: boolean
    ): Promise<{
      removed: boolean;
      outputDeleted: boolean;
      outputMissing: boolean;
      outputPath: string | null;
    }>;
    clearFinished(projectId?: string): Promise<number>;
  };
  tools: {
    list(): Promise<ToolStatus[]>;
    healthCheck(): Promise<ToolStatus[]>;
    checkUpdates(): Promise<ToolUpdateCheck[]>;
    update(name: ToolStatus['name']): Promise<void>;
    updateAll(): Promise<ToolStatus[]>;
    repairAll(): Promise<ToolStatus[]>;
    rollback(name: ToolStatus['name']): Promise<void>;
    openFolder(): Promise<string>;
  };
  media: {
    analyze(path: string): Promise<unknown>;
    verifyFile(path: string, level: 'fast' | 'standard' | 'deep'): Promise<unknown>;
    mergeProject(projectId: string): Promise<QueueJob[]>;
  };
  logs: {
    list(query?: {
      projectId?: string;
      jobId?: string;
      level?: LogEntry['level'];
      module?: string;
      limit?: number;
    }): Promise<LogEntry[]>;
    exportDiagnostics(): Promise<string | null>;
    openFolder(): Promise<string>;
    clear(projectId?: string): Promise<{ removed: number }>;
  };
  backups: {
    create(projectId?: string, includeMedia?: boolean): Promise<string>;
    preview(path: string): Promise<unknown>;
    restore(path: string, mode: 'merge' | 'replace'): Promise<{ projects: number }>;
  };
  systemCleanup: {
    start(input: SystemCleanupRequest): Promise<SystemCleanupStatus>;
    status(runId: string): Promise<SystemCleanupStatus | null>;
    cancel(runId: string): Promise<SystemCleanupStatus | null>;
  };
  quickDownload: {
    defaults(): Promise<{ outputDirectory: string }>;
    chooseDirectory(currentDirectory?: string): Promise<string | null>;
    start(input: QuickDownloadRequest): Promise<QuickDownloadStatus>;
    status(taskId: string): Promise<QuickDownloadStatus | null>;
    cancel(taskId: string): Promise<QuickDownloadStatus | null>;
    revealOutput(taskId: string): Promise<boolean>;
  };
  updates: {
    status(): Promise<AppUpdateStatus>;
    check(): Promise<AppUpdateStatus>;
    download(): Promise<AppUpdateStatus>;
    install(): Promise<void>;
  };
  events: {
    onQueueChanged(listener: (jobs: QueueJob[]) => void): () => void;
    onJobProgress(listener: (job: QueueJob) => void): () => void;
    onLog(listener: (entry: LogEntry) => void): () => void;
    onSystemStats(listener: (stats: SystemStats) => void): () => void;
    onUpdateStatus(listener: (status: AppUpdateStatus) => void): () => void;
    onAttention(listener: (notice: AttentionNotice) => void): () => void;
    onToolsChanged(listener: (tools: ToolStatus[]) => void): () => void;
  };
}
