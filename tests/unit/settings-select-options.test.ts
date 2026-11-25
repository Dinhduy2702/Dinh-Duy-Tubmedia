import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { builtInQualityProfiles, builtInResourceProfiles, defaultAppSettings } from '../../src/main/settings/defaults.js';
import { appSettingsSchema, qualityProfileSchema, resourceProfileSchema } from '../../src/shared/schemas/ipc.js';
import type { AppSettings, QualityProfile, ResourceProfile } from '../../src/shared/types/domain.js';
import * as optionsModule from '../../src/shared/utils/settings-select-options.js';

type Patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

interface SettingsPageExports {
  General: ComponentType<{ settings: AppSettings; patch: Patch; qualities: QualityProfile[]; resources: ResourceProfile[] }>;
  Performance: ComponentType<{ settings: AppSettings; patch: Patch; resources: ResourceProfile[]; setError: (error: string | null) => void }>;
  DownloadSettings: ComponentType<{ settings: AppSettings; patch: Patch; setError: (error: string | null) => void }>;
  ProcessingSettings: ComponentType<{ settings: AppSettings; patch: Patch; qualities: QualityProfile[]; setError: (error: string | null) => void }>;
  Storage: ComponentType<{ settings: AppSettings; patch: Patch }>;
  Verification: ComponentType<{ settings: AppSettings; patch: Patch }>;
  UpdateSettings: ComponentType<{ settings: AppSettings; patch: Patch }>;
}

async function loadSettingsPageModule(): Promise<SettingsPageExports> {
  const dynamicSpecifier = ['..', '..', 'src', 'renderer', 'src', 'pages', 'SettingsPage.tsx'].join('/');
  return (await import(dynamicSpecifier)) as SettingsPageExports;
}

const noopPatch: Patch = () => undefined;
const noopError = (): void => undefined;

