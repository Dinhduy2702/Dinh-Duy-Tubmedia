/**
 * P1 (2026-10-10): đo tiếng của tệp đã tải. Điều tra "tải nhiều video cùng lúc, một số không có tiếng" (tái hiện thật 12
 * tải đồng thời, 24/24 tệp đủ luồng tiếng) cho thấy video "không có tiếng" là do NGUỒN: không có luồng âm thanh, hoặc
 * luồng âm thanh im lặng tuyệt đối (YouTube Q7bzbdvwgBU: định dạng 140 đo −91 dB). Trước đây app không cảnh báo gì.
 */
export type AudioIssue = 'missing' | 'silent';

export interface AudioLevel {
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
}

/**
 * Đỉnh âm lượng từ mức này trở xuống coi là im lặng (không nghe được). Im lặng số tuyệt đối đo ra −91 dB; tiếng thật dù rất
 * nhỏ (đêm, máy quay xa) trong các lượt tải thật vẫn có đỉnh từ khoảng −31 dB trở lên.
 */
export const SILENT_MAX_VOLUME_DB = -60;

function decibelsAfter(stderr: string, key: string): number | null {
  const match = new RegExp(`${key}:\\s*(-?(?:\\d+(?:\\.\\d+)?|inf))\\s*dB`, 'i').exec(stderr);
  if (!match) return null;
  if (match[1]!.toLowerCase() === '-inf') return -Infinity;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Đọc kết quả bộ lọc volumedetect của ffmpeg (stderr). */
export function parseVolumeDetect(stderr: string): AudioLevel | null {
  const meanVolumeDb = decibelsAfter(stderr, 'mean_volume');
  const maxVolumeDb = decibelsAfter(stderr, 'max_volume');
  if (meanVolumeDb === null && maxVolumeDb === null) return null;
  return { meanVolumeDb, maxVolumeDb };
}

/** Đo không được (thiếu ffmpeg, lỗi giải mã) thì không báo — tránh báo nhầm "im lặng". */
export function audioIssueFor(input: { hasAudioStream: boolean; maxVolumeDb: number | null }): AudioIssue | null {
  if (!input.hasAudioStream) return 'missing';
  if (input.maxVolumeDb !== null && input.maxVolumeDb <= SILENT_MAX_VOLUME_DB) return 'silent';
  return null;
}

export function isAudioIssue(value: unknown): value is AudioIssue {
  return value === 'missing' || value === 'silent';
}

export function audioIssueLabel(issue: AudioIssue): string {
  return issue === 'missing' ? 'Không có tiếng' : 'Tiếng im lặng';
}

/** Câu giải thích cho người dùng: nói rõ là do nguồn, không phải lỗi tải. */
export function audioIssueNote(issue: AudioIssue): string {
  return issue === 'missing'
    ? 'Video này không có luồng âm thanh ngay từ nguồn (người đăng tải lên không có tiếng) — không phải lỗi tải.'
    : 'Luồng âm thanh của video này im lặng hoàn toàn ngay từ nguồn — tải lại cũng không có tiếng.';
}
