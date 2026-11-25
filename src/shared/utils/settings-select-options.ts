export type SelectOption = readonly [value: string, label: string];

const LEGACY_SUFFIX = '(giá trị cũ đang lưu)';

const legacyLabel = (text: string): string => `${text} ${LEGACY_SUFFIX}`;

/**
 * Giữ lại giá trị cũ đã lưu trong DB nếu nó không nằm trong danh sách lựa chọn chuẩn
 * (ví dụ người dùng từng gõ tay 430p hoặc 15 FPS ở bản cũ) để không bị nhảy sai về mặc định.
 */
export function withSavedSelectOption(
  options: readonly SelectOption[],
  currentValue: string,
  formatSavedLabel: (value: string) => string
): Array<[string, string]> {
  const normalized: Array<[string, string]> = options.map(([value, label]) => [value, label]);
  if (normalized.some(([value]) => value === currentValue)) return normalized;
  return [[currentValue, legacyLabel(formatSavedLabel(currentValue))], ...normalized];
}

export function formatLegacyIntegerVi(raw: string): string {
  const num = Number(raw);
  return Number.isFinite(num) ? num.toLocaleString('vi-VN') : raw;
}

const workerOptions = (counts: readonly number[]): ReadonlyArray<SelectOption> =>
  counts.map((count) => [String(count), `${count} luồng`]);

const gbOptions = (sizes: readonly number[]): ReadonlyArray<SelectOption> =>
  sizes.map((size) => [String(size), `${size} GB`]);

export const HEIGHT_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['0', 'Không giới hạn'],
  ['360', '360p'],
  ['480', '480p'],
  ['720', '720p (HD)'],
  ['1080', '1080p (Full HD)'],
  ['1440', '1440p (2K)'],
  ['2160', '2160p (4K)']
];

export const FPS_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['0', 'Không giới hạn'],
  ['24', '24 FPS'],
  ['30', '30 FPS'],
  ['50', '50 FPS'],
  ['60', '60 FPS'],
  ['120', '120 FPS']
];

export const VIDEO_BITRATE_KBPS_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['0', 'Không giới hạn'],
  ['1000', '1.000 kbps (1 Mbps)'],
  ['2500', '2.500 kbps (2,5 Mbps)'],
  ['5000', '5.000 kbps (5 Mbps)'],
  ['8000', '8.000 kbps (8 Mbps)'],
  ['12000', '12.000 kbps (12 Mbps)'],
  ['20000', '20.000 kbps (20 Mbps)'],
  ['40000', '40.000 kbps (40 Mbps)'],
  ['60000', '60.000 kbps (60 Mbps)']
];

export const AUDIO_BITRATE_KBPS_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['0', 'Không giới hạn'],
  ['64', '64 kbps'],
  ['96', '96 kbps'],
  ['128', '128 kbps'],
  ['192', '192 kbps'],
  ['256', '256 kbps'],
  ['320', '320 kbps']
];

export const RATE_LIMIT_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['', 'Không giới hạn'],
  ['500K', '500 KB/s (500K)'],
  ['1M', '1 MB/s (1M)'],
  ['2M', '2 MB/s (2M)'],
  ['5M', '5 MB/s (5M)'],
  ['10M', '10 MB/s (10M)'],
  ['20M', '20 MB/s (20M)'],
  ['50M', '50 MB/s (50M)'],
  ['100M', '100 MB/s (100M)']
];

export const RETENTION_DAYS_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['1', '1 ngày'],
  ['3', '3 ngày'],
  ['7', '7 ngày (1 tuần)'],
  ['14', '14 ngày (2 tuần)'],
  ['30', '30 ngày (1 tháng · mặc định)'],
  ['60', '60 ngày (2 tháng)'],
  ['90', '90 ngày (3 tháng)'],
  ['180', '180 ngày (6 tháng)'],
  ['365', '365 ngày (1 năm)']
];

export const PROGRESS_REFRESH_MS_SELECT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['100', '100 ms (rất nhanh)'],
  ['200', '200 ms'],
  ['300', '300 ms (mặc định)'],
  ['500', '500 ms (nhẹ CPU)'],
  ['1000', '1.000 ms (1 giây)'],
  ['2000', '2.000 ms (2 giây)'],
  ['5000', '5.000 ms (5 giây)']
];

