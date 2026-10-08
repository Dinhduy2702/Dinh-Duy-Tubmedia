export type WorkbenchPathKey =
  | 'download-output'
  | 'download-temp'
  /** Mặc định thư mục tạm cho danh sách MỚI của trang Tải danh sách (ô "Đặt làm mặc định…" — phần C, 2026-10-08). */
  | 'download-temp-default'
  | 'merge-source'
  | 'merge-temp'
  /** Như trên, riêng trang Ghép theo Timeline — không dùng chung với Tải danh sách và không đụng Cài đặt chung. */
  | 'merge-temp-default'
  | 'merge-output';

const PREFIX = 'tubmedia.workbench.last-path.';

export function loadWorkbenchPath(key: WorkbenchPathKey): string | null {
  try {
    const value = window.localStorage.getItem(`${PREFIX}${key}`)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function saveWorkbenchPath(key: WorkbenchPathKey, value: string): void {
  const normalized = value.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(`${PREFIX}${key}`, normalized);
  } catch {
    // A locked or unavailable renderer storage must never block a download workflow.
  }
}