describe('Cài đặt: chuyển toàn bộ ô nhập số sang ô chọn (<select>) và tương thích ngược', () => {
  let sections: SettingsPageExports;

  beforeAll(async () => {
    sections = await loadSettingsPageModule();
  }, 30_000);
  it('SettingsPage.tsx không còn input[type="number"], NumberField hay NullableNumber', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8');
    expect(source).not.toMatch(/type\s*=\s*['"]number['"]/);
    expect(source).not.toContain('NumberField');
    expect(source).not.toContain('NullableNumber');
  });

  it('mọi option chuẩn của các <select> trong Cài đặt đều hợp lệ qua schema IPC', () => {
    const baseResource = builtInResourceProfiles[0]!;
    const baseQuality = builtInQualityProfiles[0]!;

    const appChecks: Array<[keyof AppSettings, ReadonlyArray<optionsModule.SelectOption>, (v: string) => unknown]> = [
      ['downloadMinHeight', optionsModule.HEIGHT_SELECT_OPTIONS, Number],
      ['downloadMaxHeight', optionsModule.HEIGHT_SELECT_OPTIONS, Number],
      ['downloadMinFps', optionsModule.FPS_SELECT_OPTIONS, Number],
      ['downloadMaxFps', optionsModule.FPS_SELECT_OPTIONS, Number],
      ['downloadMinVideoBitrateKbps', optionsModule.VIDEO_BITRATE_KBPS_SELECT_OPTIONS, Number],
      ['downloadVideoBitrateKbps', optionsModule.VIDEO_BITRATE_KBPS_SELECT_OPTIONS, Number],
      ['downloadMinAudioBitrateKbps', optionsModule.AUDIO_BITRATE_KBPS_SELECT_OPTIONS, Number],
      ['downloadAudioBitrateKbps', optionsModule.AUDIO_BITRATE_KBPS_SELECT_OPTIONS, Number],
      ['rateLimit', optionsModule.RATE_LIMIT_SELECT_OPTIONS, String],
      ['sourceCacheDays', optionsModule.RETENTION_DAYS_SELECT_OPTIONS, Number],
      ['logRetentionDays', optionsModule.RETENTION_DAYS_SELECT_OPTIONS, Number],
      ['progressRefreshMs', optionsModule.PROGRESS_REFRESH_MS_SELECT_OPTIONS, Number]
    ];

    for (const [key, opts, parse] of appChecks) {
      expect(opts.length, `${key} phải có option`).toBeGreaterThan(1);
      for (const [raw, label] of opts) {
        expect(label.length).toBeGreaterThan(0);
        expect(label.length).toBeLessThanOrEqual(110);
        const parsed = appSettingsSchema.safeParse({ ...defaultAppSettings, [key]: parse(raw) });
        expect(parsed.success, `appSettingsSchema.${key}=${raw}`).toBe(true);
      }
    }

    const resourceChecks: Array<[keyof ResourceProfile, ReadonlyArray<optionsModule.SelectOption>, (v: string) => unknown]> = [
      ['downloadWorkers', optionsModule.DOWNLOAD_ANALYZE_WORKERS_OPTIONS, Number],
      ['analyzeWorkers', optionsModule.DOWNLOAD_ANALYZE_WORKERS_OPTIONS, Number],
      ['normalizeWorkers', optionsModule.NORMALIZE_WORKERS_OPTIONS, Number],
      ['clipWorkers', optionsModule.CLIP_REMUX_WORKERS_OPTIONS, Number],
      ['remuxWorkers', optionsModule.CLIP_REMUX_WORKERS_OPTIONS, Number],
      ['gpuJobs', optionsModule.GPU_JOBS_OPTIONS, Number],
      ['ffmpegThreads', optionsModule.FFMPEG_THREADS_OPTIONS, Number],
      ['filterThreads', optionsModule.FILTER_THREADS_OPTIONS, Number],
      ['filterComplexThreads', optionsModule.FILTER_THREADS_OPTIONS, Number],
      ['cpuSoftLimitPercent', optionsModule.CPU_SOFT_LIMIT_PERCENT_OPTIONS, Number],
      ['memoryFreeMinimumBytes', optionsModule.MEMORY_FREE_MIN_GB_OPTIONS, (v) => Number(v) * 1024 ** 3],
      ['diskFreeMinimumBytes', optionsModule.DISK_FREE_MIN_GB_OPTIONS, (v) => Number(v) * 1024 ** 3]
    ];

    for (const [key, opts, parse] of resourceChecks) {
      expect(opts.length, `${key} phải có option`).toBeGreaterThan(1);
      for (const [raw, label] of opts) {
        expect(label.length).toBeGreaterThan(0);
        expect(label.length).toBeLessThanOrEqual(110);
        const parsed = resourceProfileSchema.safeParse({ ...baseResource, [key]: parse(raw) });
        expect(parsed.success, `resourceProfileSchema.${key}=${raw}`).toBe(true);
      }
    }

    const qualityChecks: Array<[keyof QualityProfile, ReadonlyArray<optionsModule.SelectOption>, (v: string) => unknown]> = [
      ['maxWidth', optionsModule.QUALITY_MAX_WIDTH_OPTIONS, (v) => (v === '' ? null : Number(v))],
      ['maxHeight', optionsModule.QUALITY_MAX_HEIGHT_OPTIONS, (v) => (v === '' ? null : Number(v))],
      ['customFps', optionsModule.QUALITY_CUSTOM_FPS_OPTIONS, (v) => (v === '' ? null : Number(v))],
      ['crf', optionsModule.QUALITY_CRF_OPTIONS, Number],
      ['cq', optionsModule.QUALITY_CQ_OPTIONS, Number],
      ['sampleRate', optionsModule.QUALITY_SAMPLE_RATE_OPTIONS, Number]
    ];

    for (const [key, opts, parse] of qualityChecks) {
      expect(opts.length, `${key} phải có option`).toBeGreaterThan(1);
      for (const [raw, label] of opts) {
        expect(label.length).toBeGreaterThan(0);
        expect(label.length).toBeLessThanOrEqual(110);
        const parsed = qualityProfileSchema.safeParse({ ...baseQuality, [key]: parse(raw) });
        expect(parsed.success, `qualityProfileSchema.${key}=${raw}`).toBe(true);
      }
    }
  });

  it('render toàn bộ 7 mục của SettingsPage đều không có input[type="number"] và có <select>', () => {
    const resource = builtInResourceProfiles[0]!;
    const quality = builtInQualityProfiles[0]!;
    const settings: AppSettings = {
      ...defaultAppSettings,
      defaultResourceProfileId: resource.id,
      defaultQualityProfileId: quality.id
    };

    const renderedSections = [
      ['Chung', renderToStaticMarkup(createElement(sections.General, { settings, patch: noopPatch, qualities: [quality], resources: [resource] }))],
      ['Hiệu năng', renderToStaticMarkup(createElement(sections.Performance, { settings, patch: noopPatch, resources: [resource], setError: noopError }))],
      ['Tải danh sách', renderToStaticMarkup(createElement(sections.DownloadSettings, { settings, patch: noopPatch, setError: noopError }))],
      ['Tải & Ghép', renderToStaticMarkup(createElement(sections.ProcessingSettings, { settings, patch: noopPatch, qualities: [quality], setError: noopError }))],
      ['Lưu trữ', renderToStaticMarkup(createElement(sections.Storage, { settings, patch: noopPatch }))],
      ['Kiểm tra', renderToStaticMarkup(createElement(sections.Verification, { settings, patch: noopPatch }))],
      ['Cập nhật', renderToStaticMarkup(createElement(sections.UpdateSettings, { settings, patch: noopPatch }))]
    ] as const;

    for (const [name, html] of renderedSections) {
      expect(html, `mục ${name} không được có type="number"`).not.toMatch(/type="number"/i);
      expect(html, `mục ${name} phải có <select>`).toContain('<select');
    }
  });

  it('giữ hiển thị giá trị cũ ngoài danh sách chuẩn (430p, 15 FPS, 15M, 45 ngày, 7 luồng, 1600px...) và chọn đúng giá trị đó', () => {
    const resource: ResourceProfile = {
      ...builtInResourceProfiles[0]!,
      downloadWorkers: 5,
      ffmpegThreads: 7,
      cpuSoftLimitPercent: 77,
      memoryFreeMinimumBytes: 10 * 1024 ** 3,
      diskFreeMinimumBytes: 12 * 1024 ** 3
    };
    const quality: QualityProfile = {
      ...builtInQualityProfiles[0]!,
      maxWidth: 1600,
      maxHeight: 900,
      customFps: 48,
      crf: 15,
      cq: 23,
      sampleRate: 32000
    };
    const settings: AppSettings = {
      ...defaultAppSettings,
      defaultResourceProfileId: resource.id,
      defaultQualityProfileId: quality.id,
      downloadCompatibilityMode: 'source',
      downloadMinHeight: 430,
      downloadMaxHeight: 900,
      downloadMinFps: 15,
      downloadMaxFps: 45,
      downloadMinVideoBitrateKbps: 3500,
      downloadVideoBitrateKbps: 15000,
      downloadMinAudioBitrateKbps: 112,
      downloadAudioBitrateKbps: 224,
      rateLimit: '15M',
      sourceCacheDays: 45,
      logRetentionDays: 21,
      progressRefreshMs: 750
    };

    const downloadHtml = renderToStaticMarkup(createElement(sections.DownloadSettings, { settings, patch: noopPatch, setError: noopError }));
    for (const [val, text] of [
      ['430', '430p (giá trị cũ đang lưu)'],
      ['900', '900p (giá trị cũ đang lưu)'],
      ['15', '15 FPS (giá trị cũ đang lưu)'],
      ['45', '45 FPS (giá trị cũ đang lưu)'],
      ['3500', '3.500 kbps (giá trị cũ đang lưu)'],
      ['15000', '15.000 kbps (giá trị cũ đang lưu)'],
      ['112', '112 kbps (giá trị cũ đang lưu)'],
      ['224', '224 kbps (giá trị cũ đang lưu)'],
      ['15M', '15M (giá trị cũ đang lưu)']
    ]) {
      expect(downloadHtml).toContain(`value="${val}" selected=""`);
      expect(downloadHtml).toContain(text);
    }
    // Không tự nhảy về option 0 ("Không giới hạn") cho các trường có giá trị cũ 430/15/3500...
    expect(downloadHtml).not.toContain('<option value="0" selected="">Không giới hạn</option>');

    const storageHtml = renderToStaticMarkup(createElement(sections.Storage, { settings, patch: noopPatch }));
    expect(storageHtml).toContain('value="45" selected=""');
    expect(storageHtml).toContain('45 ngày (giá trị cũ đang lưu)');

    const verifyHtml = renderToStaticMarkup(createElement(sections.Verification, { settings, patch: noopPatch }));
    expect(verifyHtml).toContain('value="21" selected=""');
    expect(verifyHtml).toContain('21 ngày (giá trị cũ đang lưu)');
    expect(verifyHtml).toContain('value="750" selected=""');
    expect(verifyHtml).toContain('750 ms (giá trị cũ đang lưu)');

    const perfHtml = renderToStaticMarkup(createElement(sections.Performance, { settings, patch: noopPatch, resources: [resource], setError: noopError }));
    expect(perfHtml).toContain('value="5" selected=""');
    expect(perfHtml).toContain('5 luồng (giá trị cũ đang lưu)');
    expect(perfHtml).toContain('value="7" selected=""');
    expect(perfHtml).toContain('7 luồng (giá trị cũ đang lưu)');
    expect(perfHtml).toContain('value="77" selected=""');
    expect(perfHtml).toContain('77% (giá trị cũ đang lưu)');
    expect(perfHtml).toContain('value="10" selected=""');
    expect(perfHtml).toContain('10 GB (giá trị cũ đang lưu)');
    expect(perfHtml).toContain('value="12" selected=""');
    expect(perfHtml).toContain('12 GB (giá trị cũ đang lưu)');

    const procHtml = renderToStaticMarkup(createElement(sections.ProcessingSettings, { settings, patch: noopPatch, qualities: [quality], setError: noopError }));
    expect(procHtml).toContain('value="1600" selected=""');
    expect(procHtml).toContain('1600 px (giá trị cũ đang lưu)');
    expect(procHtml).toContain('value="900" selected=""');
    expect(procHtml).toContain('900p (giá trị cũ đang lưu)');
    expect(procHtml).toContain('value="48" selected=""');
    expect(procHtml).toContain('48 FPS (giá trị cũ đang lưu)');
    expect(procHtml).toContain('value="15" selected=""');
    expect(procHtml).toContain('15 (giá trị cũ đang lưu)');
    expect(procHtml).toContain('value="23" selected=""');
    expect(procHtml).toContain('23 (giá trị cũ đang lưu)');
    expect(procHtml).toContain('value="32000" selected=""');
    expect(procHtml).toContain('32.000 Hz (giá trị cũ đang lưu)');
  });
});
