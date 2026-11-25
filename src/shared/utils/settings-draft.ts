import type { AppSettings } from '../types/domain.js';

function sameSettingValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

/**
 * Khi store `settings` cập nhật từ ngoài trang Cài đặt (vd bật/tắt Sáng-Tối ở thanh trên hoặc lưu Cookies),
 * chỉ đồng bộ các trường người dùng CHƯA sửa trên form để không làm mất các mục đang chỉnh dở.
 */
export function mergeExternalSettingsUpdate(
  local: AppSettings | null,
  prevStore: AppSettings | null,
  nextStore: AppSettings
): AppSettings {
  if (!local || !prevStore) return nextStore;
  const merged: AppSettings = { ...local };
  const target = merged as unknown as Record<string, unknown>;
  for (const key of Object.keys(nextStore) as Array<keyof AppSettings>) {
    const storeChanged = !sameSettingValue(nextStore[key], prevStore[key]);
    const userEdited = !sameSettingValue(local[key], prevStore[key]);
    if (storeChanged && !userEdited) {
      target[key] = nextStore[key];
    }
  }
  return merged;
}

export function hasUnsavedSettingsChanges(
  local: AppSettings | null,
  current: AppSettings | null
): boolean {
  if (!local || !current) return false;
  return (Object.keys(local) as Array<keyof AppSettings>).some(
    (key) => !sameSettingValue(local[key], current[key])
  );
}
