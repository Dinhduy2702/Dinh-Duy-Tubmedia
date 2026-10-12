import { describe, expect, it } from 'vitest';
import type { SystemStats } from '../../src/shared/types/domain.js';

// Hướng B 429 (2026-10-12): setStats bỏ qua bản mới khi CPU/RAM/số tác vụ gần như không đổi để đỡ vẽ lại — nhưng huy hiệu
// "Đang giảm tải" và "Đang chờ do giới hạn {nền tảng}" đổi được ngay cả khi các số đó đứng yên (đúng lúc nghỉ vì 429 thì
// không có video nào chạy). Trước đây bản mới bị bỏ → huy hiệu không hiện/không tắt.

interface StoreLike {
  getState(): { stats: SystemStats | null; setStats(stats: SystemStats): void };
  setState(partial: Record<string, unknown>): void;
}
const storeModulePath = '../../src/renderer/src/stores/app-store.js';
const { useAppStore } = (await import(/* @vite-ignore */ storeModulePath)) as { useAppStore: StoreLike };

const base: SystemStats = {
  cpuPercent: 12,
  memoryUsedBytes: 1,
  memoryTotalBytes: 2,
  memoryPercent: 50,
  disks: [],
  activeProcesses: 0,
  activeJobs: 0,
  downloadSpeedBytes: 0,
  encodeFps: 0,
  systemLoadThrottled: false,
  rateLimitWaits: [],
  sampledAt: '2026-10-12T10:00:00Z'
};

describe('setStats — huy hiệu trạng thái hàng đợi', () => {
  it('bắt đầu / hết nghỉ vì 429 được cập nhật dù CPU/RAM không đổi', () => {
    useAppStore.setState({ stats: base });
    const waiting = { ...base, rateLimitWaits: [{ platform: 'youtube', label: 'YouTube', resumeAt: 1, stopped: false, strikes: 1, rampLimit: null }] };
    useAppStore.getState().setStats(waiting);
    expect(useAppStore.getState().stats?.rateLimitWaits).toHaveLength(1);
    useAppStore.getState().setStats({ ...base });
    expect(useAppStore.getState().stats?.rateLimitWaits).toHaveLength(0);
  });

  it('"Đang giảm tải" bật/tắt được dù CPU/RAM không đổi', () => {
    useAppStore.setState({ stats: base });
    useAppStore.getState().setStats({ ...base, systemLoadThrottled: true });
    expect(useAppStore.getState().stats?.systemLoadThrottled).toBe(true);
  });

  it('vẫn bỏ qua bản mới khi không có gì đáng kể thay đổi', () => {
    useAppStore.setState({ stats: base });
    useAppStore.getState().setStats({ ...base, cpuPercent: 12.2, sampledAt: 'khac' });
    expect(useAppStore.getState().stats?.sampledAt).toBe(base.sampledAt);
  });
});
