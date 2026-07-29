import { join } from 'node:path';
import type {
  DownloadLaneDraftInput,
  DownloadLaneId,
  DownloadLaneInput,
  DownloadMergeInput,
  MergeLaneId,
  Project,
  WorkbenchSlot,
  WorkbenchStorageSummary,
  WorkbenchSlotState,
  WorkbenchState
} from '@shared/types/domain.js';
import type { ProjectRepository } from '../database/repositories/project-repository.js';
import type { ProjectService } from '../projects/project-service.js';
import type { InputService } from '../input/input-service.js';
import type { QueueManager } from '../queue/queue-manager.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { Logger } from '../logging/logger.js';
import type { MediaSourceRepository } from '../database/repositories/media-source-repository.js';
import { ToolHealthCheckError } from '@shared/errors/app-errors.js';
import { REQUIRED_TOOL_NAMES } from '../tools/tool-manager.js';
import { sanitizeFilename } from '@shared/utils/filename.js';
import { sizeFiles, sizePaths } from '../storage/workbench-storage.js';
import { cleanupTemporaryArtifacts } from '../files/temporary-cleanup.js';

const DOWNLOAD_LANES: DownloadLaneId[] = [
  'download-1',
  'download-2',
  'download-3',
  'download-4'
];

const MERGE_LANES: MergeLaneId[] = [
  'merge-1',
  'merge-2',
  'merge-3',
  'merge-4'
];

const SLOT_CODES: Record<WorkbenchSlot, string> = {
  'download-1': '__WORKBENCH_DOWNLOAD_1__',
  'download-2': '__WORKBENCH_DOWNLOAD_2__',
  'download-3': '__WORKBENCH_DOWNLOAD_3__',
  'download-4': '__WORKBENCH_DOWNLOAD_4__',
  'merge-1': '__WORKBENCH_MERGE_1__',
  'merge-2': '__WORKBENCH_MERGE_2__',
  'merge-3': '__WORKBENCH_MERGE_3__',
  'merge-4': '__WORKBENCH_MERGE_4__'
};

const LEGACY_CODES: Partial<Record<WorkbenchSlot, string>> = {
  'download-1': '__WORKBENCH_DOWNLOAD_A__',
  'download-2': '__WORKBENCH_DOWNLOAD_B__',
  'merge-1': '__WORKBENCH_DOWNLOAD_MERGE__'
};

function laneNumber(slot: DownloadLaneId | MergeLaneId): number {
  return Number(slot.slice(slot.lastIndexOf('-') + 1));
}

