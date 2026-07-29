export type ProjectStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived' | 'error';
export type JobStatus =
  | 'pending'
  | 'analyzing'
  | 'ready'
  | 'downloading'
  | 'downloaded'
  | 'verifying'
  | 'normalizing'
  | 'processing'
  | 'merging'
  | 'paused'
  | 'retrying'
  | 'completed'
  | 'skipped'
  | 'cancelled'
  | 'failed'
  | 'interrupted';
export type JobType = 'analyze' | 'download' | 'clip' | 'normalize' | 'merge' | 'verify';
export type ProcessPriority = 'idle' | 'below_normal' | 'normal' | 'above_normal' | 'high';
export type VerificationLevel = 'fast' | 'standard' | 'deep';
export type AudioMode = 'keep' | 'mute' | 'default';
export type QualityAction =
  | 'COPY'
  | 'REMUX'
  | 'VIDEO_TRANSCODE_ONLY'
  | 'AUDIO_TRANSCODE_ONLY'
  | 'FULL_TRANSCODE'
  | 'HDR_TONEMAP'
  | 'ADD_SILENT_AUDIO';

export interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string;
  status: ProjectStatus;
  sourceFolder: string;
  tempFolder: string;
  outputFolder: string;
  quarantineFolder: string;
  finalFileName: string;
  qualityProfileId: string;
  resourceProfileId: string;
  exportTimelineTxt: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProjectCreateInput {
  name: string;
  code?: string | null;
  description?: string;
  sourceFolder: string;
  tempFolder: string;
  outputFolder: string;
  finalFileName: string;
  qualityProfileId: string;
  resourceProfileId: string;
  exportTimelineTxt?: boolean;
}

export interface ParsedInputLine {
  id: string;
  lineNumber: number;
  originalText: string;
  url: string | null;
  normalizedUrl: string | null;
  platform: string | null;
  extractorKey: string | null;
  mediaId: string | null;
  timestampStartSeconds: number | null;
  timestampEndSeconds: number | null;
  note: string;
  audioMode: AudioMode;
  validity: 'valid' | 'warning' | 'invalid';
  warnings: string[];
  errors: string[];
}

export interface ProjectItem extends ParsedInputLine {
  projectId: string;
  position: number;
  sourceId: string | null;
  clipFile: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  videoProfile: string | null;
  videoLevel: string | null;
  pixelFormat: string;
  bitDepth: number | null;
  timeBase: string | null;
  nominalFps?: number | null;
  variableFrameRate?: boolean;
  sampleAspectRatio?: string | null;
  displayAspectRatio?: string | null;
  rotation?: number;
  streamStartTime?: number | null;
  timestampCondition?: 'normal' | 'negative_start' | 'unknown';
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  colorRange?: string | null;
  hdr: boolean;
  hdrType?: 'hdr10' | 'hlg' | 'dolby_vision' | 'unknown' | null;
  masteringDisplayMetadata?: boolean;
  audioCodec: string | null;
  videoBitrate: number | null;
  audioBitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  formatName: string | null;
  fileSize: number;
}

export interface TimelineRow {
  index: number;
  start: number;
  end: number;
  duration: number;
  code: string;
  label: string;
  note: string;
  file: string;
}

