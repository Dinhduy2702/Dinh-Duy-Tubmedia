import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', setLoginItemSettings: vi.fn(), getPath: () => tmpdir() }
}));

import { AppDatabase } from '@main/database/database.js';
import { SettingsRepository } from '@main/database/repositories/settings-repository.js';
import { SettingsService } from '@main/settings/settings-service.js';
import { HardwareService } from '@main/settings/hardware-service.js';
import type { HardwareProfile, ResourceProfile } from '@shared/types/domain.js';

// Khám phá bản cài 1.5.0 (2026-10-05) #6: mỗi lần "Tạo đề xuất tự động" + áp dụng lưu thêm một hồ sơ
// `resource-auto-<Date.now()>` cùng tên "Tự động theo máy" → máy người dùng có 3 hồ sơ trùng tên.

let folder = '';
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function openRepo(): SettingsRepository {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-auto-profile-it-'));
  const database = new AppDatabase(join(folder, 'app.sqlite'));
  databases.push(database);
  return new SettingsRepository(database.db);
}

function fakeHardware(): HardwareProfile {
  return {
    platform: 'win32',
    release: '10.0',
    architecture: 'x64',
    hostname: 'test',
    physicalCpuCount: 16,
    logicalCpuCount: 32,
    cpuModel: 'CPU giả lập',
    totalMemoryBytes: 64 * 1024 ** 3,
    freeMemoryBytes: 64 * 1024 ** 3,
    gpuAdapters: [],
    disks: [],
    detectedAt: new Date().toISOString()
  };
}

function oldAutoProfile(timestamp: number): ResourceProfile {
  return { ...new HardwareService().recommend(fakeHardware()), id: `resource-auto-${timestamp}`, name: 'Tự động theo máy' };
}

describe('#6 — hồ sơ "Tự động theo máy" không bị nhân bản', () => {
  it('đề xuất tự động luôn dùng cùng một mã, nên áp dụng lại chỉ ghi đè đúng một hồ sơ', () => {
    vi.useFakeTimers();
    try {
      const service = new HardwareService();
      vi.setSystemTime(new Date(2026, 9, 3, 9, 0));
      const first = service.recommend(fakeHardware());
      vi.setSystemTime(new Date(2026, 9, 5, 14, 30));
      const second = service.recommend(fakeHardware());
      expect(first.id).toBe(second.id);

      const repo = openRepo();
      repo.saveResourceProfile(first);
      repo.saveResourceProfile(second);
      expect(repo.listResourceProfiles().filter((profile) => profile.name === 'Tự động theo máy')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('khi mở app, các hồ sơ tự động cũ được đổi tên kèm ngày lưu — không xóa, không đổi mã, thông số giữ nguyên', () => {
    const repo = openRepo();
    const olds = [
      oldAutoProfile(new Date(2026, 8, 14, 8, 5).getTime()),
      oldAutoProfile(new Date(2026, 9, 3, 14, 32).getTime()),
      { ...oldAutoProfile(new Date(2026, 9, 4, 21, 0).getTime()), downloadWorkers: 7 }
    ];
    for (const profile of olds) repo.saveResourceProfile(profile);

    const service = new SettingsService(repo, new HardwareService());
    service.initialize();
    service.initialize(); // chạy lại lần nữa không đổi tên chồng

    const after = repo.listResourceProfiles();
    const byId = new Map(after.map((profile) => [profile.id, profile]));
    expect(byId.get(olds[0]!.id)?.name).toBe('Tự động theo máy (cũ, 14/09/2026 08:05)');
    expect(byId.get(olds[1]!.id)?.name).toBe('Tự động theo máy (cũ, 03/10/2026 14:32)');
    expect(byId.get(olds[2]!.id)?.name).toBe('Tự động theo máy (cũ, 04/10/2026 21:00)');
    expect(byId.get(olds[2]!.id)?.downloadWorkers).toBe(7);
    expect(new Set(after.map((profile) => profile.name)).size).toBe(after.length);
  });

  it('không đổi tên hồ sơ tự động hiện hành hay hồ sơ người dùng tự đặt tên', () => {
    const repo = openRepo();
    const current = new HardwareService().recommend(fakeHardware());
    const renamedByUser = { ...oldAutoProfile(new Date(2026, 9, 1, 10, 0).getTime()), name: 'Máy chính — tải đêm' };
    repo.saveResourceProfile(current);
    repo.saveResourceProfile(renamedByUser);

    new SettingsService(repo, new HardwareService()).initialize();

    const byId = new Map(repo.listResourceProfiles().map((profile) => [profile.id, profile]));
    expect(byId.get(current.id)?.name).toBe('Tự động theo máy');
    expect(byId.get(renamedByUser.id)?.name).toBe('Máy chính — tải đêm');
  });
});

// Người dùng duyệt #6 (2026-10-06) và ghi nhận: tên dạng dd/mm/yyyy xếp theo chữ nên bản 14/09 đứng sau 04/10.
describe('#6 bổ sung — hồ sơ tự động cũ xếp theo thời gian', () => {
  it('các bản "Tự động theo máy (cũ, …)" xếp từ cũ đến mới, hồ sơ khác giữ thứ tự cũ', () => {
    const repo = openRepo();
    const stamps = [new Date(2026, 9, 3, 14, 32), new Date(2026, 8, 14, 8, 5), new Date(2026, 9, 4, 21, 0)].map((d) => d.getTime());
    for (const ts of stamps) repo.saveResourceProfile(oldAutoProfile(ts));
    repo.saveResourceProfile(new HardwareService().recommend(fakeHardware()));
    new SettingsService(repo, new HardwareService()).initialize();

    const names = repo.listResourceProfiles().map((profile) => profile.name);
    const old = names.filter((name) => name.startsWith('Tự động theo máy (cũ'));
    expect(old).toEqual([
      'Tự động theo máy (cũ, 14/09/2026 08:05)',
      'Tự động theo máy (cũ, 03/10/2026 14:32)',
      'Tự động theo máy (cũ, 04/10/2026 21:00)'
    ]);
    expect(names.indexOf('Tự động theo máy')).toBeGreaterThanOrEqual(0);
  });
});
