/**
 * Giai đoạn 6 mục 6 (2026-09-24) — "Xem thông tin tệp": định dạng lại các trường MediaInfo (đã có sẵn từ
 * trước qua ffprobe/MediaAnalyzer, dùng nội bộ cho luồng ghép) thành chữ dễ đọc cho người dùng phổ thông.
 * Đặt ở tầng shared (thay vì viết thẳng trong trang React) để có thể kiểm thử đơn vị trực tiếp bằng
 * vitest, đúng quy ước hiện có của repo (renderer .tsx không được kiểm thử đơn vị trực tiếp).
 */
import type { MediaInfo } from '../types/domain.js';

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unit;
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatFps(info: Pick<MediaInfo, 'fps' | 'variableFrameRate'>): string {
  const value = `${info.fps % 1 === 0 ? info.fps : info.fps.toFixed(2)} fps`;
  return info.variableFrameRate ? `${value} (khung hình/giây thay đổi)` : value;
}

export function formatVideoCodec(info: Pick<MediaInfo, 'videoCodec' | 'videoProfile' | 'videoLevel'>): string {
  const parts = [info.videoCodec.toUpperCase()];
  if (info.videoProfile) parts.push(info.videoProfile);
  if (info.videoLevel) parts.push(info.videoLevel);
  return parts.join(' · ');
}

export function formatHdr(info: Pick<MediaInfo, 'hdr' | 'hdrType'>): string {
  if (!info.hdr) return 'Không (SDR)';
  const label = { hdr10: 'HDR10', hlg: 'HLG', dolby_vision: 'Dolby Vision', unknown: 'HDR (không rõ loại)' };
  return info.hdrType ? (label[info.hdrType] ?? 'HDR') : 'HDR';
}

// ffprobe trả bit_rate theo BIT/GIÂY (bps), không phải kbps — đã xác nhận thật bằng ffprobe thật trước
// khi viết hàm này (video nominal 2000k → đo được ~534829, audio nominal 128k → ~120804), nên PHẢI chia
// 1000 ở đây; thiếu bước này sẽ hiển thị sai lệch 1000 lần (ví dụ "534829 kbps" thay vì "535 kbps").
export function formatBitrate(bps: number | null): string {
  return bps === null ? 'Không rõ' : `${Math.round(bps / 1000)} kbps`;
}
