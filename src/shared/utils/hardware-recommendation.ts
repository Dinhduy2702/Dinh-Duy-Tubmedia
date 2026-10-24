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

type ListCount = 1 | 2 | 3 | 4 | 5 | 6;

/** Mức theo số lõi logic: ≤4 → 1, ≤8 → 2, ≤12 → 3, ≤16 → 4, ≤24 → 5, nhiều hơn → 6. */
const CPU_LIST_TIERS: ReadonlyArray<readonly [maxLogicalCpus: number, lists: ListCount]> = [
  [4, 1], [8, 2], [12, 3], [16, 4], [24, 5]
];
/** Mức theo RAM CÒN TRỐNG (GB): ≤8 → 1, ≤16 → 2, ≤24 → 3, ≤32 → 4, ≤48 → 5, nhiều hơn → 6. */
const FREE_RAM_LIST_TIERS: ReadonlyArray<readonly [maxFreeGb: number, lists: ListCount]> = [
  [8, 1], [16, 2], [24, 3], [32, 4], [48, 5]
];

function tierOf(value: number, tiers: ReadonlyArray<readonly [number, ListCount]>): ListCount {
  for (const [limit, lists] of tiers) if (value <= limit) return lists;
  return 6;
}

/**
 * Số danh sách tải chạy cùng lúc theo máy — dùng chung cho ô "Số danh sách tải chạy cùng lúc" khi để tự động (hàng đợi đo
 * lại lõi + RAM trống mỗi phút) và cho số "khuyến nghị" ở Cài đặt. Lấy mức NHỎ HƠN giữa mức theo lõi CPU và mức theo RAM
 * trống. 2026-10-15 (người dùng duyệt): nhiều mức thay cho 2 mức cũ (≤8 lõi/≤16 GB → 1, còn lại 2), vì trần 2 làm máy
 * mạnh (36 lõi/82 GB) tải chậm gần gấp đôi. Không đổi trần riêng YouTube 6 video toàn app, cổng chờ 429 hay giãn nhịp —
 * thêm danh sách không làm tăng số video YouTube chạy song song.
 */
export function recommendedConcurrentLists(logicalCpuCount: number, freeMemoryBytes: number): ListCount {
  const cpuTier = tierOf(Math.max(1, Number.isFinite(logicalCpuCount) ? logicalCpuCount : 1), CPU_LIST_TIERS);
  const ramTier = tierOf(Math.max(0, Number.isFinite(freeMemoryBytes) ? gib(freeMemoryBytes) : 0), FREE_RAM_LIST_TIERS);
  return Math.min(cpuTier, ramTier) as ListCount;
}

export function recommendConcurrentListsForHardware(hardware: HardwareProfile): ListCount {
  return recommendedConcurrentLists(hardware.logicalCpuCount, hardware.freeMemoryBytes);
}

/**
 * Số mảnh tải song song mỗi video khi để "Tự động theo máy" (2026-10-24, nguyên tắc tự dò theo máy người dùng). Mảnh là
 * luồng mạng + bộ đệm nhỏ, không tốn RAM/CPU đáng kể như số video — nên dò theo cấu hình CỐ ĐỊNH của máy (luồng CPU, RAM
 * tổng), không theo RAM trống lúc đo (đổi liên tục làm số mảnh nhảy qua lại). Máy rất yếu (≤4 luồng hoặc ≤8 GB RAM) → 1
 * để không nghẽn; còn lại → 2 (đúng mức mọi máy vẫn chạy trước đây, nên không máy nào bị chậm đi).
 */
export function recommendedConcurrentFragments(logicalCpuCount: number, totalMemoryBytes: number): 1 | 2 {
  const logical = Number.isFinite(logicalCpuCount) ? logicalCpuCount : 1;
  const totalGb = Number.isFinite(totalMemoryBytes) ? gib(totalMemoryBytes) : 0;
  return logical <= 4 || totalGb <= 8 ? 1 : 2;
}

