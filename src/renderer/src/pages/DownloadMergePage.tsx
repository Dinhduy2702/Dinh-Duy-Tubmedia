import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Cookie,
  Download,
  FileDown,
  FileText,
  FileVideo2,
  FolderOpen,
  Gauge,
  HardDrive,
  Layers3,
  ListOrdered,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  WandSparkles
} from 'lucide-react';
import type {
  AppSettings,
  HardwareProfile,
  LogEntry,
  MergeLaneId,
  QualityProfile,
  QueueJob,
  ResourceProfile,
  TimelineRow,
  WorkbenchSlot,
  WorkbenchStorageSummary,
  WorkbenchSlotState
} from '@shared/types/domain';
import { parseInputText } from '@shared/utils/input-parser';
import { sanitizeFilename } from '@shared/utils/filename';
import { shouldShowInlineBlockingIssue } from '@shared/utils/notification-policy';
import { formatTimelineCopyText, formatTimestamp } from '@shared/utils/timestamp';
import { shouldAnimateJobProgress } from '@shared/utils/progress-policy';
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
import { audioModeLabel, statusLabel } from '../utils/vi-labels';

interface MergeForm {
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

type MergeMap<T> = Record<MergeLaneId, T>;
type WorkflowState = 'idle' | 'running' | 'paused' | 'failed' | 'completed';

const MERGE_IDS: MergeLaneId[] = ['merge-1', 'merge-2', 'merge-3', 'merge-4'];
const ACTIVE = [
  'pending',
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying'
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

function mergeErrorTechnical(job: QueueJob, log: LogEntry | null): string {
  return JSON.stringify(
    {
      time: log?.timestamp ?? job.finishedAt ?? job.updatedAt,
      component: log?.module ?? 'queue',
      eventCode: log?.eventCode ?? job.errorCode ?? 'JOB_FAILED',
      message: job.errorMessage ?? log?.message ?? 'Lỗi chưa xác định.',
      projectId: job.projectId ?? log?.projectId ?? null,
      jobId: job.id,
      metadata: log?.metadata ?? {
        errorCode: job.errorCode ?? null,
        jobType: job.type,
        attempts: job.attempts,
        input: job.input
      }
    },
    null,
    2
  );
}
function mergeNumber(slot: MergeLaneId): number {
  return Number(slot.slice('merge-'.length));
}
function clampCount(value: number): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(4, Math.round(value || 1))) as 1 | 2 | 3 | 4;
}
function mapOf<T>(factory: (slot: MergeLaneId) => T): MergeMap<T> {
  return Object.fromEntries(MERGE_IDS.map((slot) => [slot, factory(slot)])) as MergeMap<T>;
}
function childFolder(base: string, name: string): string {
  return base ? `${base.replace(/[\\/]+$/, '')}\\${name}` : '';
}
function workflowState(jobs: QueueJob[]): WorkflowState {
  if (jobs.some((job) => ACTIVE.includes(job.status))) return 'running';
  if (jobs.some((job) => job.status === 'paused' || job.status === 'interrupted')) return 'paused';
  if (jobs.some((job) => job.status === 'failed')) return 'failed';
  if (jobs.length > 0 && jobs.every((job) => ['completed', 'skipped', 'cancelled'].includes(job.status)))
    return 'completed';
  return 'idle';
}
function emptyMerge(
  slot: MergeLaneId,
  settings: AppSettings | null,
  qualities: QualityProfile[],
  resources: ResourceProfile[]
): MergeForm {
  const number = mergeNumber(slot);
  const finalFileName = `Thanh_pham_${number}`;
  const rememberedSource = loadWorkbenchPath('merge-source');
  const rememberedTemp = loadWorkbenchPath('merge-temp');
  const rememberedOutput = loadWorkbenchPath('merge-output');
  return {
    name: finalFileName,
    linksText: '',
    sourceFolder:
      rememberedSource ?? childFolder(settings?.defaultSourceFolder ?? '', `Quy_trinh_ghep_${number}`),
    tempFolder: rememberedTemp ?? childFolder(settings?.defaultTempFolder ?? '', `Quy_trinh_ghep_${number}`),
    outputFolder:
      rememberedOutput ?? childFolder(settings?.defaultOutputFolder ?? '', `Quy_trinh_ghep_${number}`),
    finalFileName,
    qualityProfileId: settings?.defaultQualityProfileId ?? qualities[0]?.id ?? 'quality-source-size',
    resourceProfileId: settings?.defaultResourceProfileId ?? resources[0]?.id ?? 'resource-interactive',
    exportTimelineTxt: false
  };
}
function recommendedMergeLimit(hardware: HardwareProfile | null): { pipelines: 1 | 2 | 3 | 4; note: string } {
  if (!hardware) return { pipelines: 1, note: 'Chưa đọc cấu hình máy.' };
  const ramGb = hardware.totalMemoryBytes / 1024 ** 3;
  if (hardware.logicalCpuCount >= 48 && ramGb >= 64) {
    return {
      pipelines: 2,
      note: 'Máy rất mạnh, nhưng việc mã hóa và kiểm tra nhiều quy trình thường bị giới hạn bởi ổ đĩa và bộ xử lý đồ họa. Khuyến nghị 2 quy trình hoạt động cùng lúc; chỉ tăng 3–4 khi phần lớn video có thể ghép trực tiếp.'
    };
  }
  if (hardware.logicalCpuCount >= 16 && ramGb >= 24) {
    return {
      pipelines: 2,
      note: 'Khuyến nghị tối đa 2 quy trình đồng thời; dùng 1 khi xuất 4K, HEVC hoặc chuẩn hóa nhiều video.'
    };
  }
  return { pipelines: 1, note: 'Khuyến nghị chạy từng quy trình để Windows vẫn phản hồi tốt.' };
}
function profileSummary(profile: QualityProfile | undefined): string {
  if (!profile) return 'Chưa chọn cấu hình';
  const size = profile.maxHeight ? `${profile.maxHeight}p` : 'tối đa theo nguồn';
  const fps = profile.fpsMode === 'source' ? 'FPS nguồn' : `${profile.fpsMode} FPS`;
  return `${size} · ${fps} · ${profile.videoCodec.toUpperCase()} · ${audioModeLabel(profile.audioMode)}`;
}
function profileOptionLabel(profile: QualityProfile): string {
  if (profile.id === 'quality-source-size') return `${profile.name} · KHUYÊN DÙNG`;
  if (profile.id === 'quality-reference-1080p') return `${profile.name} · ĐỒNG NHẤT 1080P`;
  if (profile.id === 'quality-smart-merge') return `${profile.name} · ÍT MÃ HÓA LẠI`;
  if (profile.id === 'quality-4k') return `${profile.name} · 4K/HEVC`;
  if (profile.id === 'quality-smooth') return `${profile.name} · ƯU TIÊN MÁY MƯỢT`;
  if (profile.id === 'quality-max-cpu') return `${profile.name} · CHẤT LƯỢNG CPU`;
  return profile.name;
}
function profileAdvice(profile: QualityProfile | undefined): {
  tone: 'good' | 'warn' | 'info';
  title: string;
  detail: string;
} {
  if (!profile) {
    return {
      tone: 'warn',
      title: 'Chưa có cấu hình đầu ra',
      detail: 'Hãy chọn chất lượng trước khi bắt đầu.'
    };
  }
  if (profile.id === 'quality-reference-1080p') {
    return {
      tone: 'info',
      title: 'Mạnh nhất khi cần mọi video đồng nhất 1080p/30 FPS',
      detail:
        'Xuất H.264/AAC dễ dựng trên CapCut và nhiều thiết bị. Đổi lại, video được mã hóa lại nên dung lượng có thể khác nguồn.'
    };
  }
  if (profile.id === 'quality-source-size') {
    return {
      tone: 'good',
      title: 'KHUYÊN DÙNG · nguồn tốt nhất đa nền tảng và ghép nhanh',
      detail:
        'yt-dlp tự xử lý YouTube, Google Drive, TikTok, Facebook, Instagram, Vimeo và nền tảng được hỗ trợ. Video tương thích được ghép stream-copy; chỉ video lệch chuẩn mới xử lý.'
    };
  }
  if (profile.mode === 'smart_merge' || profile.mode === 'highest_source') {
    return {
      tone: 'good',
      title: 'Khuyên dùng để giữ độ nét nguồn',
      detail:
        'Không giảm 2K/4K; video đã tương thích được sao chép, chỉ luồng thật sự lệch chuẩn mới mã hóa lại.'
    };
  }
  if ((profile.maxHeight ?? Number.POSITIVE_INFINITY) <= 720) {
    return {
      tone: 'warn',
      title: 'Cấu hình này có thể làm video mờ',
      detail: 'Nguồn 1080p/2K/4K sẽ bị hạ xuống tối đa 720p. Chỉ dùng khi cần tệp nhẹ hoặc xem thử.'
    };
  }
  if ((profile.maxHeight ?? Number.POSITIVE_INFINITY) <= 1080) {
    return {
      tone: 'info',
      title: 'Đầu ra giới hạn ở 1080p',
      detail:
        'Nguồn 2K/4K sẽ giảm độ phân giải. Muốn giữ chi tiết, chọn “Ghép thông minh chất lượng cao nhất” hoặc “1440p Chất lượng cao”.'
    };
  }
  return {
    tone: 'good',
    title: 'Cấu hình giữ độ phân giải cao',
    detail: profile.description
  };
}

