import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildDownloadFormatSelector,
  DOWNLOAD_LIST_POLICY_VERSION,
  downloadPolicyForWorkflow,
  forceHighestSourceSort,
  formatSelectorForWorkflow,
  HIGHEST_SOURCE_FORMAT_SELECTOR,
  HIGHEST_SOURCE_FORMAT_SORT,
  isReference1080DownloadPreset,
  GOOGLE_DRIVE_ORIGINAL_DOWNLOAD_POLICY,
  GOOGLE_DRIVE_ORIGINAL_FORMAT_SELECTOR,
  MERGE_SOURCE_FORMAT_SELECTOR,
  MERGE_SOURCE_FORMAT_SORT,
  MERGE_SOURCE_DOWNLOAD_POLICY,
  REFERENCE_1080P_FORMAT_SELECTOR,
  mergeOutputFormat,
  planCapCutCompatibility,
  settingsForDownloadWorkflow,
  validateDownloadedQuality,
  validateSelectedDownloadSize
} from '../../src/shared/utils/download-quality.js';
import type { AppSettings, MediaInfo } from '../../src/shared/types/domain.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';

const info: MediaInfo = {
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: null,
  videoLevel: null,
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/90000',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  sampleRate: 48000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4',
  fileSize: 10_000_000
};

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...defaultAppSettings, ...patch };
}

