import { app, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import type { AppUpdateReleaseInfo, AppUpdateStatus } from '@shared/types/domain.js';
import { IPC } from '@shared/contracts/channels.js';
import { sanitizeProgress } from '@shared/utils/progress-policy.js';
import { compareAppVersions, isNewerAppVersion } from '@shared/app-version.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { QueueManager } from '../queue/queue-manager.js';
import type { BackupService } from '../backups/backup-service.js';
import type { Logger } from '../logging/logger.js';
import { feedUrlError } from '../security/settings-policy.js';

type AutoUpdater = AppUpdater;
type ElectronUpdaterModule = { autoUpdater?: AppUpdater };

const MANUAL_UPDATE_CHECK_TIMEOUT_MS = 8_000;
const SILENT_UPDATE_CHECK_TIMEOUT_MS = 5_000;
const BUNDLED_UPDATE_CONFIG = 'app-update.yml';
const UPDATE_METADATA_UNAVAILABLE_MESSAGE =
  'Máy chủ phát hành chưa cung cấp dữ liệu cập nhật cho kênh này. Ứng dụng vẫn hoạt động bình thường.';

function isRemoteUpdateMetadataMissing(message: string): boolean {
  return (
    /(?:latest|beta)\.yml/i.test(message) &&
    /(?:HttpError:\s*404|\b404\b|status(?:Code| code)?\s*[:=]?\s*404)/i.test(message)
  );
}

function isLocalUpdateSourceMissing(message: string): boolean {
  return /app-update\.yml|feed|provider|ENOENT/i.test(message);
}

function isExpectedDowngradeBlock(message: string): boolean {
  return /(?:downgrade|older version|version[^\n]*(?:older|lower)|new version[^\n]*not (?:greater|newer)|APP_UPDATE_DOWNGRADE_BLOCKED)/i.test(
    message
  );
}

// electron-updater hiện được phát hành dưới dạng CommonJS. Main process của
// Tubmedia là ESM, vì vậy không được dùng named runtime import. createRequire
// tạo cầu nối ổn định cho cả bản đóng gói và Electron mới. Updater chỉ được
// nạp trong bản đã cài đặt để dev mode khởi động nhanh và không thể bị sập bởi
// một lỗi tương thích module của chức năng phụ.
const requireFromEsm = createRequire(import.meta.url);

function loadAutoUpdater(): AutoUpdater {
  const loaded = requireFromEsm('electron-updater') as ElectronUpdaterModule;
  if (!loaded?.autoUpdater) {
    throw new Error('Không thể nạp dịch vụ cập nhật electron-updater.');
  }
  return loaded.autoUpdater;
}

function notesText(value: UpdateInfo['releaseNotes']): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((entry) => (typeof entry === 'string' ? entry : entry.note))
    .filter((entry): entry is string => Boolean(entry?.trim()))
    .join('\n\n')
    .trim();
  return text || null;
}

function releaseInfo(info: UpdateInfo): AppUpdateReleaseInfo {
  return {
    version: info.version,
    releaseDate: info.releaseDate || null,
    releaseName: typeof info.releaseName === 'string' ? info.releaseName : null,
    releaseNotes: notesText(info.releaseNotes)
  };
}

function updateProgress(progress: ProgressInfo): AppUpdateStatus['progress'] {
  const total = Number.isFinite(progress.total) ? Math.max(0, progress.total) : 0;
  const transferred = Number.isFinite(progress.transferred)
    ? Math.max(0, Math.min(total || progress.transferred, progress.transferred))
    : 0;
  return {
    percent: sanitizeProgress(progress.percent, total > 0 ? (transferred / total) * 100 : 0),
    bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? Math.max(0, progress.bytesPerSecond) : 0,
    transferred,
    total
  };
}

