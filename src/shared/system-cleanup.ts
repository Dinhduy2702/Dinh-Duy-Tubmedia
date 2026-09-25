/**
 * Dọn dẹp máy — GIAI ĐOẠN 4a (2026-09-23): bỏ hẳn PowerShell và quyền quản trị (UAC) khỏi tính năng
 * này, theo đúng quyết định đã duyệt 2026-09-21. Toàn bộ 7 hạng mục dưới đây chỉ đụng tới dữ liệu nằm
 * trong hồ sơ người dùng Windows hiện tại (không cần Admin), quét bằng Node.js thuần
 * (xem src/main/system/cleanup-scanner.ts), không còn PowerShell hay Start-Process -Verb RunAs.
 *
 * Các hạng mục CẦN quyền quản trị (Windows Temp, cache Windows Update, Delivery Optimization,
 * Component Store) không còn được Tubmedia tự chạy nữa — chỉ liệt kê ở SYSTEM_CLEANUP_ADMIN_INFO_ITEMS
 * kèm nút mở công cụ Dọn dẹp ổ đĩa của chính Windows.
 *
 * Đã bỏ hẳn (theo quyết định đã duyệt, không phục hồi ở bản này):
 * - "Thùng rác Windows" (recycleBin) — xóa vĩnh viễn, không cần thiết cho một ứng dụng tải video.
 * - "Tắt chế độ ngủ đông" (disableHibernate) — thay đổi tính năng nguồn hệ thống, không thể hoàn tác.
 * - "Kiểm kê file lớn toàn ổ" (diskInventory) — quét không đầy đủ khi không có quyền quản trị dễ gây
 *   hiểu lầm hơn là có ích (quyết định người dùng 2026-09-23).
 * - Phần "Báo cáo lỗi hệ thống" (ProgramData\Microsoft\Windows\WER, cần Admin) trong "crashReports" —
 *   chỉ còn giữ phần CrashDumps riêng của tài khoản hiện tại (quyết định người dùng 2026-09-23).
 *
 * GĐ4a CHƯA cho xóa thật — mode 'clean' bị SystemCleanupService từ chối có thông báo rõ ràng. Xóa/cách
 * ly/hoàn tác thật sẽ làm ở Giai đoạn 4b (cần người dùng duyệt riêng trước khi bắt đầu).
 */
export const SYSTEM_CLEANUP_CATEGORIES = [
  {
    id: 'userTemp',
    label: 'Tệp tạm của người dùng',
    description: 'Dọn thư mục Temp của tài khoản Windows hiện tại.',
    defaultSelected: true
  },
  {
    id: 'thumbnailCache',
    label: 'Bộ nhớ đệm hình thu nhỏ',
    description: 'Chỉ xóa thumbcache và iconcache của Windows Explorer.',
    defaultSelected: true
  },
  {
    id: 'crashReports',
    label: 'Báo cáo lỗi của bạn (CrashDumps)',
    description:
      'Chỉ dọn CrashDumps trong hồ sơ người dùng hiện tại; không đụng báo cáo lỗi hệ thống dùng chung (cần quyền quản trị, xem mục Windows Temp/Update bên dưới).',
    defaultSelected: false
  },
  {
    id: 'browserCache',
    label: 'Cache Chrome và Microsoft Edge',
    description: 'Dọn Cache, Code Cache và GPU cache; không xóa mật khẩu, lịch sử hoặc bookmark.',
    defaultSelected: true
  },
  {
    id: 'capcutCache',
    label: 'Cache CapCut',
    description: 'Chỉ dọn các thư mục Cache, Temp, Logs và Crashpad đã cho phép.',
    defaultSelected: true
  },
  {
    id: 'zaloCache',
    label: 'Cache Zalo',
    description: 'Chỉ dọn Cache, Temp và Logs; không đụng tới Zalo Received Files.',
    defaultSelected: true
  },
  {
    id: 'tubmediaResidue',
    label: 'Dữ liệu tải dở Tubmedia cũ',
    description:
      'Chỉ nhận diện tệp .part/fragment, clip tạm và thư mục Tải nhanh do Tubmedia tạo đã quá 7 ngày.',
    defaultSelected: false
  }
] as const;

export type SystemCleanupCategoryId = (typeof SYSTEM_CLEANUP_CATEGORIES)[number]['id'];

/**
 * Các hạng mục cần quyền quản trị hệ thống dùng chung — Tubmedia KHÔNG tự quét/xóa nữa (quyết định
 * 2026-09-21). Chỉ hiển thị thông tin + nút mở công cụ Dọn dẹp ổ đĩa/Storage Sense của chính Windows.
 */
