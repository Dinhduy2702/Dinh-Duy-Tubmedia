import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResourceProfile } from '@shared/types/domain.js';
import {
  DOWNLOAD_DISK_FLOOR_BYTES,
  MERGE_DISK_FLOOR_BYTES,
  isStandardDiskFloorProfile,
  requiredFreeDiskBytesForDownload,
  requiredFreeDiskBytesForMerge
} from '@shared/utils/disk-space-policy.js';
import { withMachineThreads } from '@shared/utils/machine-threads.js';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    setLoginItemSettings: vi.fn()
  }
}));

const { AppDatabase } = await import('@main/database/database.js');
const { SettingsRepository } = await import('@main/database/repositories/settings-repository.js');
const { builtInResourceProfiles } = await import('@main/settings/defaults.js');
const { HardwareService } = await import('@main/settings/hardware-service.js');
const { SettingsService } = await import('@main/settings/settings-service.js');

const GIB = 1024 ** 3;
const base = builtInResourceProfiles.find((p) => p.id === 'resource-interactive')!;

function makeProfile(id: string, over: Partial<ResourceProfile> = {}): ResourceProfile {
  return {
    ...base,
    id,
    builtIn: false,
    ...over
  };
}

const tempRoots: string[] = [];
const openDbs: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('#11: nhận diện resource-auto* và resource-download-*-custom cho sàn ổ 3 GiB, A0 và migration 25 GiB', () => {
  it('sàn ổ tải 3 GiB và ghép 5 GiB áp dụng cho resource-auto, resource-auto-<ts> và resource-download-*-custom', () => {
    for (const id of ['resource-auto', 'resource-auto-1784736276851', 'resource-download-1-custom']) {
      const profile = makeProfile(id, { diskFreeMinimumBytes: 25 * GIB });
      expect(isStandardDiskFloorProfile(profile), id).toBe(true);
      expect(requiredFreeDiskBytesForDownload(profile, 0), id).toBe(DOWNLOAD_DISK_FLOOR_BYTES);
      expect(requiredFreeDiskBytesForMerge(profile, 0), id).toBe(MERGE_DISK_FLOOR_BYTES);
    }
    const customUser = makeProfile('resource-cua-toi', { diskFreeMinimumBytes: 12 * GIB });
    expect(isStandardDiskFloorProfile(customUser)).toBe(false);
    expect(requiredFreeDiskBytesForDownload(customUser, 0)).toBe(12 * GIB);
  });

  it('A0: kẹp luồng FFmpeg máy yếu cho resource-auto* và resource-download-*-custom (không kẹp hồ sơ tự tạo)', () => {
    for (const id of ['resource-auto', 'resource-auto-1784736276851', 'resource-download-1-custom']) {
      const profile = makeProfile(id, { ffmpegThreads: 6, filterThreads: 3, filterComplexThreads: 3 });
      const twoCpu = withMachineThreads(profile, 2);
      expect([twoCpu.ffmpegThreads, twoCpu.filterThreads, twoCpu.filterComplexThreads], id).toEqual([1, 1, 1]);
      const fourCpu = withMachineThreads(profile, 4);
      expect([fourCpu.ffmpegThreads, fourCpu.filterThreads, fourCpu.filterComplexThreads], id).toEqual([2, 2, 2]);
    }
    const customUser = makeProfile('resource-cua-toi', { ffmpegThreads: 6, filterThreads: 3, filterComplexThreads: 3 });
    expect(withMachineThreads(customUser, 2).ffmpegThreads).toBe(6);
  });

  it('SettingsService.initialize() hạ mốc 25 GiB cũ trên resource-auto* và resource-download-*-custom ngay cả khi v177 đã chạy', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'tubmedia-11-'));
    tempRoots.push(sandbox);
    const db = new AppDatabase(join(sandbox, 'db.sqlite'));
    openDbs.push(db);
    const repo = new SettingsRepository(db.db);

    repo.saveResourceProfile(makeProfile('resource-auto', { diskFreeMinimumBytes: 25 * GIB }));
    repo.saveResourceProfile(makeProfile('resource-auto-1784736276851', { diskFreeMinimumBytes: 25 * GIB }));
    repo.saveResourceProfile(makeProfile('resource-download-1-custom', { diskFreeMinimumBytes: 25 * GIB }));
    repo.saveResourceProfile(makeProfile('resource-cua-toi', { diskFreeMinimumBytes: 25 * GIB }));
    repo.set('auto_profile_disk_floor_v177', true);

    const service = new SettingsService(repo, new HardwareService());
    service.initialize();

    const byId = new Map(repo.listResourceProfiles().map((p) => [p.id, p]));
    expect(byId.get('resource-auto')?.diskFreeMinimumBytes).toBe(5 * GIB);
    expect(byId.get('resource-auto-1784736276851')?.diskFreeMinimumBytes).toBe(5 * GIB);
    expect(byId.get('resource-download-1-custom')?.diskFreeMinimumBytes).toBe(5 * GIB);
    expect(byId.get('resource-cua-toi')?.diskFreeMinimumBytes).toBe(25 * GIB);
  });
});
