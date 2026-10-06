import { app } from 'electron';
import type { AppSettings, HardwareProfile, QualityProfile, ResourceProfile } from '@shared/types/domain.js';
import { InvalidInputError } from '@shared/errors/app-errors.js';
import type { SettingsRepository } from '../database/repositories/settings-repository.js';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from './defaults.js';
import { AUTO_RESOURCE_PROFILE_NAME, type HardwareService } from './hardware-service.js';
import type { Logger } from '../logging/logger.js';
import { assertGuardedSettingsChange, sanitizeGuardedSettings } from '../security/settings-policy.js';

function validateDownloadRanges(settings: AppSettings): void {
  if (settings.downloadCompatibilityMode !== 'source') return;

  if (settings.downloadMaxHeight > 0 && settings.downloadMinHeight > settings.downloadMaxHeight) {
    throw new InvalidInputError(
      `Độ phân giải tối thiểu (${settings.downloadMinHeight}p) không được lớn hơn tối đa (${settings.downloadMaxHeight}p).`
    );
  }

  if (settings.downloadMaxFps > 0 && settings.downloadMinFps > settings.downloadMaxFps) {
    throw new InvalidInputError(
      `FPS tối thiểu (${settings.downloadMinFps}) không được lớn hơn tối đa (${settings.downloadMaxFps}).`
    );
  }

  if (
    settings.downloadVideoBitrateKbps > 0 &&
    settings.downloadMinVideoBitrateKbps > settings.downloadVideoBitrateKbps
  ) {
    throw new InvalidInputError(
      `Video bitrate tối thiểu (${settings.downloadMinVideoBitrateKbps} kbps) không được lớn hơn tối đa (${settings.downloadVideoBitrateKbps} kbps).`
    );
  }

  if (
    settings.downloadAudioBitrateKbps > 0 &&
    settings.downloadMinAudioBitrateKbps > settings.downloadAudioBitrateKbps
  ) {
    throw new InvalidInputError(
      `Audio bitrate tối thiểu (${settings.downloadMinAudioBitrateKbps} kbps) không được lớn hơn tối đa (${settings.downloadAudioBitrateKbps} kbps).`
    );
  }
}

export class SettingsService {
  private hardwareCache: HardwareProfile | null = null;
  private readonly reportedDropped = new Set<string>();

  public constructor(
    private readonly repo: SettingsRepository,
    private readonly hardware: HardwareService,
    private readonly logger?: Logger
  ) {}