function jobInputText(job: QueueJob | undefined, key: string): string | null {
  const value = job?.input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function outputPath(folder: string, file: string): string {
  return folder ? `${folder.replace(/[\\/]+$/, '')}\\${file}` : file;
}

function timelineRowsOf(job: QueueJob | undefined): TimelineRow[] {
  const value = job?.input.timelineRows;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is TimelineRow => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    return (
      Number.isFinite(item.index) &&
      Number.isFinite(item.start) &&
      Number.isFinite(item.end) &&
      Number.isFinite(item.duration) &&
      typeof item.code === 'string' &&
      typeof item.label === 'string' &&
      typeof item.note === 'string' &&
      typeof item.file === 'string'
    );
  });
}

function numberFromJob(job: QueueJob | undefined, key: string): number | null {
  const value = job?.input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactTime(seconds: number | null): string {
  if (seconds === null) return '--:--';
  return formatTimestamp(Math.max(0, Math.round(seconds)));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unit;
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function MergeDetailedProgress({ jobs }: { jobs: QueueJob[] }): React.JSX.Element {
  const job = jobs.find((item) => item.type === 'merge');
  const stage = jobInputText(job, 'progressStage') ?? (job ? statusLabel(job.status) : 'Chờ tạo tác vụ ghép');
  const elapsed = numberFromJob(job, 'progressElapsedSeconds');
  const processed = numberFromJob(job, 'progressProcessedSeconds');
  const total = numberFromJob(job, 'progressTotalSeconds');
  const currentItem = numberFromJob(job, 'progressCurrentItem');
  const itemCount = numberFromJob(job, 'progressItemCount');
  const progress = job?.progress ?? 0;
  const animate = Boolean(job && shouldAnimateJobProgress(job.status));

  return (
    <section className="merge-detailed-progress">
      <header>
        <div>
          <span>TIẾN TRÌNH GHÉP RIÊNG</span>
          <b>{stage}</b>
        </div>
        <Gauge size={19} />
      </header>
      <div className={`progress progress-large ${animate ? 'is-animated' : 'is-static'}`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="merge-progress-grid">
        <div>
          <span>Hoàn thành</span>
          <b>{progress.toFixed(1)}%</b>
        </div>
        <div>
          <span>Tốc độ xử lý</span>
          <b>{job?.speed ?? (animate ? 'Đang đo...' : '—')}</b>
        </div>
        <div>
          <span>Đã chạy</span>
          <b>{compactTime(elapsed)}</b>
        </div>
        <div>
          <span>Còn lại</span>
          <b>
            {job?.etaSeconds !== null && job?.etaSeconds !== undefined && job.etaSeconds > 0
              ? compactTime(job.etaSeconds)
              : job?.status === 'completed'
                ? '00:00'
                : '--:--'}
          </b>
        </div>
      </div>
      <div className="merge-progress-foot">
        <span>
          {processed !== null && total !== null && total > 0
            ? `${compactTime(processed)} / ${compactTime(total)} nội dung`
            : 'Thời lượng sẽ xuất hiện khi đọc xong video nguồn'}
        </span>
        <span>
          {currentItem !== null && itemCount !== null && currentItem > 0
            ? `Video ${currentItem}/${itemCount}`
            : itemCount
              ? `${itemCount} video trong sản phẩm`
              : 'Chờ nguồn'}
        </span>
      </div>
    </section>
  );
}

function MergeProductionPanel({
  form,
  jobs,
  storage,
  onNotice,
  setError
}: {
  form: MergeForm;
  jobs: QueueJob[];
  storage: WorkbenchStorageSummary | null;
  onNotice: (title: string, message: string, severity?: 'info' | 'success' | 'warning') => void;
  setError: (error: string | null) => void;
}): React.JSX.Element {
  const items = parseInputText(form.linksText).filter((item) => item.validity !== 'invalid');
  const downloadJobs = jobs.filter((job) => job.type === 'download');
  const clipJobs = jobs.filter((job) => job.type === 'clip' || job.type === 'normalize');
  const mergeJob = jobs.find((job) => job.type === 'merge');
  const timelineRows = timelineRowsOf(mergeJob);
  const hasActualTimeline = timelineRows.length > 0;
  const safeName = sanitizeFilename(form.finalFileName.replace(/\.mp4$/i, ''), 'Thành phẩm');
  const video = jobInputText(mergeJob, 'outputPath') ?? outputPath(form.outputFolder, `${safeName}.mp4`);
  const completedDownloads = downloadJobs.filter((job) =>
    ['completed', 'skipped'].includes(job.status)
  ).length;
  const completedClips = clipJobs.filter((job) => ['completed', 'skipped'].includes(job.status)).length;
  const mergeCompleted = mergeJob?.status === 'completed';

  const stages = [
    {
      label: 'Tải nguồn',
      value: downloadJobs.length ? `${completedDownloads}/${downloadJobs.length}` : 'Chờ bắt đầu',
      active: downloadJobs.some((job) => ACTIVE.includes(job.status)),
      done: downloadJobs.length > 0 && completedDownloads === downloadJobs.length
    },
    {
      label: 'Cắt / chuẩn hóa',
      value: clipJobs.length ? `${completedClips}/${clipJobs.length}` : 'Tự động khi cần',
      active: clipJobs.some((job) => ACTIVE.includes(job.status)),
      done: clipJobs.length > 0 && completedClips === clipJobs.length
    },
    {
      label: 'Ghép thành phẩm',
      value: mergeJob ? `${statusLabel(mergeJob.status)} · ${mergeJob.progress.toFixed(1)}%` : 'Chờ nguồn',
      active: Boolean(mergeJob && ACTIVE.includes(mergeJob.status)),
      done: mergeCompleted
    },
    {
      label: 'Timeline TXT',
      value: mergeCompleted ? 'Sẵn sàng chọn nơi lưu' : 'Xuất thủ công sau khi ghép',
      active: false,
      done: mergeCompleted
    }
  ];
  const copyTimelineMark = async (row: TimelineRow): Promise<void> => {
    const text = formatTimelineCopyText(row.start);
    try {
      await window.desktop.app.writeClipboard(text);
      onNotice(
        `Đã copy ${text}`,
        `Chỉ mốc “${text}” được đưa vào bộ nhớ tạm; không kèm Video_${String(row.index).padStart(3, '0')}.`
      );
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const exportTimelineFile = async (): Promise<void> => {
    if (!hasActualTimeline) return;
    try {
      const saved = await window.desktop.dialogs.saveTextFile({
        defaultName: `${safeName}.timeline.txt`,
        defaultFolder: form.outputFolder,
        content: timelineRows.map((row) => row.code).join('\r\n')
      });
      if (saved) onNotice('Đã xuất timeline TXT', saved);
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const finalRatio =
    storage && storage.downloadedBytes > 0 && storage.finalBytes > 0
      ? storage.finalBytes / storage.downloadedBytes
      : null;
  const storageWarning = finalRatio !== null && finalRatio < 0.55;

  return (
    <section className="merge-production-panel">
      <header>
        <div>
          <span>ĐẦU RA SẢN PHẨM</span>
          <b>Thành phẩm nằm trực tiếp trong thư mục đã chọn</b>
        </div>
        <button
          className="icon-action"
          type="button"
          title="Xuất timeline TXT và chọn nơi lưu"
          aria-label="Xuất timeline TXT và chọn nơi lưu"
          disabled={!hasActualTimeline}
          onClick={() => void exportTimelineFile()}
        >
          <FileDown size={17} />
        </button>
      </header>
      <div className="merge-stage-grid">
        {stages.map((stage, index) => (
          <div
            className={`merge-stage ${stage.active ? 'is-active' : ''} ${stage.done ? 'is-done' : ''}`}
            key={stage.label}
          >
            <span>
              {stage.done ? (
                <CheckCircle2 size={16} />
              ) : stage.active ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : index === 0 ? (
                <Download size={16} />
              ) : (
                <span>{index + 1}</span>
              )}
            </span>
            <div>
              <b>{stage.label}</b>
              <small>{stage.value}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="merge-timeline-preview">
        <div className="merge-timeline-heading">
          <div>
            <b>Timeline theo định dạng dựng</b>
            <small>Copy từng mốc hoặc nhấn biểu tượng Lưu để chọn nơi xuất TXT</small>
          </div>
          <span>
            {hasActualTimeline
              ? `${timelineRows.length} mốc thời gian thực`
              : `${items.length} đoạn đang chờ tính thời gian`}
          </span>
        </div>
        <div className="merge-timeline-rows scroll">
          {items.length === 0 && <div className="empty-state">Dán liên kết để xem trước thứ tự ghép.</div>}
          {hasActualTimeline
            ? timelineRows.map((row) => (
                <div className="merge-timeline-row is-actual" key={`${row.index}-${row.start}`}>
                  <div className="merge-timeline-mark">
                    <button
                      title={`Chỉ copy ${formatTimelineCopyText(row.start)}`}
                      aria-label={`Chỉ copy ${formatTimelineCopyText(row.start)}`}
                      onClick={() => void copyTimelineMark(row)}
                    >
                      <Copy size={13} />
                    </button>
                    <code>
                      <span>{formatTimelineCopyText(row.start)}</span>
                      <em>Video_{String(row.index).padStart(3, '0')}</em>
                    </code>
                  </div>
                  <div>
                    <b title={row.label}>{row.label}</b>
                    <small>
                      Kết thúc {formatTimestamp(row.end)} · {row.duration.toFixed(1)} giây
                      {row.note ? ` · ${row.note}` : ''}
                    </small>
                  </div>
                </div>
              ))
            : items.map((item, index) => (
                <div className="merge-timeline-row" key={`${item.lineNumber}-${index}`}>
                  <div className="merge-timeline-mark">
                    <button disabled aria-label="Mốc thời gian chưa sẵn sàng">
                      <Copy size={13} />
                    </button>
                    <code>
                      <span>--:-- Ph</span>
                      <em>Video_{String(index + 1).padStart(3, '0')}</em>
                    </code>
                  </div>
                  <div>
                    <b title={item.normalizedUrl ?? item.originalText}>
                      {item.mediaId ?? item.normalizedUrl ?? item.originalText}
                    </b>
                    <small>
                      {item.timestampStartSeconds !== null
                        ? `Bắt đầu ${item.timestampStartSeconds}s`
                        : 'Từ đầu'}
                      {item.timestampEndSeconds !== null ? ` → ${item.timestampEndSeconds}s` : ''}
                      {item.note ? ` · ${item.note}` : ''}
                    </small>
                  </div>
                </div>
              ))}
        </div>
      </div>
      <div className="merge-storage-panel">
        <div className="merge-storage-heading">
          <div>
            <b>DUNG LƯỢNG TỪ TẢI ĐẾN THÀNH PHẨM</b>
            <small>Tự cập nhật trong khi tải, xử lý và ghép</small>
          </div>
          <HardDrive size={18} />
        </div>
        <div className="merge-storage-grid">
          <div>
            <span>Video nguồn đã tải</span>
            <b>{formatBytes(storage?.downloadedBytes ?? 0)}</b>
            <small>{storage?.downloadedFileCount ?? 0} video</small>
          </div>
          <div>
            <span>Dữ liệu xử lý tạm</span>
            <b>{formatBytes(storage?.temporaryBytes ?? 0)}</b>
            <small>{storage?.temporaryFileCount ?? 0} tệp hiện còn</small>
          </div>
          <div>
            <span>Video thành phẩm</span>
            <b>{formatBytes(storage?.finalBytes ?? 0)}</b>
            <small>{storage?.finalFileCount ? 'Đã tạo thành phẩm' : 'Chưa có thành phẩm'}</small>
          </div>
          <div className="is-total">
            <span>Tổng ba giai đoạn</span>
            <b>{formatBytes(storage?.totalBytes ?? 0)}</b>
            <small>Nguồn + tạm + thành phẩm</small>
          </div>
        </div>
        {finalRatio !== null && (
          <div className={`merge-size-ratio ${storageWarning ? 'is-warning' : 'is-good'}`}>
            <AlertTriangle size={15} />
            <span>
              {storageWarning
                ? `Thành phẩm chỉ bằng ${(finalRatio * 100).toFixed(0)}% tổng nguồn. Cấu hình hiện tại đã nén lại mạnh; nếu bạn muốn tệp gần mức 6–7 GB như trước, hãy chọn “Giữ nét và dung lượng gần nguồn”.`
                : `Dung lượng thành phẩm bằng ${(finalRatio * 100).toFixed(0)}% tổng nguồn. Không phát hiện mức giảm bất thường.`}
            </span>
          </div>
        )}
      </div>
      <div className="merge-output-grid">
        <div>
          <FileVideo2 size={16} />
          <span>Video MP4</span>
          <b title={video}>{video}</b>
        </div>
        <div>
          <FileText size={16} />
          <span>Timeline TXT</span>
          <b>{hasActualTimeline ? 'Nhấn biểu tượng Lưu để chọn nơi xuất' : 'Có sau khi ghép hoàn tất'}</b>
        </div>
      </div>
    </section>
  );
}

export function DownloadMergePage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const qualities = useAppStore((state) => state.qualities);
  const resources = useAppStore((state) => state.resources);
  const hardware = useAppStore((state) => state.hardware);
  const jobs = useAppStore((state) => state.jobs);
  const logs = useAppStore((state) => state.logs);
  const setSettings = useAppStore((state) => state.setSettings);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const clearProjectLogs = useAppStore((state) => state.clearProjectLogs);
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const refreshProjects = useAppStore((state) => state.refreshProjects);

  const [forms, setForms] = useState<MergeMap<MergeForm>>(() =>
    mapOf((slot) => emptyMerge(slot, settings, qualities, resources))
  );
  const [states, setStates] = useState<MergeMap<WorkbenchSlotState | null>>(() => mapOf(() => null));
  const [busy, setBusy] = useState<WorkbenchSlot | 'global' | null>(null);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieTarget, setCookieTarget] = useState<MergeLaneId | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MergeLaneId | null>(null);
  const [activeLane, setActiveLane] = useState<MergeLaneId>('merge-1');
  const initializedRef = useRef(false);
  const dirtySlotsRef = useRef<Set<MergeLaneId>>(new Set());
  const deletedSlotsRef = useRef<Set<MergeLaneId>>(new Set());
  const revisionRef = useRef<MergeMap<number>>(mapOf(() => 0));
  const laneCount = settings?.mergeLaneCount ?? 1;
  const recommendation = recommendedMergeLimit(hardware);

  useEffect(() => {
    const snapshot = useAppStore.getState();
    void window.desktop.workbench
      .state()
      .then((workbench) => {
        const firstProject = workbench.mergeLanes.find((lane) => lane.project)?.project;
        if (firstProject) {
          if (!loadWorkbenchPath('merge-source'))
            saveWorkbenchPath('merge-source', firstProject.sourceFolder);
          if (!loadWorkbenchPath('merge-temp')) saveWorkbenchPath('merge-temp', firstProject.tempFolder);
          if (!loadWorkbenchPath('merge-output'))
            saveWorkbenchPath('merge-output', firstProject.outputFolder);
        }
        const nextStates = mapOf<WorkbenchSlotState | null>(() => null);
        const nextForms = mapOf((slot) =>
          emptyMerge(slot, snapshot.settings, snapshot.qualities, snapshot.resources)
        );
        for (const current of workbench.mergeLanes) {
          const slot = current.slot as MergeLaneId;
          if (!MERGE_IDS.includes(slot)) continue;
          nextStates[slot] = current;
          if (current.project) {
            nextForms[slot] = {
              name: current.project.finalFileName,
              linksText: current.items.map((item) => item.originalText).join('\n'),
              sourceFolder: current.project.sourceFolder,
              tempFolder: current.project.tempFolder,
              outputFolder: current.project.outputFolder,
              finalFileName: current.project.finalFileName,
              qualityProfileId: current.project.qualityProfileId,
              resourceProfileId: current.project.resourceProfileId,
              exportTimelineTxt: false
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
    setAttention({ id: createUiEventId('merge-ui'), severity, title, message, sticky: false });
  };
  const updateForm = (slot: MergeLaneId, updater: (current: MergeForm) => MergeForm): void => {
    deletedSlotsRef.current.delete(slot);
    dirtySlotsRef.current.add(slot);
    revisionRef.current[slot] += 1;
    setForms((current) => ({ ...current, [slot]: updater(current[slot]) }));
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
          const next = await window.desktop.workbench.saveMergeDraft({
            slot,
            ...forms[slot],
            name: forms[slot].finalFileName,
            exportTimelineTxt: false
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

  const start = async (slot: MergeLaneId): Promise<void> => {
    setBusy(slot);
    try {
      notify(
        `Đang chuẩn bị quy trình ghép ${mergeNumber(slot)}`,
        'Ứng dụng đang kiểm tra công cụ, thư mục và danh sách liên kết.',
        'info'
      );
      const next = await window.desktop.workbench.startMerge({
        slot,
        ...forms[slot],
        name: forms[slot].finalFileName,
        exportTimelineTxt: false
      });
      setStates((current) => ({ ...current, [slot]: next }));
      await Promise.all([refreshJobs(), refreshProjects()]);
      notify(
        `Quy trình ghép ${mergeNumber(slot)} đã bắt đầu`,
        'Tiến trình, lỗi và nhật ký chỉ hiển thị trong đúng quy trình này.'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const control = async (slot: MergeLaneId, action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
    setBusy(slot);
    try {
      const next = await window.desktop.workbench[action](slot);
      setStates((current) => ({ ...current, [slot]: next }));
      await refreshJobs();
      const text =
        action === 'pause' ? 'đã tạm dừng an toàn' : action === 'resume' ? 'đã tiếp tục' : 'đã hủy riêng';
      notify(
        `Quy trình ghép ${mergeNumber(slot)} ${text}`,
        action === 'cancel'
          ? 'Các quy trình ghép khác không bị ảnh hưởng.'
          : 'Hàng đợi và tệp tạm hiện tại được giữ để tiếp tục đúng vị trí.',
        action === 'cancel' ? 'warning' : 'success'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const retryFailed = async (slot: MergeLaneId, projectId?: string): Promise<void> => {
    if (!projectId) return;
    setBusy(slot);
    try {
      const count = await window.desktop.queue.retryFailed(projectId);
      await refreshJobs();
      notify(
        `Thử lại quy trình ghép ${mergeNumber(slot)}`,
        count ? `Đã đưa ${count} tác vụ lỗi về hàng chờ.` : 'Không có tác vụ lỗi cần thử lại.',
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const clearProgress = async (slot: MergeLaneId): Promise<void> => {
    setBusy(slot);
    try {
      const next = await window.desktop.workbench.clearProgress(slot);
      setStates((current) => ({ ...current, [slot]: next }));
      await refreshJobs();
      notify(
        `Đã dọn tiến trình quy trình ghép ${mergeNumber(slot)}`,
        'Danh sách liên kết, thư mục và cấu hình chất lượng vẫn được giữ.',
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const clearLogs = async (slot: MergeLaneId, projectId?: string): Promise<void> => {
    setBusy(slot);
    try {
      const next = await window.desktop.workbench.clearLogs(slot);
      setStates((current) => ({ ...current, [slot]: next }));
      if (projectId) clearProjectLogs(projectId);
      notify(
        `Đã xóa nhật ký quy trình ghép ${mergeNumber(slot)}`,
        'Nhật ký của các quy trình ghép và danh sách tải khác vẫn nguyên vẹn.',
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const changeLaneCount = async (value: number): Promise<void> => {
    const nextCount = clampCount(value);
    if (nextCount < laneCount) {
      const hiddenRunning = MERGE_IDS.slice(nextCount).some((slot) => {
        const projectId = states[slot]?.project?.id;
        return projectId
          ? workflowState(jobs.filter((job) => job.projectId === projectId)) === 'running'
          : false;
      });
      if (hiddenRunning) {
        setError(
          'Một quy trình ghép sắp bị ẩn vẫn đang chạy. Hãy tạm dừng hoặc hủy riêng quy trình đó trước.'
        );
        return;
      }
    }
    setBusy('global');
    try {
      if (nextCount > laneCount) {
        const source = forms[activeLane] ?? forms[MERGE_IDS[Math.max(0, laneCount - 1)]!];
        const target = MERGE_IDS[laneCount]!;
        const rememberedSource = loadWorkbenchPath('merge-source') ?? source.sourceFolder;
        const rememberedTemp = loadWorkbenchPath('merge-temp') ?? source.tempFolder;
        const rememberedOutput = loadWorkbenchPath('merge-output') ?? source.outputFolder;
        setForms((current) => ({
          ...current,
          [target]: {
            ...current[target],
            sourceFolder: rememberedSource,
            tempFolder: rememberedTemp,
            outputFolder: rememberedOutput,
            qualityProfileId: source.qualityProfileId,
            resourceProfileId: source.resourceProfileId
          }
        }));
        setActiveLane(target);
      } else if (mergeNumber(activeLane) > nextCount) {
        setActiveLane(MERGE_IDS[nextCount - 1]!);
      }
      const next = await window.desktop.settings.update({ mergeLaneCount: nextCount });
      setSettings(next);
      notify(
        'Đã thay đổi số quy trình ghép',
        `Hiện có ${nextCount} quy trình tải và ghép độc lập. Dữ liệu quy trình bị ẩn vẫn được giữ.`,
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const applyRecommendation = async (): Promise<void> => {
    setBusy('global');
    try {
      const visible = Math.min(laneCount, recommendation.pipelines) as 1 | 2 | 3 | 4;
      const next = await window.desktop.settings.update({ maxGlobalMergeJobs: visible });
      setSettings(next);
      notify(
        'Đã áp dụng giới hạn ghép theo máy',
        `Tối đa ${visible} quy trình được xử lý cùng lúc. Quy trình còn lại sẽ chờ lượt để máy luôn mượt.`,
        'info'
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const removeLane = async (slot: MergeLaneId): Promise<void> => {
    setBusy(slot);
    deletedSlotsRef.current.add(slot);
    dirtySlotsRef.current.delete(slot);
    revisionRef.current[slot] += 1;
    try {
      const previousProjectId = states[slot]?.project?.id;
      const next = await window.desktop.workbench.remove(slot);
      setStates((current) => ({ ...current, [slot]: next }));
      setForms((current) => ({ ...current, [slot]: emptyMerge(slot, settings, qualities, resources) }));
      if (previousProjectId) clearProjectLogs(previousProjectId);
      await Promise.all([refreshJobs(), refreshProjects()]);
      notify(
        `Đã xóa quy trình ghép ${mergeNumber(slot)}`,
        'Hàng đợi, liên kết, tiến trình và nhật ký đã được dọn. Video nguồn và thành phẩm trên ổ đĩa vẫn được giữ.',
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

  const openCookies = (slot: MergeLaneId | null): void => {
    setCookieTarget(slot);
    setCookieOpen(true);
  };
  const resumeAfterCookies = async (): Promise<void> => {
    if (!cookieTarget) return;
    const workbench = await window.desktop.workbench.state();
    const next = workbench.mergeLanes.find((lane) => lane.slot === cookieTarget) ?? null;
    setStates((current) => ({ ...current, [cookieTarget]: next }));
    await refreshJobs();
  };

  return (
    <div className="page-shell">
      <header className="page-heading">
        <div>
          <h1>Tải & ghép đa nền tảng</h1>
          <p>Nhiều quy trình độc lập, đầu ra rõ ràng và tự dọn dữ liệu tạm.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={busy === 'global' || laneCount <= 1}
            onClick={() => void changeLaneCount(laneCount - 1)}
          >
            <Minus size={16} />
            Bớt quy trình
          </button>
          <div className="badge badge-strong">
            <Layers3 size={15} />
            {laneCount}/4 quy trình
          </div>
          <button
            className="btn btn-primary"
            disabled={busy === 'global' || laneCount >= 4}
            onClick={() => void changeLaneCount(laneCount + 1)}
          >
            <Plus size={16} />
            Thêm quy trình
          </button>
        </div>
      </header>

      <div className="workflow-utility-stack mt-4">
        <ToolReadinessPanel workflow="merge" />
        <InfoDisclosure
          className="merge-recommend-disclosure"
          icon={Gauge}
          title="Mức xử lý song song"
          summary={`Đang cho phép ${settings?.maxGlobalMergeJobs ?? 1} quy trình · máy khuyến nghị ${recommendation.pipelines}`}
          status={(settings?.maxGlobalMergeJobs ?? 1) <= recommendation.pipelines ? 'HỢP LÝ' : 'CẦN LƯU Ý'}
          tone={(settings?.maxGlobalMergeJobs ?? 1) <= recommendation.pipelines ? 'good' : 'warning'}
          actions={
            <>
              <button
                className="btn btn-small btn-primary"
                disabled={busy === 'global'}
                onClick={() => void applyRecommendation()}
              >
                {busy === 'global' ? (
                  <LoaderCircle className="animate-spin" size={15} />
                ) : (
                  <Settings2 size={15} />
                )}
                Theo máy
              </button>
              <button className="btn btn-small" onClick={() => openCookies(null)}>
                <Cookie size={15} />
                Cookies
              </button>
            </>
          }
        >
          <div className="merge-recommend-detail">
            <p>{recommendation.note}</p>
            <div className="merge-recommend-metrics">
              <span>
                Giới hạn hiện tại <b>{settings?.maxGlobalMergeJobs ?? 1}</b>
              </span>
              <span>
                Khuyến nghị <b>{recommendation.pipelines}</b>
              </span>
            </div>
          </div>
        </InfoDisclosure>
      </div>

      <nav className="workflow-tabs mt-4" aria-label="Quy trình tải và ghép">
        {MERGE_IDS.slice(0, laneCount).map((slot) => {
          const projectId = states[slot]?.project?.id;
          const laneJobs = projectId ? jobs.filter((job) => job.projectId === projectId) : [];
          const laneState = workflowState(laneJobs);
          return (
            <button
              key={slot}
              className={`workflow-tab workflow-state-${laneState} ${activeLane === slot ? 'is-active' : ''}`}
              onClick={() => setActiveLane(slot)}
            >
              <b>{forms[slot].name || `Quy trình ${mergeNumber(slot)}`}</b>
              <span>
                {laneState === 'running'
                  ? 'Đang xử lý'
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

      <div className="merge-lane-grid merge-lane-grid-single mt-4">
        {MERGE_IDS.slice(0, laneCount)
          .filter((slot) => slot === activeLane)
          .map((slot) => {
            const projectId = states[slot]?.project?.id;
            return (
              <MergeLaneCard
                key={slot}
                slot={slot}
                form={forms[slot]}
                update={(updater) => updateForm(slot, updater)}
                qualities={qualities}
                resources={resources}
                jobs={projectId ? jobs.filter((job) => job.projectId === projectId) : []}
                liveLogs={projectId ? logs.filter((entry) => entry.projectId === projectId) : []}
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
        onConfigured={resumeAfterCookies}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Xóa quy trình ghép ${mergeNumber(deleteTarget)}?` : 'Xóa quy trình ghép?'}
        message="Ứng dụng sẽ hủy các tác vụ nền, xóa danh sách liên kết, hàng đợi và nhật ký của quy trình khỏi ứng dụng."
        details={[
          'Các quy trình khác không bị ảnh hưởng.',
          'Video nguồn đã tải và thành phẩm trên ổ đĩa vẫn được giữ nguyên.',
          'Thao tác này không thể hoàn tác trong ứng dụng.'
        ]}
        confirmLabel="Xóa quy trình"
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

function MergeLaneCard({
  slot,
  form,
  update,
  qualities,
  resources,
  jobs,
  liveLogs,
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
  slot: MergeLaneId;
  form: MergeForm;
  update: (updater: (current: MergeForm) => MergeForm) => void;
  qualities: QualityProfile[];
  resources: ResourceProfile[];
  jobs: QueueJob[];
  liveLogs: LogEntry[];
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
  const [persistedLogs, setPersistedLogs] = useState<LogEntry[]>([]);
  const [storage, setStorage] = useState<WorkbenchStorageSummary | null>(null);
  const state = workflowState(jobs);
  const number = mergeNumber(slot);
  const failed = jobs.filter((job) => job.status === 'failed');
  const completed = jobs.filter((job) => ['completed', 'skipped'].includes(job.status)).length;
  const skippedDownloads = jobs.filter((job) => job.type === 'download' && job.status === 'skipped').length;
  const blocking = jobs.find((job) => shouldShowInlineBlockingIssue(job, BLOCKING_CODES));
  const progress = jobs.length ? jobs.reduce((sum, job) => sum + job.progress, 0) / jobs.length : 0;
  const activeJob = jobs.find((job) => ACTIVE.includes(job.status));
  const hasActiveJobs = Boolean(activeJob);
  const quality = qualities.find((profile) => profile.id === form.qualityProfileId);
  const qualityAdvice = profileAdvice(quality);
  const progressDetail = activeJob
    ? [
        skippedDownloads > 0 ? `${skippedDownloads} video đã tải trước đó` : null,
        activeJob.speed ?? 'Đang xử lý phần còn lại'
      ]
        .filter(Boolean)
        .join(' · ')
    : failed.length > 0
      ? `${failed.length} lỗi`
      : skippedDownloads > 0
        ? `${skippedDownloads} video đã tải trước đó – đã bỏ qua`
        : completed > 0
          ? `${completed} tác vụ đã hoàn tất`
          : 'Chưa có tác vụ';

  useEffect(() => {
    if (!projectId || (!showLogs && failed.length === 0)) return;
    void window.desktop.logs
      .list({ projectId, limit: 500 })
      .then(setPersistedLogs)
      .catch((error: unknown) => setError(messageOf(error)));
  }, [failed.length, projectId, setError, showLogs]);

  useEffect(() => {
    if (!projectId) {
      setStorage(null);
      return;
    }
    let disposed = false;
    let timer: number | null = null;
    const refreshStorage = async (): Promise<void> => {
      try {
        const next = await window.desktop.workbench.storage(slot);
        if (!disposed)
          setStorage((current) => {
            if (
              current &&
              current.downloadedBytes === next.downloadedBytes &&
              current.temporaryBytes === next.temporaryBytes &&
              current.finalBytes === next.finalBytes &&
              current.totalBytes === next.totalBytes &&
              current.downloadedFileCount === next.downloadedFileCount &&
              current.temporaryFileCount === next.temporaryFileCount &&
              current.finalFileCount === next.finalFileCount
            )
              return current;
            return next;
          });
      } catch (error) {
        if (!disposed) setError(messageOf(error));
      } finally {
        if (!disposed) {
          const delay = document.hidden ? 20_000 : hasActiveJobs ? 4_000 : 12_000;
          timer = window.setTimeout(() => void refreshStorage(), delay);
        }
      }
    };
    void refreshStorage();
    const onVisibility = (): void => {
      if (!document.hidden) {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        void refreshStorage();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [hasActiveJobs, projectId, setError, slot]);

  const combinedLogs = useMemo(() => {
    const byId = new Map<string, LogEntry>();
    for (const entry of [...liveLogs, ...persistedLogs]) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [liveLogs, persistedLogs]);
  const latestFailedJob =
    [...failed].sort((a, b) => (b.finishedAt ?? b.updatedAt).localeCompare(a.finishedAt ?? a.updatedAt))[0] ??
    null;
  const latestFailureLog = latestFailedJob
    ? (combinedLogs.find(
        (entry) =>
          entry.jobId === latestFailedJob.id && (entry.level === 'error' || entry.eventCode === 'JOB_FAILED')
      ) ?? null)
    : null;

  const paste = async (): Promise<void> => {
    try {
      const text = await window.desktop.app.readClipboard();
      if (text) {
        update((current) => ({ ...current, linksText: text }));
        onNotice(
          `Đã dán vào quy trình ${number}`,
          `${text.split(/\r?\n/).filter((line) => line.trim()).length} dòng được đưa vào danh sách.`,
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
        onNotice(`Đã nhập TXT vào quy trình ${number}`, `Đã đọc danh sách từ ${file.path}.`, 'info');
      }
    } catch (error) {
      setError(messageOf(error));
    }
  };
  const openOutput = async (): Promise<void> => {
    try {
      await window.desktop.app.showPath(form.outputFolder);
      onNotice(`Đã mở thư mục quy trình ${number}`, form.outputFolder, 'info');
    } catch (error) {
      setError(messageOf(error));
    }
  };

  const primary =
    state === 'running'
      ? { label: 'Tạm dừng quy trình', icon: Pause, action: () => onControl('pause') }
      : state === 'paused'
        ? { label: 'Tiếp tục quy trình', icon: RotateCcw, action: () => onControl('resume') }
        : { label: failed.length ? 'Chạy lại quy trình' : 'Bắt đầu tải & ghép', icon: Play, action: onStart };
  const PrimaryIcon = primary.icon;
  const canStart = Boolean(
    form.linksText.trim() &&
    form.sourceFolder &&
    form.tempFolder &&
    form.outputFolder &&
    form.finalFileName.trim()
  );
  const locked = state === 'running' || state === 'paused' || busy;
  const storageRatio =
    storage && storage.downloadedBytes > 0 && storage.finalBytes > 0
      ? storage.finalBytes / storage.downloadedBytes
      : null;
  const recommendSourceSize =
    quality?.id !== 'quality-source-size' &&
    (quality?.id === 'quality-reference-1080p' ||
      (quality?.bitrateMode !== 'source_average' && storageRatio !== null && storageRatio < 0.55));

  return (
    <section className={`merge-lane-card lane-state-${state}`}>
      <header className="lane-header">
        <div className="lane-title">
          <WandSparkles size={18} />
          Sản phẩm {number}
        </div>
        <div className="flex items-center gap-2">
          {state === 'running' && (
            <span className="live-indicator">
              <i />
              ĐANG XỬ LÝ
            </span>
          )}
          <StatusBadge status={state === 'running' ? 'merging' : state} />
        </div>
      </header>
      <div className="lane-body">
        {blocking && <MergeBlockingCard job={blocking} onCookies={onCookies} />}
        {latestFailedJob && (
          <MergeErrorDetailPanel
            job={latestFailedJob}
            log={latestFailureLog}
            onOpenLogs={() => setShowLogs(true)}
          />
        )}
        <label className="merge-product-name">
          <span className="label">Tên sản phẩm đầu ra</span>
          <input
            className="input"
            disabled={locked}
            value={form.finalFileName}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              update((current) => ({
                ...current,
                name: event.target.value,
                finalFileName: event.target.value
              }))
            }
            placeholder="Ví dụ: Tong_hop_video_01"
          />
        </label>
        <div>
          <div className="field-heading">
            <span className="label mb-0">Danh sách link theo thứ tự ghép</span>
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
            className="textarea merge-textarea font-mono text-xs"
            disabled={locked}
            value={form.linksText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              update((current) => ({ ...current, linksText: event.target.value }))
            }
            placeholder={
              'Mỗi dòng một link. Thứ tự dòng là thứ tự ghép.\nCó thể dùng ?t=83 hoặc start=83 end=105.'
            }
          />
          <div className="field-hint">
            {form.linksText.split(/\r?\n/).filter((line) => line.trim()).length} video/đoạn trong quy trình
          </div>
        </div>
        <div className="compact-config-grid merge-config-grid">
          <div className="compact-config-source">
            <FolderField
              label="Thư mục video nguồn"
              disabled={locked}
              value={form.sourceFolder}
              onChange={(value) => {
                saveWorkbenchPath('merge-source', value);
                update((current) => ({ ...current, sourceFolder: value }));
              }}
            />
          </div>
          <div className="compact-config-temp">
            <FolderField
              label="Thư mục xử lý tạm"
              disabled={locked}
              value={form.tempFolder}
              onChange={(value) => {
                saveWorkbenchPath('merge-temp', value);
                update((current) => ({ ...current, tempFolder: value }));
              }}
            />
          </div>
          <div className="compact-config-output">
            <FolderField
              label="Thư mục thành phẩm"
              disabled={locked}
              value={form.outputFolder}
              onChange={(value) => {
                saveWorkbenchPath('merge-output', value);
                update((current) => ({ ...current, outputFolder: value }));
              }}
            />
          </div>
          <label className="compact-config-quality">
            <span className="label">Chất lượng thành phẩm ghép</span>
            <select
              className="select"
              disabled={locked}
              value={form.qualityProfileId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                update((current) => ({ ...current, qualityProfileId: event.target.value }))
              }
            >
              {qualities.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profileOptionLabel(profile)}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-config-profile">
            <span className="label">Cấu hình hiệu năng</span>
            <select
              className="select"
              disabled={locked}
              value={form.resourceProfileId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                update((current) => ({ ...current, resourceProfileId: event.target.value }))
              }
            >
              {resources.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · FFmpeg {profile.ffmpegThreads} luồng xử lý
                </option>
              ))}
            </select>
          </label>
        </div>
        <InfoDisclosure
          className="merge-quality-disclosure"
          icon={Settings2}
          title={quality?.name ?? 'Chưa chọn chất lượng'}
          summary={profileSummary(quality)}
          status={
            qualityAdvice.tone === 'warn'
              ? 'CÓ THỂ GIẢM NÉT'
              : qualityAdvice.tone === 'good'
                ? 'PHÙ HỢP'
                : 'THÔNG TIN'
          }
          tone={qualityAdvice.tone === 'warn' ? 'warning' : qualityAdvice.tone}
          autoOpen={false}
          actions={
            recommendSourceSize ? (
              <button
                className="btn btn-small merge-source-size-button"
                disabled={locked}
                onClick={() => update((current) => ({ ...current, qualityProfileId: 'quality-source-size' }))}
              >
                <HardDrive size={15} />
                Giữ gần nguồn
              </button>
            ) : undefined
          }
        >
          <div className="merge-quality-detail-grid">
            <div>
              <ShieldCheck size={16} />
              <span>
                <b>Nguồn đa nền tảng, mỗi link được nhận diện riêng</b>
                <small>
                  Hỗ trợ mọi URL mà yt-dlp xử lý được; file trùng tên vẫn không bị bỏ qua vì Tubmedia đánh dấu
                  theo link.
                </small>
              </span>
            </div>
            <div>
              <ShieldCheck size={16} />
              <span>
                <b>{qualityAdvice.title}</b>
                <small>{qualityAdvice.detail}</small>
              </span>
            </div>
          </div>
        </InfoDisclosure>
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
                    : state === 'failed'
                      ? 'Cần xử lý lỗi'
                      : 'Sẵn sàng'}
            </b>
            <strong>
              {completed}/{jobs.length}
            </strong>
          </div>
          <div
            className={`progress progress-large ${activeJob && shouldAnimateJobProgress(activeJob.status) ? 'is-animated' : 'is-static'}`}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-meta">
            <span>{progress.toFixed(1)}% toàn quy trình</span>
            <span>{progressDetail}</span>
          </div>
        </div>
        <details className="workflow-detail-disclosure">
          <summary>
            <span>
              <ListOrdered size={16} />
              Chi tiết đầu ra, dung lượng và timeline
            </span>
            <ChevronDown size={16} />
          </summary>
          <div className="workflow-detail-body">
            <MergeDetailedProgress jobs={jobs} />
            <MergeProductionPanel
              form={form}
              jobs={jobs}
              storage={storage}
              onNotice={onNotice}
              setError={setError}
            />
          </div>
        </details>
        <div className="lane-primary-actions">
          <button
            className={`btn btn-primary workflow-primary ${state === 'running' ? 'is-running' : ''}`}
            disabled={busy || (state !== 'running' && state !== 'paused' && !canStart)}
            onClick={() => void primary.action()}
          >
            {busy ? <LoaderCircle className="animate-spin" size={18} /> : <PrimaryIcon size={18} />}
            {busy ? 'Đang thực hiện...' : primary.label}
          </button>
          <button
            className="btn btn-danger"
            disabled={busy || jobs.length === 0 || state === 'idle'}
            onClick={() => void onControl('cancel')}
          >
            <Square size={17} />
            Hủy riêng quy trình
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
            title="Dọn tiến trình đã dừng"
            aria-label="Dọn tiến trình đã dừng"
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
            title="Mở thư mục thành phẩm"
            aria-label="Mở thư mục thành phẩm"
            disabled={!form.outputFolder}
            onClick={() => void openOutput()}
          >
            <FolderOpen size={16} />
          </button>
          <button
            className="icon-action is-danger"
            title="Xóa quy trình"
            aria-label="Xóa quy trình"
            disabled={busy || !projectId}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
        <MergeLogPanel logs={combinedLogs} open={showLogs} onToggle={() => setShowLogs((value) => !value)} />
      </div>
    </section>
  );
}

function MergeErrorDetailPanel({
  job,
  log,
  onOpenLogs
}: {
  job: QueueJob;
  log: LogEntry | null;
  onOpenLogs: () => void;
}): React.JSX.Element {
  const technical = useMemo(() => mergeErrorTechnical(job, log), [job, log]);
  const time = log?.timestamp ?? job.finishedAt ?? job.updatedAt;
  const code = job.errorCode ?? 'UNHANDLED_ERROR';
  const eventCode = log?.eventCode ?? 'JOB_FAILED';
  const message = job.errorMessage ?? log?.message ?? 'Lỗi chưa xác định.';

  return (
    <section className="merge-error-detail" role="alert" aria-live="assertive">
      <header className="merge-error-detail-head">
        <span className="merge-error-detail-icon">
          <AlertTriangle size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <b>Chi tiết lỗi của quy trình</b>
          <small>
            {eventCode} · {code}
          </small>
        </div>
        <StatusBadge status="failed" fixed />
      </header>
      <div className="merge-error-summary-grid">
        <div>
          <span>Thời gian</span>
          <b>{new Date(time).toLocaleString('vi-VN')}</b>
        </div>
        <div>
          <span>Mã lỗi</span>
          <b>{code}</b>
        </div>
        <div>
          <span>Sự kiện</span>
          <b>{eventCode}</b>
        </div>
        <div>
          <span>Tác vụ</span>
          <b>{job.id}</b>
        </div>
      </div>
      <p className="merge-error-message">{message}</p>
      <div className="merge-error-actions">
        <button className="btn btn-small" onClick={() => void window.desktop.app.writeClipboard(technical)}>
          <Copy size={14} />
          Sao chép chi tiết lỗi
        </button>
        <button className="btn btn-small" onClick={onOpenLogs}>
          <FileText size={14} />
          Mở nhật ký riêng
        </button>
      </div>
      <pre className="merge-error-technical">{technical}</pre>
    </section>
  );
}

function MergeBlockingCard({ job, onCookies }: { job: QueueJob; onCookies: () => void }): React.JSX.Element {
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

function MergeLogPanel({
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
          Nhật ký riêng của quy trình
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
            {filtered.length === 0 && <div className="empty-state">Chưa có nhật ký cho quy trình này.</div>}
            {filtered.map((entry) => (
              <CompactLogRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