export class AppUpdateService {
  private window: BrowserWindow | null = null;
  private status: AppUpdateStatus;
  private configuredFeed = '';
  private silentCheck = false;
  private updater: AutoUpdater | null = null;
  private networkCheckInFlight: Promise<void> | null = null;
  private downloadInFlight: Promise<AppUpdateStatus> | null = null;
  private feedUnavailableForSession = false;
  private feedUnavailableLogged = false;
  private configuredChannel = '';
  private readonly hasActiveWork: () => boolean;

  public constructor(
    private readonly settings: SettingsService,
    private readonly queue: QueueManager,
    private readonly backups: BackupService,
    private readonly logger: Logger,
    private readonly prepareForInstall: () => Promise<void> = () => Promise.resolve(),
    hasActiveWork?: () => boolean
  ) {
    this.hasActiveWork = hasActiveWork ?? (() => this.queue.activeCount() > 0);
    const sourceReady = app.isPackaged && this.hasConfiguredUpdateSource();
    this.status = this.baseStatus(
      app.isPackaged && sourceReady ? 'idle' : 'disabled',
      !app.isPackaged
        ? 'Cập nhật trực tuyến chỉ hoạt động trong bản đã cài đặt.'
        : sourceReady
          ? 'Sẵn sàng kiểm tra bản cập nhật.'
          : 'Phiên bản này chưa được liên kết với máy chủ cập nhật.'
    );
  }

  private configureRuntime(updater: AutoUpdater): void {
    updater.autoDownload = false;
    /* TUBMEDIA_V133_DIFFERENTIAL_UPDATE */
    updater.disableDifferentialDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
  }

