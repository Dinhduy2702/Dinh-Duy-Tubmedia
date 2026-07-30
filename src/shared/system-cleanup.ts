export const SYSTEM_CLEANUP_CATEGORIES = [
  {
    id: 'userTemp',
    label: 'Tệp tạm của người dùng',
    description: 'Dọn Temp tài khoản hiện tại; chế độ toàn máy quét mọi hồ sơ Windows.',
    group: 'safe',
    requiresAdmin: false,
    irreversible: false,
    defaultSelected: true
  },
  {
    id: 'thumbnailCache',
    label: 'Bộ nhớ đệm hình thu nhỏ',
    description: 'Chỉ xóa thumbcache và iconcache của Windows Explorer.',
    group: 'safe',
    requiresAdmin: false,
    irreversible: false,
    defaultSelected: true
  },
  {
    id: 'crashReports',
    label: 'Báo cáo lỗi và crash dump',
    description: 'Dọn CrashDumps, Minidump và hàng đợi Windows Error Reporting.',
    group: 'safe',
    requiresAdmin: true,
    irreversible: false,
    defaultSelected: false
  },
  {
    id: 'browserCache',
    label: 'Cache Chrome và Microsoft Edge',
    description: 'Dọn Cache, Code Cache và GPU cache; không xóa mật khẩu, lịch sử hoặc bookmark.',
    group: 'safe',
    requiresAdmin: false,
    irreversible: false,
    defaultSelected: true
  },
  {
    id: 'capcutCache',
    label: 'Cache CapCut',
    description: 'Chỉ dọn các thư mục Cache, Temp, Logs và Crashpad đã cho phép.',
    group: 'safe',
    requiresAdmin: false,
    irreversible: false,
    defaultSelected: true
  },
  {
    id: 'zaloCache',
    label: 'Cache Zalo',
    description: 'Chỉ dọn Cache, Temp và Logs; không đụng tới Zalo Received Files.',
    group: 'safe',
    requiresAdmin: false,
    irreversible: false,
    defaultSelected: true
  },
  {
    id: 'recycleBin',
    label: 'Thùng rác Windows',
    description: 'Xóa vĩnh viễn các tệp đang nằm trong Recycle Bin.',
    group: 'advanced',
    requiresAdmin: false,
    irreversible: true,
    defaultSelected: false
  },
  {
    id: 'windowsTemp',
    label: 'Windows Temp',
    description: 'Dọn nội dung C:\\Windows\\Temp và bỏ qua tệp đang bị khóa.',
    group: 'advanced',
    requiresAdmin: true,
    irreversible: false,
    defaultSelected: false
  },
  {
    id: 'windowsUpdate',
    label: 'Cache tải Windows Update',
    description: 'Dừng tạm dịch vụ liên quan, dọn SoftwareDistribution\\Download rồi khởi động lại dịch vụ.',
    group: 'advanced',
    requiresAdmin: true,
    irreversible: false,
    defaultSelected: false
  },
  {
    id: 'deliveryOptimization',
    label: 'Delivery Optimization Cache',
    description: 'Dọn cache phân phối bản cập nhật của Windows.',
    group: 'advanced',
    requiresAdmin: true,
    irreversible: false,
    defaultSelected: false
  },
  {
    id: 'componentStore',
    label: 'Dọn Component Store bằng DISM',
    description:
      'Chạy DISM StartComponentCleanup. Có thể mất nhiều phút và không thể hủy ngay khi DISM đang chạy.',
    group: 'advanced',
    requiresAdmin: true,
    irreversible: false,
    defaultSelected: false
  },
  {
    id: 'disableHibernate',
    label: 'Tắt chế độ ngủ đông',
    description:
      'Chạy powercfg -h off để xóa hiberfil.sys. Thao tác này thay đổi tính năng nguồn của Windows.',
    group: 'advanced',
    requiresAdmin: true,
    irreversible: true,
    defaultSelected: false
  }
] as const;

export type SystemCleanupCategoryId = (typeof SYSTEM_CLEANUP_CATEGORIES)[number]['id'];

export type SystemCleanupMode = 'estimate' | 'clean';
export type SystemCleanupScope = 'currentUser' | 'wholeMachine';

export interface SystemCleanupRequest {
  mode: SystemCleanupMode;
  scope: SystemCleanupScope;
  categories: SystemCleanupCategoryId[];
}

export type SystemCleanupPhase =
  'queued' | 'waiting-admin' | 'scanning' | 'cleaning' | 'completed' | 'cancelled' | 'failed';

export interface SystemCleanupDriveState {
  freeBytes: number;
  totalBytes: number;
}

export interface SystemCleanupCategoryResult {
  id: SystemCleanupCategoryId;
  estimatedBytes: number;
  removedBytes: number;
  removedItems: number;
  skippedItems: number;
  errors: string[];
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
  requiresAdmin: boolean;
  startedAt: string;
  completedAt: string | null;
  driveBefore: SystemCleanupDriveState | null;
  driveAfter: SystemCleanupDriveState | null;
  results: SystemCleanupCategoryResult[];
  errors: string[];
}

const CATEGORY_IDS = new Set<SystemCleanupCategoryId>(SYSTEM_CLEANUP_CATEGORIES.map((item) => item.id));

export function validateSystemCleanupRequest(value: unknown): SystemCleanupRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('Yêu cầu dọn dẹp không hợp lệ.');
  }

  const candidate = value as {
    mode?: unknown;
    scope?: unknown;
    categories?: unknown;
  };

  if (candidate.mode !== 'estimate' && candidate.mode !== 'clean') {
    throw new Error('Chế độ dọn dẹp không hợp lệ.');
  }

  const scope = candidate.scope ?? 'currentUser';

  if (scope !== 'currentUser' && scope !== 'wholeMachine') {
    throw new Error('Phạm vi quét hệ thống không hợp lệ.');
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
    scope,
    categories: [...unique]
  };
}

export function systemCleanupRequiresAdmin(
  categories: readonly SystemCleanupCategoryId[],
  scope: SystemCleanupScope = 'currentUser'
): boolean {
  return (
    scope === 'wholeMachine' ||
    SYSTEM_CLEANUP_CATEGORIES.some((item) => categories.includes(item.id) && item.requiresAdmin)
  );
}

export function isIrreversibleCleanupSelection(categories: readonly SystemCleanupCategoryId[]): boolean {
  return SYSTEM_CLEANUP_CATEGORIES.some((item) => categories.includes(item.id) && item.irreversible);
}
