import type { ResourceProfile } from '@shared/types/domain.js';
import { builtInResourceProfiles } from './defaults.js';

/**
 * 2026-11-05 (người dùng duyệt, sửa A): hồ sơ có sẵn ghi cố định 3–6 luồng ffmpeg (giải mã + mã hoá) cho MỌI máy — máy 4 luồng
 * đo được 1 bản mã hoá chiếm 93% CPU, 4 luồng bận 99%. Số luồng thật dùng = min(giá trị gốc của hồ sơ, max(1, nửa số luồng
 * logic của máy đang chạy)); hồ sơ mặc định (6) → min(6, max(1, nửa)). Người dùng đã tự chỉnh (khác giá trị gốc) hoặc hồ sơ tự
 * tạo → giữ nguyên số người dùng chọn.
 */
export function withMachineFfmpegThreads(profile: ResourceProfile, logicalCpus: number): ResourceProfile {
  const original = builtInResourceProfiles.find((item) => item.id === profile.id);
  if (!profile.builtIn || !original || profile.ffmpegThreads !== original.ffmpegThreads) return profile;
  const machineCap = Math.max(1, Math.floor(Math.max(0, logicalCpus) / 2));
  const threads = Math.min(original.ffmpegThreads, machineCap);
  return threads === profile.ffmpegThreads ? profile : { ...profile, ffmpegThreads: threads };
}