  private bindEvents(updater: AutoUpdater): void {
    updater.on('checking-for-update', () => {
      this.feedUnavailableForSession = false;
      this.feedUnavailableLogged = false;
      // TUBMEDIA_V133_PASSIVE_UPDATE_CENTER
      // "Checking" is transport state. Professional UI keeps the last stable
      // product state visible while automatic polling runs in the background.
      this.logger.debug(
        'update',
        'APP_UPDATE_BACKGROUND_CHECK_STARTED',
        'Tubmedia đang đồng bộ thông tin phiên bản trong nền.'
      );
    });
    updater.on('update-available', (info: UpdateInfo) => {
      const currentVersion = app.getVersion();
      const relation = compareAppVersions(info.version, currentVersion);
      const checkedAt = new Date().toISOString();

      if (relation !== 1) {
        const invalid = relation === null;
        const message =
          relation === -1
            ? `Bạn đang dùng Tubmedia ${currentVersion}, mới hơn phiên bản ${info.version} trên máy chủ. Không có thao tác cập nhật nào được thực hiện.`
            : relation === 0
              ? 'Bạn đang dùng phiên bản mới nhất.'
              : `Máy chủ trả về phiên bản không hợp lệ (${info.version}). Tubmedia đã chặn tải để bảo vệ bản cài đặt.`;

        this.emit({
          ...this.baseStatus(invalid ? 'error' : 'not-available', message),
          checkedAt,
          info: releaseInfo(info),
          error: invalid ? 'INVALID_REMOTE_APP_VERSION' : null
        });
        if (invalid) {
          this.logger.warn('update', 'APP_UPDATE_REMOTE_VERSION_INVALID', message);
        }
        return;
      }

      this.emit({
        ...this.baseStatus('available', `Đã có Tubmedia ${info.version}.`),
        checkedAt,
        info: releaseInfo(info)
      });
    });
    updater.on('update-not-available', (info: UpdateInfo) => {
      const currentVersion = app.getVersion();
      const relation = compareAppVersions(info.version, currentVersion);
      const message =
        relation === -1
          ? `Bạn đang dùng Tubmedia ${currentVersion}, mới hơn phiên bản ${info.version} trên máy chủ.`
          : relation === null
            ? `Không thể xác minh phiên bản máy chủ (${info.version}). Tubmedia không cho phép tải hoặc cài đặt.`
            : 'Bạn đang dùng phiên bản mới nhất.';

      this.emit({
        ...this.baseStatus(relation === null ? 'error' : 'not-available', message),
        checkedAt: new Date().toISOString(),
        info: releaseInfo(info),
        error: relation === null ? 'INVALID_REMOTE_APP_VERSION' : null
      });
    });
    updater.on('download-progress', (progress: ProgressInfo) => {
      this.emit({
        ...this.status,
        state: 'downloading',
        message: 'Đang tải bản cập nhật...',
        progress: updateProgress(progress),
        error: null
      });
    });
    updater.on('update-downloaded', (info: UpdateInfo) => {
      const currentVersion = app.getVersion();

      if (!isNewerAppVersion(info.version, currentVersion)) {
        const message = `Đã bỏ qua gói Tubmedia ${info.version} vì phiên bản đang chạy là ${currentVersion}.`;

        this.emit({
          ...this.baseStatus('not-available', message),
          checkedAt: this.status.checkedAt,
          info: releaseInfo(info)
        });
        this.logger.info('update', 'APP_UPDATE_STALE_PACKAGE_IGNORED', message);
        return;
      }

      this.emit({
        ...this.baseStatus('downloaded', 'Bản cập nhật đã tải xong và sẵn sàng cài đặt.'),
        checkedAt: this.status.checkedAt,
        info: releaseInfo(info),
        progress: this.status.progress
      });
    });
    updater.on('error', (error: Error) => {
      const message = error.message;

      if (isExpectedDowngradeBlock(message)) {
        const next = {
          ...this.baseStatus(
            'not-available',
            'Bạn đang dùng phiên bản mới nhất hoặc mới hơn phiên bản trên máy chủ.'
          ),
          checkedAt: new Date().toISOString(),
          info: this.status.info,
          error: null
        } satisfies AppUpdateStatus;

        if (this.silentCheck) {
          this.status = next;
        } else {
          this.emit(next);
        }
        return;
      }

      if (isRemoteUpdateMetadataMissing(message)) {
        this.handleMetadataUnavailable(this.silentCheck);
        return;
      }

      const missingSource = isLocalUpdateSourceMissing(message);

      this.logger.warn(
        'update',
        missingSource ? 'APP_UPDATE_FEED_NOT_CONFIGURED' : 'APP_UPDATE_ERROR',
        missingSource ? 'Không tìm thấy cấu hình máy chủ cập nhật trong bản cài đặt.' : message
      );

      if (this.silentCheck) {
        // Automatic polling errors belong to logs/diagnostics. Never replace
        // a stable Update Center screen with a network/transport error.
        return;
      }

      this.emit({
        ...this.baseStatus(
          missingSource ? 'disabled' : 'error',
          missingSource
            ? 'Phiên bản này chưa được liên kết với máy chủ cập nhật.'
            : 'Không thể hoàn tất thao tác cập nhật.'
        ),
        checkedAt: new Date().toISOString(),
        error: missingSource ? null : message
      });
    });
  }

  public setWindow(window: BrowserWindow): void {
    this.window = window;
    this.emit(this.status);
  }

  public getStatus(): AppUpdateStatus {
    return this.status;
  }

