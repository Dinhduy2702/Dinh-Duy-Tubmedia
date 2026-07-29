import { app } from 'electron';
import { join, parse } from 'node:path';
import { AppDatabase } from '../database/database.js';
import { ProjectRepository } from '../database/repositories/project-repository.js';
import { SettingsRepository } from '../database/repositories/settings-repository.js';
import { ItemRepository } from '../database/repositories/item-repository.js';
import { QueueRepository } from '../database/repositories/queue-repository.js';
import { LogRepository } from '../database/repositories/log-repository.js';
import { MediaSourceRepository } from '../database/repositories/media-source-repository.js';
import { Logger } from '../logging/logger.js';
import { PathService } from '../storage/path-service.js';
import { HardwareService } from '../settings/hardware-service.js';
import { SettingsService } from '../settings/settings-service.js';
import { ProjectService } from '../projects/project-service.js';
import { InputService } from '../input/input-service.js';
import { ProcessManager } from '../processes/process-manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { MediaAnalyzer } from '../media/media-analyzer.js';
import { FileVerifier } from '../media/file-verifier.js';
import { QuarantineService } from '../media/quarantine-service.js';
import { DownloadEngine } from '../downloader/download-engine.js';
import { ClipEngine } from '../clips/clip-engine.js';
import { NormalizeEngine } from '../normalize/normalize-engine.js';
import { TimelineService } from '../merge/timeline-service.js';
import { MergeEngine } from '../merge/merge-engine.js';
import { QueueManager } from '../queue/queue-manager.js';
import { SystemStatsService } from '../system/system-stats-service.js';
import { BackupService } from '../backups/backup-service.js';
import { ToolUpdateService } from '../updates/tool-update-service.js';
import { AppUpdateService } from '../updates/app-update-service.js';
import { WorkbenchService } from '../workbench/workbench-service.js';
import { SenderValidator } from '../security/sender-validator.js';
import { CookieService } from '../cookies/cookie-service.js';
import { cleanupTemporaryArtifacts } from '../files/temporary-cleanup.js';

export class AppContext {
  public readonly userData = app.getPath('userData');
  public readonly database = new AppDatabase(join(this.userData, 'database', 'studio.sqlite'));
  public readonly projectRepo = new ProjectRepository(this.database.db);
  public readonly settingsRepo = new SettingsRepository(this.database.db);
  public readonly itemRepo = new ItemRepository(this.database.db);
  public readonly queueRepo = new QueueRepository(this.database.db);
  public readonly logRepo = new LogRepository(this.database.db);
  public readonly sourceRepo = new MediaSourceRepository(this.database.db);
  public readonly logger = new Logger(this.logRepo, join(this.userData, 'logs'));
  public readonly paths = new PathService();
  public readonly hardware = new HardwareService();
  public readonly settings = new SettingsService(this.settingsRepo, this.hardware);
  public readonly cookies = new CookieService(this.userData, this.settings);
  public readonly projects = new ProjectService(this.projectRepo, this.paths);
  public readonly input = new InputService(this.itemRepo);
  public readonly processes = new ProcessManager(this.logger);
  public readonly tools = new ToolManager(this.processes, this.logger, () => this.settings.get(), process.resourcesPath, this.userData, app.getAppPath(), app.isPackaged);
  public readonly analyzer = new MediaAnalyzer(this.processes, this.tools);
  public readonly verifier = new FileVerifier(this.analyzer, this.processes, this.tools);
  public readonly quarantine = new QuarantineService(this.logger);
  public readonly downloader = new DownloadEngine(this.processes, this.tools, this.sourceRepo, this.projectRepo, this.settings, this.analyzer, this.verifier, this.quarantine, this.logger);
  public readonly clips = new ClipEngine(this.tools, this.processes, this.verifier, this.quarantine);
  public readonly normalizer = new NormalizeEngine(this.tools, this.processes, this.analyzer, this.verifier, this.quarantine, this.logger);
  public readonly timeline = new TimelineService(this.analyzer);
  public readonly merger = new MergeEngine(this.tools, this.processes, this.analyzer, this.verifier, this.normalizer, this.timeline, this.quarantine);
  public readonly queue = new QueueManager(this.queueRepo, this.projectRepo, this.itemRepo, this.sourceRepo, this.settings, this.downloader, this.clips, this.merger, this.processes, this.logger, () => this.tools.requiredReady());
  public readonly backups = new BackupService(this.database, join(this.userData, 'backups'), this.logger);
  public readonly toolUpdates = new ToolUpdateService(this.tools, this.settings, join(this.userData, 'tools'), this.logger, this.processes);
  public readonly appUpdates: AppUpdateService;
  public readonly workbench = new WorkbenchService(this.projectRepo, this.projects, this.input, this.queue, this.tools, this.settings, this.logger, this.sourceRepo);
  public readonly sender = new SenderValidator();
  public readonly systemStats = new SystemStatsService(this.queue, this.processes, () => {
    const s = this.settings.get();
    return [s.defaultSourceFolder, s.defaultTempFolder, s.defaultOutputFolder].map(x => parse(x).root || x);
  });
  public constructor(prepareForAppUpdate: () => Promise<void> = () => Promise.resolve()) {
    this.tools.setRequiredRepairHandler(() => this.toolUpdates.repairRequired());
    this.appUpdates = new AppUpdateService(
      this.settings,
      this.queue,
      this.backups,
      this.logger,
      prepareForAppUpdate
    );
  }
  public initialize(): void {
    this.settings.initialize();
    const logRetentionDays = this.settings.get().logRetentionDays;
    this.logRepo.prune(logRetentionDays);
    this.logger.pruneFiles(logRetentionDays);
    const legacyFolders = this.projectRepo.list().flatMap((project) => [
      join(project.outputFolder, '_normalized'),
      join(project.outputFolder, '_quarantine')
    ]);
    void Promise.all(legacyFolders.map((folder) => cleanupTemporaryArtifacts(folder)))
      .then((reports) => {
        const removedFiles = reports.reduce((sum, report) => sum + report.removedFiles, 0);
        const removedDirectories = reports.reduce((sum, report) => sum + report.removedDirectories, 0);
        if (removedFiles + removedDirectories > 0) {
          this.logger.info(
            'cleanup',
            'LEGACY_OUTPUT_TEMP_CLEANED',
            `Đã tự dọn ${removedFiles} tệp và ${removedDirectories} thư mục tạm/quarantine còn sót trong thư mục thành phẩm từ phiên bản cũ.`
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn(
          'cleanup',
          'LEGACY_OUTPUT_TEMP_CLEANUP_WARNING',
          `Không thể dọn hết thư mục tạm cũ khi khởi động: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    const repairedSources = this.sourceRepo.clearCorruptedMetadata();
    const repairedJobs = this.queueRepo.repairCorruptedDisplayNames();
    if (repairedSources + repairedJobs > 0) {
      this.logger.info(
        'database',
        'CORRUPTED_TEXT_REPAIRED',
        `Đã dọn ${repairedSources} metadata nguồn và ${repairedJobs} tên tiến trình bị lỗi bảng mã từ phiên bản cũ.`
      );
    }
  }
}