/** Số mảnh thật sự dùng cho lượt tải: tự động → theo máy; tự chọn → đúng số đã chọn (1–8). */
export function effectiveConcurrentFragments(
  settings: { downloadFragmentsAuto?: boolean; downloadConcurrentFragments: number },
  logicalCpuCount: number,
  totalMemoryBytes: number
): number {
  if (settings.downloadFragmentsAuto !== false) return recommendedConcurrentFragments(logicalCpuCount, totalMemoryBytes);
  return Math.max(1, Math.min(8, Math.trunc(Number(settings.downloadConcurrentFragments) || 1)));
}

/** Số video mỗi "suất danh sách" máy chịu được trong trần tổng — bằng số luồng/danh sách của hồ sơ tự động máy phổ thông. */
export const AUTO_DOWNLOADS_PER_LIST_SLOT = 2;

/**
 * Trần TỔNG số video tải cùng lúc trên toàn ứng dụng (mọi danh sách + làn ghép), tự dò theo máy (2026-10-24) — thay ô cũ
 * "Tổng video tải đồng thời toàn ứng dụng" đã lưu nhưng hàng đợi không đọc từ 1.3.0. = 2 × số danh sách tự động của trần 6
 * mức (luồng CPU + RAM trống, đo lại mỗi phút): máy yếu 2, … máy rất mạnh 12. Bằng đúng số video máy đã chạy khi để mọi thứ
 * tự động, nên không máy nào chậm đi; chỉ chặn trường hợp chọn tay nhiều danh sách × nhiều luồng hơn sức máy (VD 6 danh
 * sách × 4 luồng = 24 video trên máy 4 lõi). Trần riêng YouTube 6 vẫn áp dụng thêm.
 */
export function automaticGlobalDownloadCap(logicalCpuCount: number, freeMemoryBytes: number): number {
  return AUTO_DOWNLOADS_PER_LIST_SLOT * recommendedConcurrentLists(logicalCpuCount, freeMemoryBytes);
}

export function recommendDownloadConcurrency(
  hardware: HardwareProfile
): DownloadConcurrencyRecommendation {
  return {
    ...recommendWorkerConcurrency(hardware),
    recommendedConcurrentLists: recommendConcurrentListsForHardware(hardware),
    // "Tối đa an toàn" ở Cài đặt = đúng trần tổng hàng đợi thật sự áp dụng.
    maximumSafeGlobalWorkers: automaticGlobalDownloadCap(hardware.logicalCpuCount, hardware.freeMemoryBytes),
    // Ô "Mảnh tải đồng thời mỗi video" phải hiện đúng số bộ tải thật sự dùng khi để tự động.
    recommendedConcurrentFragments: recommendedConcurrentFragments(hardware.logicalCpuCount, hardware.totalMemoryBytes)
  };
}