  public async check(silent = false): Promise<AppUpdateStatus> {
    if (!app.isPackaged) {
      const status = this.baseStatus('disabled', 'Cập nhật trực tuyến chỉ hoạt động trong bản đã cài đặt.');
      if (!silent) this.emit(status);
      return silent ? this.status : status;
    }

    if (this.feedUnavailableForSession) {
      if (silent) return this.status;
      // A previous 404 can be temporary while a release is still publishing.
      // An explicit user check must always be allowed to retry in the same app session.
      this.feedUnavailableForSession = false;
      this.feedUnavailableLogged = false;
    }

    if (!this.hasConfiguredUpdateSource()) {
      const status = {
        ...this.baseStatus('disabled', 'Phiên bản này chưa được liên kết với máy chủ cập nhật.'),
        checkedAt: new Date().toISOString()
      };

      this.logger.info(
        'update',
        'APP_UPDATE_FEED_NOT_CONFIGURED_FAST',
        'Bỏ qua kiểm tra mạng vì không có app-update.yml hoặc URL máy chủ cập nhật.'
      );

      if (!silent) this.emit(status);
      return silent ? this.status : status;
    }

    if (this.networkCheckInFlight) {
      // Coalesce duplicate checks. Never turn an in-flight background request
      // into a visible "checking" state.
      if (!silent) {
        await this.waitForNetworkCheck(this.networkCheckInFlight, MANUAL_UPDATE_CHECK_TIMEOUT_MS);
      }
      return this.status;
    }

    this.silentCheck = silent;
    let updater: AutoUpdater;

    try {
      updater = this.getUpdater();
      this.configure(updater);
    } catch (error) {
      this.silentCheck = false;
      return this.handleCheckFailure(error, silent);
    }
    this.logger.debug(
      'update',
      silent ? 'APP_UPDATE_BACKGROUND_CHECK' : 'APP_UPDATE_CHECK',
      silent ? 'Đang đồng bộ phiên bản trong nền.' : 'Đang kiểm tra thông tin phiên bản.'
    );

    let updateRequest: ReturnType<AutoUpdater['checkForUpdates']>;

    try {
      updateRequest = updater.checkForUpdates();
    } catch (error) {
      this.silentCheck = false;
      return this.handleCheckFailure(error, silent);
    }

    const transport = updateRequest
      .then(() => undefined)
      .catch((error: unknown) => {
        this.handleCheckFailure(error, silent);
      })
      .finally(() => {
        this.networkCheckInFlight = null;
        this.silentCheck = false;
      });

    this.networkCheckInFlight = transport;

    const timeoutMs = silent ? SILENT_UPDATE_CHECK_TIMEOUT_MS : MANUAL_UPDATE_CHECK_TIMEOUT_MS;

    const completed = await this.waitForNetworkCheck(transport, timeoutMs);

    if (!completed) {
      const seconds = Math.round(timeoutMs / 1_000);

      this.logger.warn(
        'update',
        'APP_UPDATE_CHECK_TIMEOUT',
        'Máy chủ cập nhật chưa phản hồi sau ' + seconds + ' giây. Yêu cầu mạng tiếp tục chạy nền.'
      );

      // Do not emit error/checking state. A delayed update-available or
      // update-not-available event will update the UI when transport returns.
      return this.status;
    }

    return this.status;
  }
  public async download(): Promise<AppUpdateStatus> {
    // Bấm "Cập nhật ngay" lần nữa khi đang tải không được chạy lại check() (có thể đặt trạng thái
    // về 'available' giữa chừng) hay gọi downloadUpdate() lần hai; dùng chung một lượt tải.
    if (this.downloadInFlight) return this.downloadInFlight;
    const run = this.downloadOnce().finally(() => {
      this.downloadInFlight = null;
    });
    this.downloadInFlight = run;
    return run;
  }

  private async downloadOnce(): Promise<AppUpdateStatus> {
    const currentVersion = app.getVersion();

    if (this.status.state === 'downloaded' && isNewerAppVersion(this.status.info?.version, currentVersion)) {
      return this.status;
    }

    if (this.status.state !== 'available' || !isNewerAppVersion(this.status.info?.version, currentVersion)) {
      await this.check(false);
    }

    if (this.status.state !== 'available' || !isNewerAppVersion(this.status.info?.version, currentVersion)) {
      throw new Error(
        this.status.message ?? 'Không có phiên bản mới hơn để tải. Tubmedia không cho phép hạ cấp.'
      );
    }

    this.emit({
      ...this.status,
      state: 'downloading',
      message: 'Đang tải bản cập nhật trong Tubmedia...',
      progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 },
      error: null
    });
    const release = this.status.info;
    const checkedAt = this.status.checkedAt;

