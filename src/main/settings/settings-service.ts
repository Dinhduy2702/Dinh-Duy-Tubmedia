import { app } from 'electron';
import type {
  AppSettings,
  HardwareProfile,
  QualityProfile,
  ResourceProfile
} from '@shared/types/domain.js';
import { InvalidInputError } from '@shared/errors/app-errors.js';
import type { SettingsRepository } from '../database/repositories/settings-repository.js';
import {
  builtInQualityProfiles,
  builtInResourceProfiles,
  defaultAppSettings
} from './defaults.js';
import type { HardwareService } from './hardware-service.js';

function validateDownloadRanges(settings: AppSettings): void {
  if (settings.downloadCompatibilityMode !== 'source') return;

  if (
    settings.downloadMaxHeight > 0 &&
    settings.downloadMinHeight > settings.downloadMaxHeight
  ) {
    throw new InvalidInputError(
      `Độ phân giải tối thiểu (${settings.downloadMinHeight}p) không được lớn hơn tối đa (${settings.downloadMaxHeight}p).`
    );
  }

  if (
    settings.downloadMaxFps > 0 &&
    settings.downloadMinFps > settings.downloadMaxFps
  ) {
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

  public constructor(
    private readonly repo: SettingsRepository,
    private readonly hardware: HardwareService
  ) {}

  public initialize(): void {
    for (const profile of builtInResourceProfiles) {
      this.repo.saveResourceProfile(profile);
    }
    for (const profile of builtInQualityProfiles) {
      this.repo.saveQualityProfile(profile);
    }
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
    app.setLoginItemSettings({ openAtLogin: this.get().startWithWindows });
  }

  public get(): AppSettings {
    return this.repo.getAppSettings(defaultAppSettings);
  }

  public update(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...patch };
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