export class WorkbenchService {
  public constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly projects: ProjectService,
    private readonly input: InputService,
    private readonly queue: QueueManager,
    private readonly tools: ToolManager,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
    private readonly sources: MediaSourceRepository
  ) {}

  private getProject(slot: WorkbenchSlot): Project | null {
    const current = this.projectRepo.getByCode(SLOT_CODES[slot]);
    if (current) return current;

    const legacyCode = LEGACY_CODES[slot];
    if (!legacyCode) return null;
    const legacy = this.projectRepo.getByCode(legacyCode);
    if (!legacy) return null;
    return this.projectRepo.update(legacy.id, { code: SLOT_CODES[slot] });
  }

  private projectsForSlot(slot: WorkbenchSlot): Project[] {
    const codes = [SLOT_CODES[slot], LEGACY_CODES[slot]].filter(
      (code): code is string => typeof code === 'string'
    );
    return this.projectRepo.listByCodes(codes);
  }

  private slotState(slot: WorkbenchSlot): WorkbenchSlotState {
    const project = this.getProject(slot);
    return {
      slot,
      project,
      items: project ? this.input.list(project.id) : [],
      jobs: project ? this.queue.list(project.id) : []
    };
  }

  public state(): WorkbenchState {
    return {
      downloadLanes: DOWNLOAD_LANES.map((slot) => this.slotState(slot)),
      mergeLanes: MERGE_LANES.map((slot) => this.slotState(slot))
    };
  }

  public async storage(slot: WorkbenchSlot): Promise<WorkbenchStorageSummary> {
    const project = this.getProject(slot);
    if (!project) {
      return {
        slot,
        projectId: null,
        downloadedBytes: 0,
        downloadedFileCount: 0,
        temporaryBytes: 0,
        temporaryFileCount: 0,
        finalBytes: 0,
        finalFileCount: 0,
        totalBytes: 0,
        scannedAt: new Date().toISOString()
      };
    }

    const sourceFiles = [...new Set(
      this.input.list(project.id)
        .map((item) => item.sourceId ? this.sources.get(item.sourceId)?.sourceFile : null)
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
    )];
    const safeName = sanitizeFilename(
      project.finalFileName.replace(/\.mp4$/i, ''),
      'Thành phẩm'
    );
    const mergeJobs = this.queue.list(project.id).filter((job) => job.type === 'merge');
    const lastMerge = mergeJobs.at(-1);
    const storedOutput = lastMerge?.input.outputPath;
    const finalPath = typeof storedOutput === 'string' && storedOutput.trim()
      ? storedOutput
      : join(project.outputFolder, `${safeName}.mp4`);
    const temporaryPaths = [
      project.tempFolder,
      join(project.outputFolder, `${safeName}.pending.mp4`),
      ...mergeJobs.map((job) => join(project.tempFolder, `concat-${job.id}.txt`))
    ];

    const [downloaded, temporary, final] = await Promise.all([
      sizeFiles(sourceFiles),
      sizePaths(temporaryPaths),
      sizeFiles([finalPath])
    ]);
    return {
      slot,
      projectId: project.id,
      downloadedBytes: downloaded.bytes,
      downloadedFileCount: downloaded.fileCount,
      temporaryBytes: temporary.bytes,
      temporaryFileCount: temporary.fileCount,
      finalBytes: final.bytes,
      finalFileCount: final.fileCount,
      totalBytes: downloaded.bytes + temporary.bytes + final.bytes,
      scannedAt: new Date().toISOString()
    };
  }

  private async assertDownloadReady(): Promise<void> {
    const current = this.tools.list();
    const needsCheck = REQUIRED_TOOL_NAMES.some((name) => {
      const status = current.find((item) => item.name === name);
      const checkedAt = status?.lastCheckedAt ? Date.parse(status.lastCheckedAt) : 0;
      return (
        !status?.available ||
        status.health === 'broken' ||
        !status.executablePath ||
        !checkedAt ||
        Date.now() - checkedAt > 10 * 60_000
      );
    });
    const statuses = needsCheck ? await this.tools.ensureRequiredReady() : current;
    const unavailable = REQUIRED_TOOL_NAMES
      .map((name) => statuses.find((status) => status.name === name))
      .filter((status) => !status?.available || status.health === 'broken' || !status.executablePath);
    if (unavailable.length > 0) {
      const detail = unavailable
        .map((status) => `${status?.name ?? 'công cụ'}: ${status?.error ?? 'không tìm thấy'}`)
        .join(' | ');
      throw new ToolHealthCheckError(
        'Kiểm tra trước khi tải',
        `Thiếu công cụ bắt buộc sau khi ứng dụng đã tự dò và thử kết nối: ${detail}. ` +
        'Kiểm tra kết nối mạng rồi vào Trung tâm công cụ → Sửa chữa tất cả nếu lần cài tự động bị gián đoạn.'
      );
    }
  }

  private async upsertDownloadLane(value: DownloadLaneInput): Promise<Project> {
    const existing = this.getProject(value.slot);
    const number = laneNumber(value.slot);
    const common = {
      name: value.name.trim() || `Danh sách tải ${number}`,
      code: SLOT_CODES[value.slot],
      description: `Danh sách tải độc lập số ${number}. Video được lưu trực tiếp vào thư mục đã chọn.`,
      sourceFolder: value.outputFolder,
      tempFolder: value.tempFolder || join(value.outputFolder, '_yt_tmp'),
      outputFolder: value.outputFolder,
      finalFileName: 'download-only',
      qualityProfileId: 'quality-highest',
      resourceProfileId: value.resourceProfileId
    };
    return existing ? this.projects.update(existing.id, common) : this.projects.create(common);
  }

  private async upsertMerge(value: DownloadMergeInput): Promise<Project> {
    const existing = this.getProject(value.slot);
    const number = laneNumber(value.slot);
    const common = {
      name: value.finalFileName.trim() || `Thành phẩm ${number}`,
      code: SLOT_CODES[value.slot],
      description: `Quy trình tải và ghép độc lập số ${number}; có hàng đợi, chất lượng, thư mục và lịch sử riêng.`,
      sourceFolder: value.sourceFolder,
      tempFolder: value.tempFolder,
      outputFolder: value.outputFolder,
      finalFileName: value.finalFileName,
      qualityProfileId: value.qualityProfileId,
      resourceProfileId: value.resourceProfileId,
      exportTimelineTxt: false
    };
    return existing ? this.projects.update(existing.id, common) : this.projects.create(common);
  }

  public saveDownloadDraft(value: DownloadLaneDraftInput): WorkbenchSlotState {
    const existing = this.getProject(value.slot);
    const number = laneNumber(value.slot);
    const availableProfiles = this.settings.profiles().resources;
    const base = availableProfiles.find((profile) => profile.id === value.resourceProfileId) ?? availableProfiles[0];
    if (!base) throw new Error('Không có cấu hình tài nguyên để lưu danh sách tải.');
    const workers = Math.max(1, Math.min(16, Math.round(value.downloadWorkers || 1)));
    const profile = this.settings.saveResource({
      ...base,
      id: `resource-${value.slot}-custom`,
      name: `Danh sách ${number} · ${workers} luồng tải`,
      description: `Cấu hình riêng của danh sách tải ${number}; được tự động lưu khi người dùng thay đổi.`,
      downloadWorkers: workers,
      builtIn: false
    });
    const draft = {
      name: value.name.trim() || `Danh sách tải ${number}`,
      code: SLOT_CODES[value.slot],
      description: `Danh sách tải độc lập số ${number}. Dữ liệu cấu hình được lưu tự động.`,
      sourceFolder: value.outputFolder,
      tempFolder: value.tempFolder,
      outputFolder: value.outputFolder,
      finalFileName: 'download-only',
      qualityProfileId: 'quality-highest',
      resourceProfileId: profile.id
    };
    const project = existing
      ? this.projectRepo.update(existing.id, draft)
      : this.projectRepo.create(draft);
    this.input.import(project.id, value.linksText, 'replace');
    return this.slotState(value.slot);
  }

  public saveMergeDraft(value: DownloadMergeInput): WorkbenchSlotState {
    const existing = this.getProject(value.slot);
    const number = laneNumber(value.slot);
    const draft = {
      name: value.finalFileName.trim() || `Thành phẩm ${number}`,
      code: SLOT_CODES[value.slot],
      description: `Quy trình tải và ghép độc lập số ${number}. Dữ liệu cấu hình được lưu tự động.`,
      sourceFolder: value.sourceFolder,
      tempFolder: value.tempFolder,
      outputFolder: value.outputFolder,
      finalFileName: value.finalFileName.trim() || `thanh-pham-${number}`,
      qualityProfileId: value.qualityProfileId,
      resourceProfileId: value.resourceProfileId,
      exportTimelineTxt: false
    };
    const project = existing
      ? this.projectRepo.update(existing.id, draft)
      : this.projectRepo.create(draft);
    this.input.import(project.id, value.linksText, 'replace');
    return this.slotState(value.slot);
  }

  public async startDownload(value: DownloadLaneInput): Promise<WorkbenchSlotState> {
    await this.assertDownloadReady();
    const existing = this.getProject(value.slot);
    if (existing) this.queue.prepareProject(existing.id);
    const project = await this.upsertDownloadLane(value);
    this.input.import(project.id, value.linksText, 'replace');
    this.queue.enqueueDownloads(project.id);
    return this.slotState(value.slot);
  }

  public async startMerge(value: DownloadMergeInput): Promise<WorkbenchSlotState> {
    await this.assertDownloadReady();
    const existing = this.getProject(value.slot);
    if (existing) this.queue.prepareProject(existing.id);
    const project = await this.upsertMerge(value);
    this.input.import(project.id, value.linksText, 'replace');
    this.queue.enqueueProject(project.id);
    return this.slotState(value.slot);
  }

  public async pause(slot: WorkbenchSlot): Promise<WorkbenchSlotState> {
    const project = this.getProject(slot);
    if (project) await this.queue.pauseProject(project.id);
    return this.slotState(slot);
  }

  public async resume(slot: WorkbenchSlot): Promise<WorkbenchSlotState> {
    await this.assertDownloadReady();
    const project = this.getProject(slot);
    if (project) await this.queue.resumeProject(project.id);
    return this.slotState(slot);
  }

  public cancel(slot: WorkbenchSlot): WorkbenchSlotState {
    const project = this.getProject(slot);
    if (project) this.queue.cancelProject(project.id);
    return this.slotState(slot);
  }

  public clearProgress(slot: WorkbenchSlot): WorkbenchSlotState {
    const project = this.getProject(slot);
    if (project) this.queue.clearProjectHistory(project.id);
    return this.slotState(slot);
  }

  public clearLogs(slot: WorkbenchSlot): WorkbenchSlotState {
    const project = this.getProject(slot);
    if (project) {
      this.logger.clearProject(project.id);
      this.logger.info('workbench', 'PROJECT_LOGS_CLEARED', 'Nhật ký cũ của khu vực đã được dọn sạch.', {
        projectId: project.id
      });
    }
    return this.slotState(slot);
  }


  public async removeAll(): Promise<{ projectsRemoved: number; jobsRemoved: number }> {
    // Xóa toàn bộ dự án, kể cả bản ghi cũ/ẩn/trùng mã từ các phiên bản trước.
    // Tệp video ngoài cơ sở dữ liệu luôn được giữ nguyên.
    const jobsRemoved = this.queue.list().length;
    const projects = this.projectRepo.list();

    await this.queue.cancelAllAndWait();
    await Promise.all(projects.flatMap((project) => [
      cleanupTemporaryArtifacts(project.tempFolder),
      cleanupTemporaryArtifacts(join(project.outputFolder, '_normalized')),
      cleanupTemporaryArtifacts(join(project.outputFolder, '_quarantine'))
    ]));
    const projectsRemoved = this.projectRepo.removeAll();
    this.queue.clearAllHistory();
    this.logger.clearAll();
    this.queue.refreshState();
    this.logger.info(
      'workbench',
      'ALL_WORKBENCH_DATA_REMOVED',
      `Đã xóa bền vững ${projectsRemoved} danh sách tải/quy trình ghép và ${jobsRemoved} dòng tiến trình khỏi dữ liệu ứng dụng.`
    );
    return { projectsRemoved, jobsRemoved };
  }

  public async remove(slot: WorkbenchSlot): Promise<WorkbenchSlotState> {
    // Một số bản cũ có thể để lại nhiều dự án cùng mã. Xóa tất cả bản ghi cùng khu vực
    // để dữ liệu cũ không xuất hiện lại ở lần mở ứng dụng tiếp theo.
    const projects = this.projectsForSlot(slot);
    if (projects.length === 0) return this.slotState(slot);
    for (const project of projects) {
      await this.queue.removeProject(project.id);
      await Promise.all([
        cleanupTemporaryArtifacts(project.tempFolder),
        cleanupTemporaryArtifacts(join(project.outputFolder, '_normalized')),
        cleanupTemporaryArtifacts(join(project.outputFolder, '_quarantine'))
      ]);
      this.logger.clearProject(project.id);
      await this.projects.remove(project.id, false);
    }
    return this.slotState(slot);
  }
}
