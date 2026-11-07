import type { ResourceProfile } from '@shared/types/domain.js';
import { withMachineThreads } from '@shared/utils/machine-threads.js';

/**
 * 2026-11-05 (người dùng duyệt, sửa A): hồ sơ có sẵn ghi cố định 3–6 luồng ffmpeg (giải mã + mã hoá) cho MỌI máy — máy 4 luồng
 * đo được 1 bản mã hoá chiếm 93% CPU, 4 luồng bận 99%. 1.7.6 (việc A0): áp cho cả luồng bộ lọc và bộ lọc phức (trước đây
 * vẫn 3/3 trên mọi máy). Quy tắc chung nằm ở @shared/utils/machine-threads (giao diện dùng cùng quy tắc để hiện số thật).
 */
export function withMachineFfmpegThreads(profile: ResourceProfile, logicalCpus: number): ResourceProfile {
  return withMachineThreads(profile, logicalCpus);
}
