import type { HardwareProfile } from '@shared/types/domain.js';
import type { DiskKind } from '@shared/utils/disk-load.js';

/**
 * 2026-11-02: tra loại ổ thật (HDD/SSD) theo ký tự ổ cho bộ chống lag. Lần tra đầu khởi động việc dò phần cứng ở nền (một
 * lần, có bộ nhớ đệm trong SettingsService); trong lúc chưa dò xong, hoặc dò lỗi, trả 'unknown' → giữ cách chạy cũ cho ngưỡng
 * ổ bận. Không bao giờ chặn luồng tải.
 */
const RETRY_EMPTY_DISK_COOLDOWN_MS = 60_000;

export function createDiskKindLookup(detect: () => Promise<HardwareProfile>): (letter: string) => DiskKind {
  let kinds: Map<string, DiskKind> | null = null;
  let inFlight = false;
  let lastAttemptAt = 0;
  return (letter: string): DiskKind => {
    const now = Date.now();
    const shouldDetect =
      !inFlight &&
      (kinds === null || (kinds.size === 0 && now - lastAttemptAt >= RETRY_EMPTY_DISK_COOLDOWN_MS));
    if (shouldDetect) {
      inFlight = true;
      lastAttemptAt = now;
      void detect()
        .then((profile) => {
          kinds = new Map(
            profile.disks.map((disk) => [disk.device.replace(/:.*$/, '').toUpperCase(), disk.type] as [string, DiskKind])
          );
        })
        .catch(() => {
          kinds = new Map();
        })
        .finally(() => {
          inFlight = false;
        });
    }
    return kinds?.get(letter.toUpperCase()) ?? 'unknown';
  };
}