  public initialize(): void {
    for (const profile of builtInResourceProfiles) {
      this.repo.saveResourceProfile(profile);
    }
    for (const profile of builtInQualityProfiles) {
      this.repo.saveQualityProfile(profile);
    }
    this.renameOldAutoResourceProfiles();
    if (!this.repo.get<unknown>('initialized', null)) {
      this.repo.saveAppSettings(defaultAppSettings);
      this.repo.set('initialized', true);
    }
    if (!this.repo.get<boolean>('download_speed_profile_v086', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      this.repo.saveAppSettings({
        ...current,
        useAria2c: true,
        aria2Connections: Math.max(16, current.aria2Connections),
        downloadConcurrentFragments: Math.max(2, current.downloadConcurrentFragments),
        downloadVerifyEntireFile: false,
        progressRefreshMs: Math.min(300, current.progressRefreshMs)
      });
      this.repo.set('download_speed_profile_v086', true);
    }
    if (!this.repo.get<boolean>('merge_source_quality_v090', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      if (current.defaultQualityProfileId === 'quality-smart-merge') {
        this.repo.saveAppSettings({
          ...current,
          defaultQualityProfileId: 'quality-source-size'
        });
      }
      this.repo.set('merge_source_quality_v090', true);
    }
    if (!this.repo.get<boolean>('highest_source_download_v091', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      const stillUsesOldBoundedDefaults =
        current.downloadCompatibilityMode === 'source' &&
        current.downloadMinHeight === 720 &&
        current.downloadMaxHeight === 2160 &&
        current.downloadMinFps === 0 &&
        current.downloadMaxFps === 60 &&
        current.downloadCodecPreference === 'auto' &&
        current.downloadMinVideoBitrateKbps === 0 &&
        current.downloadVideoBitrateKbps === 0 &&
        current.downloadMinAudioBitrateKbps === 0 &&
        current.downloadAudioBitrateKbps === 0;
      if (stillUsesOldBoundedDefaults) {
        this.repo.saveAppSettings({
          ...current,
          downloadMinHeight: 0,
          downloadMaxHeight: 0,
          downloadMinFps: 0,
          downloadMaxFps: 0,
          downloadAllowBelowMinimum: false
        });
      }
      this.repo.set('highest_source_download_v091', true);
    }
    if (!this.repo.get<boolean>('fix_bounded_source_default_v1210', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      const brokenFreshDefault =
        current.downloadCompatibilityMode === 'source' &&
        current.downloadMinHeight === 720 &&
        current.downloadMaxHeight === 1080 &&
        current.downloadMinFps === 0 &&
        current.downloadMaxFps === 0 &&
        current.downloadCodecPreference === 'h264' &&
        current.downloadContainerPreference === 'mp4' &&
        current.downloadMinVideoBitrateKbps === 0 &&
        current.downloadVideoBitrateKbps === 0 &&
        current.downloadMinAudioBitrateKbps === 0 &&
        current.downloadAudioBitrateKbps === 0 &&
        current.downloadAllowBelowMinimum;
      if (brokenFreshDefault) {
        this.repo.saveAppSettings({
          ...current,
          downloadMinHeight: 0,
          downloadMaxHeight: 0,
          downloadCodecPreference: 'auto',
          downloadContainerPreference: 'auto',
          downloadAllowBelowMinimum: false
        });
      }
      this.repo.set('fix_bounded_source_default_v1210', true);
    }
    if (!this.repo.get<boolean>('reference_source_preserve_v093', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      if (current.defaultQualityProfileId === 'quality-reference-1080p') {
        this.repo.saveAppSettings({
          ...current,
          defaultQualityProfileId: 'quality-source-size'
        });
      }
      this.repo.set('reference_source_preserve_v093', true);
    }
    if (!this.repo.get<boolean>('app_update_auto_v1000', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      this.repo.saveAppSettings({
        ...current,
        autoCheckAppUpdates: true
      });
      this.repo.set('app_update_auto_v1000', true);
    }
    if (!this.repo.get<boolean>('app_update_manual_v1200_fix6', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      this.repo.saveAppSettings({
        ...current,
        autoCheckAppUpdates: false
      });
      this.repo.set('app_update_manual_v1200_fix6', true);
    }
    if (!this.repo.get<boolean>('app_update_in_app_silent_v1350', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      // v1.2.0 từng ép tắt tự kiểm tra để né bộ cài cũ. Updater mới chỉ tải khi
      // người dùng chọn, hiển thị tiến độ trong app và chỉ cài im lặng sau xác nhận.
      this.repo.saveAppSettings({
        ...current,
        autoCheckAppUpdates: true
      });
      this.repo.set('app_update_in_app_silent_v1350', true);
    }
    if (!this.repo.get<boolean>('smart_merge_performance_v1200', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      const next = {
        ...current,
        mergeLaneCount: Math.max(2, current.mergeLaneCount) as AppSettings['mergeLaneCount'],
        maxGlobalMergeJobs: Math.max(2, current.maxGlobalMergeJobs) as AppSettings['maxGlobalMergeJobs'],
        defaultQualityProfileId:
          current.defaultQualityProfileId === 'quality-smart-merge' ||
          current.defaultQualityProfileId === 'quality-source-size'
            ? 'quality-source-size'
            : current.defaultQualityProfileId
      };
      this.repo.saveAppSettings(next);
      this.repo.set('smart_merge_performance_v1200', true);
    }
    // ADAPTIVE_SETTINGS_HOTFIX8_MIGRATION: preserve master quality and wait for explicit user acceptance.
    if (!this.repo.get<boolean>('adaptive_master_edit_recommendation_v131_hotfix8', false)) {
      const current = this.repo.getAppSettings(defaultAppSettings);
      this.repo.saveAppSettings({
        ...current,
        downloadCompatibilityMode: 'source',
        downloadEditCopyMode: 'off'
      });
      this.repo.set('adaptive_master_edit_recommendation_v131_hotfix8', true);
    }
    app.setLoginItemSettings({ openAtLogin: this.get().startWithWindows });
  }

  public get(): AppSettings {
    // Giá trị lấy từ database (hoặc từ backup đã khôi phục) không được tin cậy tuyệt đối:
    // địa chỉ cập nhật và đường dẫn công cụ sai chính sách bị bỏ qua, ứng dụng quay về tự động.
    const { settings, dropped } = sanitizeGuardedSettings(this.repo.getAppSettings(defaultAppSettings));
    for (const item of dropped) {
      const marker = `${item.key}:${item.reason}`;
      if (this.reportedDropped.has(marker)) continue;
      this.reportedDropped.add(marker);
      this.logger?.warn(
        'settings',
        'SETTING_REJECTED_BY_POLICY',
        `Bỏ qua cài đặt ${item.key} đã lưu vì không đạt yêu cầu an toàn: ${item.reason}`
      );
    }
    return settings;
  }

  public update(patch: Partial<AppSettings>): AppSettings {
    const current = this.get();
    assertGuardedSettingsChange(current, patch);
    const next = { ...current, ...patch };
    validateDownloadRanges(next);
    this.repo.saveAppSettings(next);
    if ('startWithWindows' in patch) {
      app.setLoginItemSettings({ openAtLogin: next.startWithWindows });
    }
    return next;
  }

  public profiles(): {
    resources: ResourceProfile[];
    qualities: QualityProfile[];
  } {
    return {
      resources: this.repo.listResourceProfiles(),
      qualities: this.repo.listQualityProfiles()
    };
  }

  /**
   * Hồ sơ đề xuất tự động lưu trước khi dùng mã cố định (`resource-auto-<thời điểm>`) cùng mang tên
   * "Tự động theo máy". Đổi tên kèm ngày lưu cho phân biệt được; không xóa, không đổi mã, vì dự án cũ có
   * thể đang trỏ tới (khám phá bản cài #6). Chạy mỗi lần mở app: bản cũ hơn quay lui vẫn có thể sinh thêm.
   */
  private renameOldAutoResourceProfiles(): void {
    for (const profile of this.repo.listResourceProfiles()) {
      const match = /^resource-auto-(\d+)$/.exec(profile.id);
      if (!match || profile.name !== AUTO_RESOURCE_PROFILE_NAME) continue;
      const savedAt = new Date(Number(match[1]));
      if (Number.isNaN(savedAt.getTime())) continue;
      const pad = (value: number): string => String(value).padStart(2, '0');
      const label = `${pad(savedAt.getDate())}/${pad(savedAt.getMonth() + 1)}/${savedAt.getFullYear()} ${pad(savedAt.getHours())}:${pad(savedAt.getMinutes())}`;
      this.repo.saveResourceProfile({ ...profile, name: `${AUTO_RESOURCE_PROFILE_NAME} (cũ, ${label})` });
    }
  }

  public saveResource(profile: ResourceProfile): ResourceProfile {
    this.repo.saveResourceProfile(profile);
    return profile;
  }

  public saveQuality(profile: QualityProfile): QualityProfile {
    this.repo.saveQualityProfile(profile);
    return profile;
  }

  public async detectHardware(force = false): Promise<HardwareProfile> {
    if (!this.hardwareCache || force) {
      this.hardwareCache = await this.hardware.detect();
    }
    return this.hardwareCache;
  }

  public quickHardware(): HardwareProfile {
    return this.hardwareCache ?? this.hardware.quickSnapshot();
  }

  public async recommend(): Promise<ResourceProfile> {
    return this.hardware.recommend(await this.detectHardware());
  }
}
