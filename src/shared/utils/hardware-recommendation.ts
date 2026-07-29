import type {
  DownloadConcurrencyPlan,
  DownloadConcurrencyRecommendation,
  HardwareProfile
} from '../types/domain.js';

function gib(bytes: number): number {
  return bytes / 1024 ** 3;
}

function plan(
  listCount: DownloadConcurrencyPlan['listCount'],
  workersPerList: number,
  globalWorkers: number,
  fullVerificationWorkers: number,
  note: string
): DownloadConcurrencyPlan {
  return { listCount, workersPerList, globalWorkers, fullVerificationWorkers, note };
}

export function recommendDownloadConcurrency(
  hardware: HardwareProfile
): DownloadConcurrencyRecommendation {
  const logical = Math.max(1, hardware.logicalCpuCount);
  const ramGb = gib(hardware.totalMemoryBytes);
  const hasHdd = hardware.disks.some((disk) => disk.type === 'hdd');
  const hasSsd = hardware.disks.some((disk) => disk.type === 'ssd');

  if (logical <= 8 || ramGb <= 16) {
    return {
      recommendedConcurrentLists: 1,
      recommendedPerListWorkers: 1,
      recommendedSingleListWorkers: 2,
      recommendedGlobalWorkers: 2,
      maximumSafeGlobalWorkers: 3,
      recommendedConcurrentFragments: 1,
      recommendedAria2Connections: 4,
      summary: 'Máy cấu hình thấp: nên chạy một danh sách, tối đa hai video tải cùng lúc.',
      warnings: [
        'Khi bật kiểm tra toàn bộ video, chỉ nên dùng một worker.',
        'Đặt thư mục tạm trên SSD nếu máy có SSD.'
      ],
      plans: [
        plan(1, 2, 2, 1, 'Tối ưu nhất cho máy yếu.'),
        plan(2, 1, 2, 1, 'Chỉ dùng khi cần hai nơi lưu độc lập.'),
        plan(3, 1, 2, 1, 'Ba list chia sẻ hai worker nên sẽ chờ luân phiên.'),
        plan(4, 1, 2, 1, 'Hỗ trợ nhưng không khuyến nghị chạy đồng thời.')
      ]
    };
  }

  if (logical <= 16 || ramGb <= 32) {
    return {
      recommendedConcurrentLists: 2,
      recommendedPerListWorkers: 2,
      recommendedSingleListWorkers: 3,
      recommendedGlobalWorkers: 3,
      maximumSafeGlobalWorkers: 4,
      recommendedConcurrentFragments: 2,
      recommendedAria2Connections: 4,
      summary: 'Máy phổ thông: nên chạy một hoặc hai danh sách, giới hạn tổng ba video.',
      warnings: [
        'Nếu ổ đĩa đạt 100% Active Time, giảm tổng worker xuống 2.',
        'Khi bật kiểm tra toàn bộ video, giới hạn hai worker tổng.'
      ],
      plans: [
        plan(1, 3, 3, 2, 'Một list tận dụng tốt mạng mà vẫn giữ máy phản hồi.'),
        plan(2, 2, 3, 2, 'Hai list được scheduler chia công bằng.'),
        plan(3, 1, 3, 2, 'Ba list, mỗi list một worker.'),
        plan(4, 1, 3, 2, 'Bốn list được hỗ trợ nhưng một list sẽ thường xuyên chờ.')
      ]
    };
  }

  if (logical >= 32 && ramGb >= 64) {
    const storageWarning = hasHdd
      ? 'HDD thường là nút thắt; nên đặt temp trên SSD và output trên HDD.'
      : hasSsd
        ? 'SSD cho phép queue ổn định hơn, nhưng vẫn theo dõi tốc độ mạng và nhiệt độ.'
        : 'Không xác định được loại ổ đĩa; tăng worker từng bước và theo dõi Disk.';
    return {
      recommendedConcurrentLists: 2,
      recommendedPerListWorkers: 2,
      recommendedSingleListWorkers: 4,
      recommendedGlobalWorkers: 4,
      maximumSafeGlobalWorkers: 8,
      recommendedConcurrentFragments: 2,
      recommendedAria2Connections: 6,
      summary: 'Workstation mạnh: tối ưu nhất là hai danh sách, hai worker mỗi danh sách; bốn danh sách vẫn chạy được với một worker mỗi danh sách.',
      warnings: [
        storageWarning,
        'Khi bật kiểm tra toàn bộ video, nên giới hạn 2–3 worker tổng vì FFmpeg phải đọc/giải mã toàn bộ file.',
        'Chỉ tăng lên 6–8 worker khi mạng ổn định và ổ lưu không bị 100% Active Time.'
      ],
      plans: [
        plan(1, 4, 4, 3, 'Tốc độ cao nhất khi chỉ có một nơi lưu.'),
        plan(2, 2, 4, 3, 'Khuyến nghị mặc định cho máy workstation.'),
        plan(3, 1, 4, 2, 'Ba list chạy độc lập, một worker mỗi list; còn một worker dự phòng luân phiên.'),
        plan(4, 1, 4, 2, 'Bốn list chạy công bằng, mỗi list một worker.')
      ]
    };
  }

  return {
    recommendedConcurrentLists: 2,
    recommendedPerListWorkers: 2,
    recommendedSingleListWorkers: 3,
    recommendedGlobalWorkers: 4,
    maximumSafeGlobalWorkers: 6,
    recommendedConcurrentFragments: 2,
    recommendedAria2Connections: 6,
    summary: 'Máy khá: tối ưu nhất là một hoặc hai danh sách; ba đến bốn danh sách nên dùng một worker mỗi list.',
    warnings: [
      'Theo dõi Disk và Network trong Task Manager trước khi tăng worker.',
      'Khi bật kiểm tra toàn bộ video, giảm tổng worker xuống khoảng 2–3.'
    ],
    plans: [
      plan(1, 3, 3, 2, 'Một list, ba worker.'),
      plan(2, 2, 4, 3, 'Hai list, hai worker mỗi list.'),
      plan(3, 1, 4, 2, 'Ba list, một worker mỗi list.'),
      plan(4, 1, 4, 2, 'Bốn list, một worker mỗi list.')
    ]
  };
}

export function planForListCount(
  recommendation: DownloadConcurrencyRecommendation,
  listCount: 1 | 2 | 3 | 4,
  fullVerification: boolean
): DownloadConcurrencyPlan {
  const selected = recommendation.plans.find((item) => item.listCount === listCount) ?? recommendation.plans[0]!;
  if (!fullVerification) return selected;
  return {
    ...selected,
    globalWorkers: Math.min(selected.globalWorkers, selected.fullVerificationWorkers),
    workersPerList: Math.max(1, Math.min(selected.workersPerList, selected.fullVerificationWorkers)),
    note: `${selected.note} Đã giảm worker vì bật kiểm tra toàn bộ video.`
  };
}
