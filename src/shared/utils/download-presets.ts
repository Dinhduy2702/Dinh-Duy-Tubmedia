import type { AppSettings } from '../types/domain.js';

/**
 * 1.7.6 (việc E, người dùng duyệt 2026-11-07): các nút mẫu ("Theo máy", "Chuẩn 1080p", "Nguồn cao nhất", "720p nhẹ") KHÔNG
 * BAO GIỜ đổi chế độ CapCut. Trước đây "Theo máy" đặt downloadEditCopyMode = capcut_sdr_1080p/2k + downloadCompatibilityMode =
 * 'source' (bật lại "tạo thêm bản CapCut", tắt "CapCut trực tiếp"); các mẫu chất lượng cũng đặt 'source'. Chế độ CapCut chỉ đổi
 * khi người dùng tự chọn ở ô "Chế độ tương thích video". Ở chế độ CapCut trực tiếp, các bộ lọc chất lượng dưới đây được lưu
 * nhưng chỉ có tác dụng khi chọn "Theo nguồn" (buildDownloadFormatSelector bỏ qua chúng ở chế độ CapCut).
 */
export const CAPCUT_MODE_SETTING_KEYS = ['downloadCompatibilityMode', 'downloadEditCopyMode'] as const;

export type DownloadPresetPatch = Partial<Omit<AppSettings, (typeof CAPCUT_MODE_SETTING_KEYS)[number]>>;

/** "Theo máy": chỉ chỉnh tốc độ (hồ sơ tài nguyên theo máy + số mảnh tự dò), không đụng chất lượng hay chế độ CapCut. */
export function machineRecommendationPatch(resourceProfileId: string): DownloadPresetPatch {
  return { defaultResourceProfileId: resourceProfileId, downloadFragmentsAuto: true };
}

/** "Chuẩn 1080p" / "Đa nền tảng 720p–1080p". */
export function reference1080Patch(): DownloadPresetPatch {
  return {
    downloadMinHeight: 720,
    downloadMaxHeight: 1080,
    downloadMinFps: 0,
    downloadMaxFps: 0,
    downloadCodecPreference: 'h264',
    downloadContainerPreference: 'mp4',
    downloadMinVideoBitrateKbps: 0,
    downloadVideoBitrateKbps: 0,
    downloadMinAudioBitrateKbps: 0,
    downloadAudioBitrateKbps: 0,
    downloadAllowBelowMinimum: true,
    // 2026-10-24: số mảnh mỗi video tự dò theo máy, không ghi cứng.
    downloadFragmentsAuto: true
  };
}

/** "Nguồn cao nhất". */
export function highestSourcePatch(): DownloadPresetPatch {
  return {
    downloadMinHeight: 0,
    downloadMaxHeight: 0,
    downloadMinFps: 0,
    downloadMaxFps: 0,
    downloadCodecPreference: 'auto',
    downloadMinVideoBitrateKbps: 0,
    downloadVideoBitrateKbps: 0,
    downloadMinAudioBitrateKbps: 0,
    downloadAudioBitrateKbps: 0,
    downloadAllowBelowMinimum: false
  };
}

/** "720p nhẹ và nhanh". */
export function light720Patch(): DownloadPresetPatch {
  return {
    downloadMinHeight: 0,
    downloadMaxHeight: 720,
    downloadMinFps: 0,
    downloadMaxFps: 30,
    downloadCodecPreference: 'h264',
    downloadContainerPreference: 'mp4',
    downloadMinVideoBitrateKbps: 0,
    downloadVideoBitrateKbps: 0,
    downloadMinAudioBitrateKbps: 0,
    downloadAudioBitrateKbps: 0,
    downloadAllowBelowMinimum: true
  };
}