export const DOWNLOAD_ANALYZE_WORKERS_OPTIONS: ReadonlyArray<SelectOption> = workerOptions([1, 2, 3, 4, 6, 8, 12, 16]);
export const NORMALIZE_WORKERS_OPTIONS: ReadonlyArray<SelectOption> = workerOptions([1, 2, 3, 4]);
export const CLIP_REMUX_WORKERS_OPTIONS: ReadonlyArray<SelectOption> = workerOptions([1, 2, 3, 4, 6, 8]);

export const GPU_JOBS_OPTIONS: ReadonlyArray<SelectOption> = [
  ['0', '0 (Chỉ dùng CPU tự động)'],
  ['1', '1 tác vụ GPU'],
  ['2', '2 tác vụ GPU'],
  ['3', '3 tác vụ GPU'],
  ['4', '4 tác vụ GPU']
];

export const FFMPEG_THREADS_OPTIONS: ReadonlyArray<SelectOption> = workerOptions([
  1, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128
]);
export const FILTER_THREADS_OPTIONS: ReadonlyArray<SelectOption> = workerOptions([
  1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64
]);

export const CPU_SOFT_LIMIT_PERCENT_OPTIONS: ReadonlyArray<SelectOption> = [
  30, 50, 60, 70, 75, 80, 85, 88, 90, 95, 98, 100
].map((pct) => [String(pct), `${pct}%`]);

export const MEMORY_FREE_MIN_GB_OPTIONS: ReadonlyArray<SelectOption> = gbOptions([
  1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 128
]);
export const DISK_FREE_MIN_GB_OPTIONS: ReadonlyArray<SelectOption> = gbOptions([
  1, 2, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000
]);

export const QUALITY_MAX_WIDTH_OPTIONS: ReadonlyArray<SelectOption> = [
  ['', 'Theo nguồn (không giới hạn)'],
  ['640', '640 px (360p)'],
  ['854', '854 px (480p)'],
  ['1280', '1280 px (720p HD)'],
  ['1920', '1920 px (1080p Full HD)'],
  ['2560', '2560 px (1440p 2K)'],
  ['3840', '3840 px (2160p 4K)']
];

export const QUALITY_MAX_HEIGHT_OPTIONS: ReadonlyArray<SelectOption> = [
  ['', 'Theo nguồn (không giới hạn)'],
  ['360', '360p'],
  ['480', '480p'],
  ['720', '720p (HD)'],
  ['1080', '1080p (Full HD)'],
  ['1440', '1440p (2K)'],
  ['2160', '2160p (4K)']
];

export const QUALITY_CUSTOM_FPS_OPTIONS: ReadonlyArray<SelectOption> = [
  ['', 'Theo chế độ FPS đã chọn'],
  ['24', '24 FPS'],
  ['25', '25 FPS'],
  ['30', '30 FPS'],
  ['50', '50 FPS'],
  ['60', '60 FPS'],
  ['120', '120 FPS']
];

export const QUALITY_CRF_OPTIONS: ReadonlyArray<SelectOption> = [
  ['14', '14 (Gần như nguyên bản)'],
  ['16', '16 (Rất cao)'],
  ['17', '17 (Cao)'],
  ['18', '18 (Khuyên dùng)'],
  ['19', '19 (Cân bằng tốt)'],
  ['20', '20 (Nhẹ, rõ)'],
  ['22', '22 (Tiết kiệm dung lượng)'],
  ['24', '24 (Nhẹ hơn)'],
  ['26', '26 (Dung lượng nhỏ)'],
  ['28', '28 (Nén mạnh)']
];

export const QUALITY_CQ_OPTIONS: ReadonlyArray<SelectOption> = [
  ['16', '16 (Rất cao)'],
  ['18', '18 (Cao)'],
  ['19', '19 (Cân bằng cao)'],
  ['20', '20 (Khuyên dùng)'],
  ['21', '21 (Cân bằng)'],
  ['22', '22 (Nhẹ, rõ)'],
  ['24', '24 (Tiết kiệm dung lượng)'],
  ['26', '26 (Dung lượng nhỏ)'],
  ['28', '28 (Nén mạnh)']
];

export const QUALITY_SAMPLE_RATE_OPTIONS: ReadonlyArray<SelectOption> = [
  ['44100', '44.100 Hz (44,1 kHz)'],
  ['48000', '48.000 Hz (48 kHz · khuyên dùng)'],
  ['96000', '96.000 Hz (96 kHz)']
];