export interface MediaSource {
  id: string;
  identity: string;
  originalUrl: string;
  normalizedUrl: string;
  platform: string;
  extractorKey: string;
  mediaId: string;
  title: string | null;
  uploader: string | null;
  sourceFile: string | null;
  downloadPolicy: string | null;
  verificationStatus: 'unknown' | 'valid' | 'invalid' | 'quarantined';
  mediaInfo: MediaInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueJob {
  id: string;
  projectId: string | null;
  type: JobType;
  status: JobStatus;
  priority: number;
  sourceId: string | null;
  itemId: string | null;
  input: Record<string, unknown>;
  progress: number;
  speed: string | null;
  etaSeconds: number | null;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ResourceProfile {
  id: string;
  name: string;
  description: string;
  downloadWorkers: number;
  analyzeWorkers: number;
  normalizeWorkers: number;
  remuxWorkers: number;
  clipWorkers: number;
  ffmpegThreads: number;
  filterThreads: number;
  filterComplexThreads: number;
  processPriority: ProcessPriority;
  cpuSoftLimitPercent: number;
  memoryFreeMinimumBytes: number;
  diskFreeMinimumBytes: number;
  gpuJobs: number;
  builtIn: boolean;
}

export interface QualityProfile {
  id: string;
  name: string;
  description: string;
  mode: 'highest_source' | 'smart_merge' | 'compatible_1080p' | 'smooth_background' | 'maximum_cpu' | 'custom';
  maxWidth: number | null;
  maxHeight: number | null;
  allowUpscale: boolean;
  fpsMode: 'source' | '30' | '60' | 'custom';
  customFps: number | null;
  videoCodec: 'copy' | 'h264' | 'hevc';
  encoder: 'cpu_auto' | 'auto' | 'libx264' | 'h264_nvenc' | 'hevc_nvenc';
  crf: number;
  cq: number;
  bitrateMode?: 'quality' | 'source_average';
  preset: string;
  pixelFormat: string;
  hdrMode: 'keep' | 'tonemap_sdr' | 'auto' | 'forbid';
  audioMode: 'copy_if_compatible' | 'aac_256' | 'aac_320' | 'mute' | 'silent';
  sampleRate: number;
  forceStereo: boolean;
  builtIn: boolean;
}

export type DownloadLaneId = 'download-1' | 'download-2' | 'download-3' | 'download-4';
export type MergeLaneId = 'merge-1' | 'merge-2' | 'merge-3' | 'merge-4';
export type DownloadCodecPreference = 'auto' | 'h264' | 'hevc' | 'vp9' | 'av1';
export type DownloadContainerPreference = 'auto' | 'mp4' | 'mkv';
export type DownloadCompatibilityMode =
  | 'source'
  | 'capcut_sdr_1080p'
  | 'capcut_sdr_2k';

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  language: 'vi';
  minimizeToTray: boolean;
  startWithWindows: boolean;
  closeBehavior: 'ask' | 'pause_and_exit' | 'cancel_and_exit' | 'tray';
  defaultSourceFolder: string;
  defaultTempFolder: string;
  defaultOutputFolder: string;
  defaultQualityProfileId: string;
  defaultResourceProfileId: string;
  verificationLevel: VerificationLevel;
  sourceCachePolicy: 'forever' | 'days' | 'project_complete' | 'manual';
  sourceCacheDays: number;
  logRetentionDays: number;
  appUpdateChannel: 'stable' | 'beta';
  toolUpdateChannel: 'stable' | 'beta';
  autoCheckAppUpdates: boolean;
  autoCheckToolUpdates: boolean;
  toolManifestUrl: string;
  appFeedUrl: string;
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  aria2cPath: string;
  cookiesFilePath: string;
  cookiesBrowser: 'none' | 'chrome' | 'edge' | 'firefox';
  cookiesBrowserProfile: string;
  proxy: string;
  rateLimit: string;
  useAria2c: boolean;
  aria2Connections: number;
  maxGlobalDownloadWorkers: number;
  downloadConcurrentFragments: number;
  downloadLaneCount: 1 | 2 | 3 | 4;
  mergeLaneCount: 1 | 2 | 3 | 4;
  maxGlobalMergeJobs: 1 | 2 | 3 | 4;
  downloadCompatibilityMode: DownloadCompatibilityMode;
  downloadMinHeight: number;
  downloadMaxHeight: number;
  downloadMinFps: number;
  downloadMaxFps: number;
  downloadCodecPreference: DownloadCodecPreference;
  downloadContainerPreference: DownloadContainerPreference;
  downloadMinVideoBitrateKbps: number;
  downloadVideoBitrateKbps: number;
  downloadMinAudioBitrateKbps: number;
  downloadAudioBitrateKbps: number;
  downloadAllowBelowMinimum: boolean;
  downloadVerifyEntireFile: boolean;
  progressRefreshMs: number;
}

export interface HardwareProfile {
  platform: string;
  release: string;
  architecture: string;
  hostname: string;
  physicalCpuCount: number;
  logicalCpuCount: number;
  cpuModel: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  gpuAdapters: Array<{ name: string; memoryBytes: number | null; driverVersion: string | null }>;
  disks: Array<{
    device: string;
    mount: string;
    type: 'ssd' | 'hdd' | 'unknown';
    totalBytes: number;
    freeBytes: number;
  }>;
  detectedAt: string;
}


export interface DownloadConcurrencyPlan {
  listCount: 1 | 2 | 3 | 4;
  workersPerList: number;
  globalWorkers: number;
  fullVerificationWorkers: number;
  note: string;
}

export interface DownloadConcurrencyRecommendation {
  recommendedConcurrentLists: 1 | 2 | 3 | 4;
  recommendedPerListWorkers: number;
  recommendedSingleListWorkers: number;
  recommendedGlobalWorkers: number;
  maximumSafeGlobalWorkers: number;
  recommendedConcurrentFragments: number;
  recommendedAria2Connections: number;
  summary: string;
  warnings: string[];
  plans: DownloadConcurrencyPlan[];
}

export interface ToolUpdateCheck {
  name: 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'ffplay' | 'aria2c';
  currentVersion: string | null;
  latestVersion: string;
  available: boolean;
  source: string;
  publishedAt: string | null;
}

export interface ToolStatus {
  name: 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'ffplay' | 'aria2c';
  available: boolean;
  executablePath: string | null;
  version: string | null;
  source: 'bundled' | 'managed' | 'local' | 'path' | null;
  capabilities: string[];
  health: 'healthy' | 'warning' | 'broken';
  error: string | null;
  lastCheckedAt: string | null;
}

export interface SystemStats {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryPercent: number;
  disks: Array<{ mount: string; freeBytes: number; totalBytes: number; usedPercent: number }>;
  activeProcesses: number;
  activeJobs: number;
  downloadSpeedBytes: number;
  encodeFps: number;
  sampledAt: string;
}


export type AppUpdateState =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface AppUpdateReleaseInfo {
  version: string;
  releaseDate: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
}

export interface AppUpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface AppUpdateStatus {
  state: AppUpdateState;
  currentVersion: string;
  channel: AppSettings['appUpdateChannel'];
  supported: boolean;
  checkedAt: string | null;
  message: string | null;
  info: AppUpdateReleaseInfo | null;
  progress: AppUpdateProgress | null;
  error: string | null;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  projectId?: string;
  jobId?: string;
  attemptId?: string;
  eventCode: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface QualityDecision {
  action: QualityAction;
  reasons: string[];
  target: {
    width: number;
    height: number;
    fps: number;
    videoCodec: string;
    pixelFormat: string;
    audioCodec: string | null;
    sampleRate: number | null;
    channels: number | null;
    hdr: boolean;
  };
}

export type WorkbenchSlot = DownloadLaneId | MergeLaneId;

export interface WorkbenchStorageSummary {
  slot: WorkbenchSlot;
  projectId: string | null;
  downloadedBytes: number;
  downloadedFileCount: number;
  temporaryBytes: number;
  temporaryFileCount: number;
  finalBytes: number;
  finalFileCount: number;
  totalBytes: number;
  scannedAt: string;
}

export interface DownloadLaneInput {
  slot: DownloadLaneId;
  name: string;
  linksText: string;
  outputFolder: string;
  tempFolder: string;
  resourceProfileId: string;
}

export interface DownloadLaneDraftInput extends DownloadLaneInput {
  downloadWorkers: number;
}

export interface DownloadMergeInput {
  slot: MergeLaneId;
  name: string;
  linksText: string;
  sourceFolder: string;
  tempFolder: string;
  outputFolder: string;
  finalFileName: string;
  qualityProfileId: string;
  resourceProfileId: string;
  exportTimelineTxt: boolean;
}

export interface WorkbenchSlotState {
  slot: WorkbenchSlot;
  project: Project | null;
  items: ProjectItem[];
  jobs: QueueJob[];
}

export interface WorkbenchState {
  downloadLanes: WorkbenchSlotState[];
  mergeLanes: WorkbenchSlotState[];
}

export type AttentionSeverity = 'info' | 'success' | 'warning' | 'error';
export interface AttentionNotice {
  id: string;
  severity: AttentionSeverity;
  title: string;
  message: string;
  projectId?: string;
  jobId?: string;
  code?: string;
  steps?: string[];
  sticky?: boolean;
}

export interface CookieConfigurationStatus {
  mode: 'none' | 'browser' | 'file' | 'pasted';
  label: string;
  browser: AppSettings['cookiesBrowser'];
  browserProfile: string;
  filePath: string;
  managed: boolean;
}