export const SYSTEM_CLEANUP_ADMIN_INFO_ITEMS = [
  {
    id: 'windowsTemp',
    label: 'Windows Temp',
    description: 'C:\\Windows\\Temp dùng chung cho mọi tài khoản trên máy.'
  },
  {
    id: 'windowsUpdate',
    label: 'Cache tải Windows Update',
    description: 'SoftwareDistribution\\Download — cần dừng dịch vụ hệ thống để dọn an toàn.'
  },
  {
    id: 'deliveryOptimization',
    label: 'Delivery Optimization Cache',
    description: 'Cache phân phối bản cập nhật dùng chung của Windows.'
  },
  {
    id: 'componentStore',
    label: 'Component Store (WinSxS)',
    description: 'Cần chạy DISM với quyền quản trị, có thể mất nhiều phút.'
  }
] as const;

export type SystemCleanupAdminInfoId = (typeof SYSTEM_CLEANUP_ADMIN_INFO_ITEMS)[number]['id'];

export type SystemCleanupMode = 'estimate' | 'clean';
export type SystemCleanupFindingClassification = 'safe-to-delete' | 'review' | 'protected';

export interface SystemCleanupRequest {
  mode: SystemCleanupMode;
  categories: SystemCleanupCategoryId[];
}

export type SystemCleanupPhase = 'queued' | 'scanning' | 'cleaning' | 'completed' | 'cancelled' | 'failed';

export interface SystemCleanupDriveState {
  freeBytes: number;
  totalBytes: number;
}

export interface SystemCleanupCategoryResult {
  id: SystemCleanupCategoryId;
  /** Tổng số file khớp, KHÔNG chỉ số mẫu trong `findings` — dùng để hiển thị "X tệp" trước khi xóa. */
  matchedItems: number;
  estimatedBytes: number;
  removedBytes: number;
  removedItems: number;
  skippedItems: number;
  errors: string[];
  findings: SystemCleanupFinding[];
}

export interface SystemCleanupFinding {
  path: string;
  bytes: number;
  classification: SystemCleanupFindingClassification;
  reason: string;
}

export interface SystemCleanupStatus {
  runId: string;
  mode: SystemCleanupMode;
  phase: SystemCleanupPhase;
  progress: number;
  message: string;
  currentCategory: SystemCleanupCategoryId | null;
  processedCategories: number;
  totalCategories: number;
  estimatedBytes: number;
  removedBytes: number;
  removedItems: number;
  skippedItems: number;
  startedAt: string;
  completedAt: string | null;
  driveBefore: SystemCleanupDriveState | null;
  driveAfter: SystemCleanupDriveState | null;
  results: SystemCleanupCategoryResult[];
  findings: SystemCleanupFinding[];
  safeToDeleteBytes: number;
  reviewBytes: number;
  protectedBytes: number;
  errors: string[];
}

const CATEGORY_IDS = new Set<SystemCleanupCategoryId>(SYSTEM_CLEANUP_CATEGORIES.map((item) => item.id));

/** Số ngày giữ một mục trong khu cách ly trước khi bị xóa vĩnh viễn — xem cleanup-quarantine.ts. */
export const QUARANTINE_RETENTION_DAYS = 14;

/**
 * GĐ4b: một mục đã bị "xóa" qua Dọn dẹp máy nhưng thực chất chỉ được DI CHUYỂN vào khu cách ly riêng
 * của Tubmedia trong userData (không dùng Windows Recycle Bin) — xem src/main/system/cleanup-quarantine.ts.
 * Có thể hoàn tác cho tới `expiresAt`; sau đó bị xóa vĩnh viễn (purgedAt được đặt).
 */
export interface QuarantineEntry {
  id: string;
  runId: string;
  categoryId: SystemCleanupCategoryId;
  originalPath: string;
  bytes: number;
  quarantinedAt: string;
  expiresAt: string;
  restoredAt: string | null;
  restoredPath: string | null;
  purgedAt: string | null;
}

export interface QuarantineRestoreOutcome {
  id: string;
  ok: boolean;
  restoredPath?: string;
  message?: string;
}

export function validateSystemCleanupRequest(value: unknown): SystemCleanupRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Yêu cầu dọn dẹp không hợp lệ.');
  }

  const candidate = value as {
    mode?: unknown;
    categories?: unknown;
  };

  if (candidate.mode !== 'estimate' && candidate.mode !== 'clean') {
    throw new Error('Chế độ dọn dẹp không hợp lệ.');
  }

  if (!Array.isArray(candidate.categories)) {
    throw new Error('Danh sách hạng mục dọn dẹp không hợp lệ.');
  }

  const unique = new Set<SystemCleanupCategoryId>();

  for (const rawId of candidate.categories) {
    if (typeof rawId !== 'string' || !CATEGORY_IDS.has(rawId as SystemCleanupCategoryId)) {
      throw new Error(`Hạng mục dọn dẹp không được phép: ${String(rawId)}`);
    }

    unique.add(rawId as SystemCleanupCategoryId);
  }

  if (unique.size === 0) {
    throw new Error('Hãy chọn ít nhất một hạng mục dọn dẹp.');
  }

  return {
    mode: candidate.mode,
    categories: [...unique]
  };
}