function recommendWorkerConcurrency(hardware: HardwareProfile): DownloadConcurrencyRecommendation {
  const logical = Math.max(1, hardware.logicalCpuCount);
  // VẤN ĐỀ 2 mục 4 (2026-09-22): dùng RAM CÒN TRỐNG tại thời điểm đề xuất, không dùng RAM tổng máy —
  // máy 32GB nhưng đang dùng 28GB cho việc khác (VD đang edit video) không nên được đề xuất như máy
  // đang rảnh 32GB. hardware.freeMemoryBytes đã được đo mới (freemem()) mỗi lần dò phần cứng.
  const ramGb = gib(hardware.freeMemoryBytes);
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
      summary: 'Máy cấu hình thấp: tối đa hai video tải cùng lúc.',
      warnings: [
        'Khi bật kiểm tra toàn bộ video, chỉ nên dùng một worker.',
        'Đặt thư mục tạm trên SSD nếu máy có SSD.'
      ],
      plans: [
        plan(1, 2, 2, 1, 'Tối ưu nhất cho máy yếu.'),
        plan(2, 1, 2, 1, 'Chỉ dùng khi cần hai nơi lưu độc lập.'),
        plan(3, 1, 2, 1, 'Ba list chia sẻ hai worker nên sẽ chờ luân phiên.'),
        plan(4, 1, 2, 1, 'Hỗ trợ nhưng không khuyến nghị chạy đồng thời.'),
        plan(5, 1, 2, 1, 'Năm list vẫn chia sẻ đúng hai worker — phần lớn sẽ chờ luân phiên.'),
        plan(6, 1, 2, 1, 'Sáu list không khuyến nghị cho máy yếu — nên giảm bớt để máy phản hồi tốt.')
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
      summary: 'Máy phổ thông: giới hạn tổng ba video.',
      warnings: [
        'Nếu ổ đĩa đạt 100% Active Time, giảm tổng worker xuống 2.',
        'Khi bật kiểm tra toàn bộ video, giới hạn hai worker tổng.'
      ],
      plans: [
        plan(1, 3, 3, 2, 'Một list tận dụng tốt mạng mà vẫn giữ máy phản hồi.'),
        plan(2, 2, 3, 2, 'Hai list được scheduler chia công bằng.'),
        plan(3, 1, 3, 2, 'Ba list, mỗi list một worker.'),
        plan(4, 1, 3, 2, 'Bốn list được hỗ trợ nhưng một list sẽ thường xuyên chờ.'),
        plan(5, 1, 3, 2, 'Năm list chia sẻ ba worker — chờ luân phiên nhiều hơn.'),
        plan(6, 1, 3, 2, 'Sáu list không khuyến nghị cho máy phổ thông — nên giảm bớt.')
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
      summary: 'Workstation mạnh: hai worker mỗi danh sách là cân bằng nhất; nhiều danh sách hơn thì một worker mỗi danh sách.',
      warnings: [
        storageWarning,
        'Khi bật kiểm tra toàn bộ video, nên giới hạn 2–3 worker tổng vì FFmpeg phải đọc/giải mã toàn bộ file.',
        'Chỉ tăng lên 6–8 worker khi mạng ổn định và ổ lưu không bị 100% Active Time.'
      ],
      plans: [
        plan(1, 4, 4, 3, 'Tốc độ cao nhất khi chỉ có một nơi lưu.'),
        plan(2, 2, 4, 3, 'Khuyến nghị mặc định cho máy workstation.'),
        plan(3, 1, 4, 2, 'Ba list chạy độc lập, một worker mỗi list; còn một worker dự phòng luân phiên.'),
        plan(4, 1, 4, 2, 'Bốn list chạy công bằng, mỗi list một worker.'),
        plan(5, 1, 4, 2, 'Năm list vẫn chạy được, mỗi list một worker — theo dõi ổ đĩa/mạng khi dùng đủ.'),
        plan(6, 1, 4, 2, 'Sáu list — mức tối đa hỗ trợ; theo dõi sát Disk/Network trong Task Manager.')
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
    summary: 'Máy khá: từ ba danh sách trở lên nên dùng một worker mỗi danh sách.',
    warnings: [
      'Theo dõi Disk và Network trong Task Manager trước khi tăng worker.',
      'Khi bật kiểm tra toàn bộ video, giảm tổng worker xuống khoảng 2–3.'
    ],
    plans: [
      plan(1, 3, 3, 2, 'Một list, ba worker.'),
      plan(2, 2, 4, 3, 'Hai list, hai worker mỗi list.'),
      plan(3, 1, 4, 2, 'Ba list, một worker mỗi list.'),
      plan(4, 1, 4, 2, 'Bốn list, một worker mỗi list.'),
      plan(5, 1, 4, 2, 'Năm list, một worker mỗi list — chờ luân phiên nhiều hơn.'),
      plan(6, 1, 4, 2, 'Sáu list — mức tối đa hỗ trợ cho máy khá; theo dõi Disk/Network trước khi dùng hết.')
    ]
  };
}

export function planForListCount(
  recommendation: DownloadConcurrencyRecommendation,
  listCount: 1 | 2 | 3 | 4 | 5 | 6,
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