    try {
      await this.getUpdater().downloadUpdate();
      this.logger.info(
        'update',
        'APP_UPDATE_DOWNLOAD_READY',
        'Cập nhật đã tải và xác minh xong; đang chờ người dùng xác nhận cài đặt an toàn.'
      );
      return this.status;
    } catch (error) {
      const technicalMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('update', 'APP_UPDATE_DOWNLOAD_FAILED', technicalMessage);
      const status: AppUpdateStatus = {
        ...this.baseStatus(
          'error',
          'Không thể tải trọn vẹn bản cập nhật. Bạn có thể thử lại ngay trong app.'
        ),
        checkedAt,
        info: release,
        error: technicalMessage
      };
      this.emit(status);
      throw new Error(status.message ?? 'Không thể tải bản cập nhật.');
    }
  }

  public async install(): Promise<void> {
    if (
      this.status.state !== 'downloaded' ||
      !isNewerAppVersion(this.status.info?.version, app.getVersion())
    ) {
      throw new Error(
        'Chỉ có thể cài phiên bản mới hơn phiên bản đang chạy. Tubmedia đã chặn thao tác hạ cấp.'
      );
    }

    if (this.hasActiveWork()) {
      throw new Error(
        'Hãy tạm dừng hoặc hoàn tất mọi tác vụ tải, cắt, ghép và Tải nhanh trước khi cập nhật.'
      );
    }

    this.emit({
      ...this.status,
      state: 'installing',
      message: 'Đang sao lưu và chuẩn bị khởi động lại...'
    });
    try {
      await this.backups.create(undefined, false, 'update');
      await this.prepareForInstall();
      const updater = this.getUpdater();
      // electron-updater 6.x positional API: isSilent=true, isForceRunAfter=true.
      // The NSIS installer also recognizes --updated and forces silent mode as a second safety layer.
      updater.quitAndInstall(true, true);
    } catch (error) {
      const technicalMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('update', 'APP_UPDATE_INSTALL_PREPARATION_FAILED', technicalMessage);
      this.emit({
        ...this.status,
        state: 'downloaded',
        message: 'Bản cập nhật vẫn được giữ. Tubmedia chưa thể chuẩn bị cài đặt an toàn.',
        error: technicalMessage
      });
      throw new Error('Chưa thể chuẩn bị cập nhật an toàn. Hãy đóng tác vụ đang chạy rồi thử lại.');
    }
  }
  private baseStatus(state: AppUpdateStatus['state'], message: string): AppUpdateStatus {
    return {
      state,
      currentVersion: app.getVersion(),
      channel: this.settings.get().appUpdateChannel,
      supported: app.isPackaged,
      checkedAt: null,
      message,
      info: null,
      progress: null,
      error: null
    };
  }

  private getUpdater(): AutoUpdater {
    if (this.updater) return this.updater;
    if (!app.isPackaged) {
      throw new Error('Cập nhật trực tuyến chỉ hoạt động trong bản đã cài đặt.');
    }
    try {
      const updater = loadAutoUpdater();
      this.configureRuntime(updater);
      this.bindEvents(updater);
      this.updater = updater;
      return updater;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.baseStatus('disabled', 'Không thể khởi tạo dịch vụ cập nhật ứng dụng.'),
        error: message
      };
      this.logger.warn('update', 'APP_UPDATE_RUNTIME_LOAD_FAILED', message);
      throw error;
    }
  }

  private hasConfiguredUpdateSource(): boolean {
    if (this.settings.get().appFeedUrl.trim()) return true;
    return existsSync(join(process.resourcesPath, BUNDLED_UPDATE_CONFIG));
  }

  private handleCheckFailure(error: unknown, silent: boolean): AppUpdateStatus {
    const message = error instanceof Error ? error.message : String(error);

    if (isExpectedDowngradeBlock(message)) {
      const status: AppUpdateStatus = {
        ...this.baseStatus(
          'not-available',
          'Bạn đang dùng phiên bản mới nhất hoặc mới hơn phiên bản trên máy chủ.'
        ),
        checkedAt: new Date().toISOString(),
        info: this.status.info,
        error: null
      };

      if (silent) {
        this.status = status;
      } else {
        this.emit(status);
      }

      return status;
    }

    if (isRemoteUpdateMetadataMissing(message)) {
      if (this.feedUnavailableForSession) return this.status;
      return this.handleMetadataUnavailable(silent);
    }

    const missingSource = isLocalUpdateSourceMissing(message);

    this.logger.warn(
      'update',
      missingSource ? 'APP_UPDATE_FEED_NOT_CONFIGURED' : 'APP_UPDATE_CHECK_FAILED',
      missingSource ? 'Không tìm thấy cấu hình máy chủ cập nhật trong bản cài đặt.' : message
    );

    if (silent) {
      // Fail passive: keep the last stable update state.
      return this.status;
    }

    const status: AppUpdateStatus = {
      ...this.baseStatus(
        missingSource ? 'disabled' : 'error',
        missingSource
          ? 'Phiên bản này chưa được liên kết với máy chủ cập nhật.'
          : 'Không thể kiểm tra bản cập nhật.'
      ),
      checkedAt: new Date().toISOString(),
      error: missingSource ? null : message
    };

    this.emit(status);
    return status;
  }
  private metadataUnavailableStatus(): AppUpdateStatus {
    return {
      ...this.baseStatus('disabled', UPDATE_METADATA_UNAVAILABLE_MESSAGE),
      checkedAt: new Date().toISOString(),
      error: null
    };
  }

  private handleMetadataUnavailable(silent: boolean): AppUpdateStatus {
    this.feedUnavailableForSession = true;
    const status = this.metadataUnavailableStatus();

    if (!this.feedUnavailableLogged) {
      this.feedUnavailableLogged = true;
      this.logger.info(
        'update',
        'APP_UPDATE_METADATA_NOT_PUBLISHED',
        'Máy chủ phát hành chưa có latest.yml/beta.yml; Tubmedia tạm dừng kiểm tra cập nhật trong phiên này.'
      );
    }

    if (silent) {
      // Missing background metadata must not overwrite a last known-good state.
      return this.status;
    }

    this.emit(status);
    return status;
  }
  private async waitForNetworkCheck(check: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        check.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
          timer.unref?.();
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private configure(updater: AutoUpdater): void {
    const settings = this.settings.get();
    const channel = settings.appUpdateChannel === 'beta' ? 'beta' : 'latest';
    updater.allowPrerelease = settings.appUpdateChannel === 'beta';
    updater.channel = channel;
    // electron-updater sets allowDowngrade=true whenever channel is assigned.
    // AppUpdateService owns the final policy and always re-locks downgrade safety.
    updater.allowDowngrade = false;
    /* TUBMEDIA_V132_PROFESSIONAL_UPDATE_POLICY */
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;

    if (this.configuredChannel !== channel) {
      this.feedUnavailableForSession = false;
      this.feedUnavailableLogged = false;
      this.configuredChannel = channel;
    }

    const feed = settings.appFeedUrl.trim();
    if (!feed) {
      if (this.configuredFeed) {
        this.configuredFeed = '';
        this.feedUnavailableForSession = false;
        this.feedUnavailableLogged = false;
      }
      return;
    }
    const parsed = new URL(feed);
    if (parsed.protocol !== 'https:') {
      throw new Error('Địa chỉ nhận bản cập nhật ứng dụng bắt buộc dùng HTTPS.');
    }
    // Lớp phòng thủ thứ hai: dù giá trị đến từ đâu, chỉ cài bản cập nhật từ máy chủ mặc định.
    const feedPolicyError = feedUrlError(feed);
    if (feedPolicyError) throw new Error(feedPolicyError);
    const normalizedFeed = parsed.toString();
    if (normalizedFeed === this.configuredFeed) return;
    updater.setFeedURL({ provider: 'generic', url: normalizedFeed });
    this.configuredFeed = normalizedFeed;
    this.feedUnavailableForSession = false;
    this.feedUnavailableLogged = false;
  }

  private emit(status: AppUpdateStatus): void {
    this.status = status;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC.events.updateStatus, status);
    }
  }
}