describe('download quality', () => {
  it('defaults list downloads to unbounded highest-source quality', () => {
    expect(defaultAppSettings).toMatchObject({
      downloadCompatibilityMode: 'source',
      downloadMinHeight: 0,
      downloadMaxHeight: 0,
      downloadMinFps: 0,
      downloadMaxFps: 0,
      downloadCodecPreference: 'auto',
      downloadContainerPreference: 'auto',
      downloadAllowBelowMinimum: false,
      useAria2c: true,
      aria2Connections: 16,
      downloadConcurrentFragments: 2,
      maxGlobalDownloadWorkers: 2
    });
    expect(isReference1080DownloadPreset(defaultAppSettings)).toBe(false);
    expect(forceHighestSourceSort(defaultAppSettings, 'download-only')).toBe(true);
    expect(formatSelectorForWorkflow(defaultAppSettings, 'download-only')).toBe(
      HIGHEST_SOURCE_FORMAT_SELECTOR
    );
  });

  it('keeps the explicit 1080p compatibility preset available without making it the source default', () => {
    const reference = settings({
      downloadMinHeight: 720,
      downloadMaxHeight: 1080,
      downloadCodecPreference: 'h264',
      downloadContainerPreference: 'mp4',
      downloadAllowBelowMinimum: true
    });
    expect(isReference1080DownloadPreset(reference)).toBe(true);
    expect(formatSelectorForWorkflow(reference, 'download-only')).toBe(REFERENCE_1080P_FORMAT_SELECTOR);
    expect(REFERENCE_1080P_FORMAT_SELECTOR.split('/')[0]).toContain('+ba');
    expect(REFERENCE_1080P_FORMAT_SELECTOR).toContain('bv*[height<=1080][height>=720]+ba');
  });

  it('builds a bounded selector and keeps a controlled fallback', () => {
    const selector = buildDownloadFormatSelector(
      settings({
        downloadMinHeight: 720,
        downloadMaxHeight: 2160,
        downloadMinFps: 24,
        downloadMaxFps: 60,
        downloadCodecPreference: 'h264',
        downloadMinVideoBitrateKbps: 2_000,
        downloadVideoBitrateKbps: 20_000
      })
    );
    expect(selector).toContain('[height>=?720]');
    expect(selector).toContain('[height<=?2160]');
    expect(selector).toContain("[vcodec~='^avc1|^h264']");
    expect(selector).toContain('[vbr>=?2000]');
    expect(selector).toContain('[vbr<=?20000]');
  });

  it('never applies CapCut, codec or bitrate limits to Download & Merge source files', () => {
    const mergeSourceSettings = settingsForDownloadWorkflow(
      settings({
        downloadCompatibilityMode: 'capcut_sdr_1080p',
        downloadCodecPreference: 'h264',
        downloadMaxHeight: 1080,
        downloadVideoBitrateKbps: 4_000,
        downloadAudioBitrateKbps: 128
      }),
      'download-merge'
    );

    expect(mergeSourceSettings).toMatchObject({
      downloadCompatibilityMode: 'source',
      downloadCodecPreference: 'auto',
      downloadMinHeight: 0,
      downloadMaxHeight: 0,
      downloadMinVideoBitrateKbps: 0,
      downloadVideoBitrateKbps: 0,
      downloadMinAudioBitrateKbps: 0,
      downloadAudioBitrateKbps: 0
    });
    expect(formatSelectorForWorkflow(mergeSourceSettings, 'download-merge')).toBe(
      MERGE_SOURCE_FORMAT_SELECTOR
    );
    expect(downloadPolicyForWorkflow(mergeSourceSettings, 'download-merge')).toBe(
      MERGE_SOURCE_DOWNLOAD_POLICY
    );
    expect(HIGHEST_SOURCE_FORMAT_SELECTOR).toBe('bv+ba/b');
    expect(MERGE_SOURCE_FORMAT_SELECTOR).toBe('bv*+ba/b');
    expect(MERGE_SOURCE_FORMAT_SORT).toBeNull();
    expect(HIGHEST_SOURCE_FORMAT_SORT).toBe('res,fps,size,tbr,vbr,hdr,vcodec,abr,acodec');
    expect(forceHighestSourceSort(mergeSourceSettings, 'download-merge')).toBe(false);
  });

  it('lets Google Drive use yt-dlp native/default download mode without forcing source', () => {
    const mergeSourceSettings = settingsForDownloadWorkflow(
      settings({ downloadMaxHeight: 1080, downloadCodecPreference: 'h264' }),
      'download-merge'
    );

    expect(formatSelectorForWorkflow(mergeSourceSettings, 'download-merge', 'google-drive')).toBe(
      GOOGLE_DRIVE_ORIGINAL_FORMAT_SELECTOR
    );
    expect(GOOGLE_DRIVE_ORIGINAL_FORMAT_SELECTOR).toBeNull();
    expect(downloadPolicyForWorkflow(mergeSourceSettings, 'download-merge', 'google-drive')).toBe(
      GOOGLE_DRIVE_ORIGINAL_DOWNLOAD_POLICY
    );
    expect(forceHighestSourceSort(mergeSourceSettings, 'download-merge', 'google-drive')).toBe(false);
    expect(formatSelectorForWorkflow(defaultAppSettings, 'download-only', 'google-drive')).toBeNull();
    expect(forceHighestSourceSort(defaultAppSettings, 'download-only', 'google-drive')).toBe(false);
  });

  it('applies the forced best-source ordering in the real download engine', async () => {
    const engine = await readFile(join(process.cwd(), 'src/main/downloader/download-engine.ts'), 'utf8');

    expect(engine).toContain("'--format-sort-force', '--format-sort', forcedFormatSort");
    expect(engine).toContain('[Nguon-chat-luong-cao] [%(id)s]');
    expect(engine).toContain("workflow === 'download-merge' ? isMergeSource : !isMergeSource");
    expect(engine).toContain('GOOGLE_DRIVE_NATIVE_DOWNLOAD_MODE');
    expect(engine).toContain('if (requestedFormat)');
    expect(engine).toContain("source.platform === 'google-drive'");
    expect(engine).toContain('SOURCE_CACHE_REPLACED');
    expect(engine).toContain('__VDMSP_FORMAT__');
    expect(engine).toContain('validateSelectedDownloadSize');
    expect(engine).toContain('DOWNLOAD_SIZE_ESTIMATE_MISMATCH');
    expect(engine).toContain('selectedDurationSeconds ?? undefined');
  });

  it('uses a versioned cache policy and the largest highest-source selector for an unbounded list', () => {
    const unbounded = settings({
      downloadMinHeight: 0,
      downloadMaxHeight: 0,
      downloadMinFps: 0,
      downloadMaxFps: 0,
      downloadCodecPreference: 'auto',
      downloadMinVideoBitrateKbps: 0,
      downloadVideoBitrateKbps: 0,
      downloadMinAudioBitrateKbps: 0,
      downloadAudioBitrateKbps: 0
    });
    expect(formatSelectorForWorkflow(unbounded, 'download-only')).toBe(HIGHEST_SOURCE_FORMAT_SELECTOR);
    expect(forceHighestSourceSort(unbounded, 'download-only')).toBe(true);
    expect(downloadPolicyForWorkflow(unbounded, 'download-only')).toContain(DOWNLOAD_LIST_POLICY_VERSION);
  });

  it('treats yt-dlp size metadata as advisory after media verification', () => {
    const estimateMismatch = validateSelectedDownloadSize(200_000_000, 520_000_000);
    expect(estimateMismatch.ok).toBe(true);
    expect(estimateMismatch.suspicious).toBe(true);
    expect(estimateMismatch.ratio).toBeCloseTo(0.3846, 3);
    expect(estimateMismatch.message).toContain('38%');

    const closeMatch = validateSelectedDownloadSize(505_000_000, 520_000_000);
    expect(closeMatch.ok).toBe(true);
    expect(closeMatch.suspicious).toBe(false);

    expect(validateSelectedDownloadSize(200_000_000, null)).toMatchObject({
      ok: true,
      suspicious: false
    });
    expect(validateSelectedDownloadSize(0, 520_000_000).ok).toBe(false);
  });

  it('blocks a source below minimum when fallback is disabled', () => {
    expect(
      validateDownloadedQuality(
        settings({
          downloadMinHeight: 1440,
          downloadAllowBelowMinimum: false
        }),
        info
      ).ok
    ).toBe(false);
  });

  it('warns instead of blocking when fallback is allowed', () => {
    const result = validateDownloadedQuality(
      settings({
        downloadMinHeight: 1440,
        downloadAllowBelowMinimum: true
      }),
      info
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('checks minimum and maximum video bitrate when ffprobe reports it', () => {
    expect(
      validateDownloadedQuality(
        settings({
          downloadMinVideoBitrateKbps: 9_000,
          downloadAllowBelowMinimum: false
        }),
        info
      ).ok
    ).toBe(false);
    expect(
      validateDownloadedQuality(
        settings({
          downloadVideoBitrateKbps: 7_000
        }),
        info
      ).ok
    ).toBe(false);
  });

  it('respects the selected merge container', () => {
    expect(mergeOutputFormat(settings({ downloadContainerPreference: 'mkv' }))).toBe('mkv');
  });

  it('builds a strict 1080p-to-2K selector for direct CapCut editing', () => {
    const configured = settings({
      downloadCompatibilityMode: 'capcut_sdr_2k',
      downloadAllowBelowMinimum: true,
      downloadCodecPreference: 'hevc',
      downloadContainerPreference: 'mkv'
    });
    const selector = buildDownloadFormatSelector(configured);

    expect(selector).toContain('[height=1440]');
    expect(selector).toContain('[height>=1080][height<=1440]');
    expect(selector).not.toContain('bv*+ba');
    expect(mergeOutputFormat(configured)).toBe('mp4');
  });

  it('never accepts a source below 1080p in CapCut mode', () => {
    const result = validateDownloadedQuality(
      settings({
        downloadCompatibilityMode: 'capcut_sdr_1080p',
        downloadAllowBelowMinimum: true
      }),
      { ...info, width: 1280, height: 720 }
    );
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.join(' ')).toContain('thấp hơn 1080p');
  });

  it('reuses a higher-resolution cache when CapCut preparation can downscale it', () => {
    const result = validateDownloadedQuality(
      settings({ downloadCompatibilityMode: 'capcut_sdr_2k' }),
      { ...info, width: 3840, height: 2160, fps: 120, videoCodec: 'vp9' },
      { enforceCompatibility: false, allowCapCutPreparation: true }
    );
    expect(result.ok).toBe(true);
  });

  it('plans selective HDR, codec and audio normalization for CapCut', () => {
    const plan = planCapCutCompatibility(settings({ downloadCompatibilityMode: 'capcut_sdr_2k' }), {
      ...info,
      width: 2560,
      height: 1440,
      videoCodec: 'vp9',
      pixelFormat: 'yuv420p10le',
      bitDepth: 10,
      colorPrimaries: 'bt2020',
      colorTransfer: 'smpte2084',
      colorSpace: 'bt2020nc',
      hdr: true,
      audioCodec: 'opus',
      sampleRate: 48000,
      formatName: 'matroska,webm'
    });

    expect(plan).toMatchObject({
      active: true,
      maxHeight: 1440,
      needsVideoTranscode: true,
      needsAudioTranscode: true,
      needsContainerRemux: true,
      requiresHdrToneMap: true
    });
  });

  it('keeps direct-compatible H.264 SDR video without video or audio re-encoding', () => {
    const plan = planCapCutCompatibility(settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }), info);
    expect(plan).toMatchObject({
      active: true,
      needsVideoTranscode: false,
      needsAudioTranscode: false,
      needsContainerRemux: false
    });
    expect(
      validateDownloadedQuality(settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }), info).ok
    ).toBe(true);
  });

  it('rejects a final file that still carries HDR or a non-H.264 codec', () => {
    const result = validateDownloadedQuality(settings({ downloadCompatibilityMode: 'capcut_sdr_2k' }), {
      ...info,
      width: 2560,
      height: 1440,
      videoCodec: 'vp9',
      pixelFormat: 'yuv420p10le',
      bitDepth: 10,
      hdr: true
    });
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.join(' ')).toContain('H.264');
    expect(result.blockingReasons.join(' ')).toContain('HDR');
  });
});
