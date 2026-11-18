import type { JobType, ResourceProfile } from '../types/domain.js';

const GIB = 1024 ** 3;
const SYNTHETIC_TEST_FLOOR_LIMIT_BYTES = 1024 ** 2;

export const DOWNLOAD_DISK_FLOOR_BYTES = 3 * GIB;
export const MERGE_DISK_FLOOR_BYTES = 5 * GIB;
export const LOCAL_CUT_DISK_FLOOR_BYTES = 5 * GIB;

const AUTO_RESOURCE_PROFILE_ID = 'resource-auto-hardware';

const DISK_FULL_OUTPUT_PATTERN =
  /no space left on device|\benospc\b|disk full|there is not enough space on the disk|không đủ dung lượng/i;

export function isStandardDiskFloorProfile(
  profile?: Pick<ResourceProfile, 'id' | 'builtIn'> | null
): boolean {
  return !profile || profile.builtIn || profile.id === AUTO_RESOURCE_PROFILE_ID;
}

export function requiredFreeDiskBytesForDownload(
  profile?: Pick<ResourceProfile, 'id' | 'builtIn' | 'diskFreeMinimumBytes'> | null,
  estimatedBytes = 0
): number {
  const safeEstimated = Number.isFinite(estimatedBytes) && estimatedBytes > 0 ? estimatedBytes : 0;
  if (isStandardDiskFloorProfile(profile)) {
    return Math.max(DOWNLOAD_DISK_FLOOR_BYTES, Math.ceil(2 * safeEstimated));
  }
  const customFloor = profile?.diskFreeMinimumBytes ?? DOWNLOAD_DISK_FLOOR_BYTES;
  if (customFloor <= 0) return 0;
  if (customFloor <= SYNTHETIC_TEST_FLOOR_LIMIT_BYTES) return customFloor;
  return Math.max(customFloor, Math.ceil(2 * safeEstimated));
}

export function requiredFreeDiskBytesForMerge(
  profile?: Pick<ResourceProfile, 'id' | 'builtIn' | 'diskFreeMinimumBytes'> | null,
  knownSourceBytes = 0
): number {
  const safeKnown = Number.isFinite(knownSourceBytes) && knownSourceBytes > 0 ? knownSourceBytes : 0;
  if (isStandardDiskFloorProfile(profile)) {
    return Math.max(MERGE_DISK_FLOOR_BYTES, Math.ceil(1.5 * safeKnown));
  }
  const customFloor = profile?.diskFreeMinimumBytes ?? MERGE_DISK_FLOOR_BYTES;
  if (customFloor <= 0) return 0;
  if (customFloor <= SYNTHETIC_TEST_FLOOR_LIMIT_BYTES) return customFloor;
  return Math.max(customFloor, Math.ceil(1.5 * safeKnown));
}

export function requiredActiveDiskGuardBytes(
  jobType: JobType,
  profile?: Pick<ResourceProfile, 'id' | 'builtIn' | 'diskFreeMinimumBytes'> | null
): number {
  return jobType === 'download'
    ? requiredFreeDiskBytesForDownload(profile, 0)
    : requiredFreeDiskBytesForMerge(profile, 0);
}

export function requiredFreeDiskBytesForLocalCut(estimatedSegmentBytes = 0): number {
  const safeEstimated =
    Number.isFinite(estimatedSegmentBytes) && estimatedSegmentBytes > 0 ? estimatedSegmentBytes : 0;
  return Math.max(LOCAL_CUT_DISK_FLOOR_BYTES, Math.ceil(1.5 * safeEstimated));
}

export function isDiskFullOutput(text: string | null | undefined): boolean {
  if (!text) return false;
  return DISK_FULL_OUTPUT_PATTERN.test(text);
}

export function buildDiskFullWriteMessage(targetPath: string, stepLabel: string): string {
  return (
    `Ổ đĩa chứa ${targetPath} đã hết dung lượng trống khi đang ${stepLabel}. ` +
    'Tubmedia đã tạm dừng an toàn và giữ nguyên phần đã xử lý; hãy dọn dung lượng rồi nhấn Tiếp tục.'
  );
}
