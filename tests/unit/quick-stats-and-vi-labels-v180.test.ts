import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SystemStats } from '../../src/shared/types/domain.js';

const root = process.cwd();
const topbar = readFileSync(join(root, 'src/renderer/src/layout/Topbar.tsx'), 'utf8');
const sidebar = readFileSync(join(root, 'src/renderer/src/layout/Sidebar.tsx'), 'utf8');
const appTsx = readFileSync(join(root, 'src/renderer/src/app/App.tsx'), 'utf8');
const queuePage = readFileSync(join(root, 'src/renderer/src/pages/QueuePage.tsx'), 'utf8');
const videoFilterPage = readFileSync(join(root, 'src/renderer/src/pages/VideoLinkFilterPage.tsx'), 'utf8');

const storeModulePath = '../../src/renderer/src/stores/app-store.js';
const { useAppStore } = (await import(/* @vite-ignore */ storeModulePath)) as {
  useAppStore: {
    getState(): { stats: SystemStats | null; setStats(stats: SystemStats): void };
    setState(partial: Record<string, unknown>): void;
  };
};

const baseStats: SystemStats = {
  cpuPercent: 10,
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
  laneWaits: { downloadLists: [], mergeWorkflows: [], downloadListCap: 2, mergeWorkflowCap: 2 },
  quickDownloadActive: false,
  quickDownloadPaused: false,
  sampledAt: '2026-11-25T10:00:00Z'
};

describe('#48: cộng trạng thái QuickDownload vào Topbar/Sidebar/App và Việt hóa QueuePage/VideoLinkFilterPage', () => {
  it('app-store setStats cập nhật ngay khi quickDownloadActive hoặc quickDownloadPaused đổi', () => {
    useAppStore.setState({ stats: baseStats });
    useAppStore.getState().setStats({ ...baseStats, quickDownloadActive: true });
    expect(useAppStore.getState().stats?.quickDownloadActive).toBe(true);
    useAppStore.getState().setStats({ ...baseStats, quickDownloadActive: false, quickDownloadPaused: true });
    expect(useAppStore.getState().stats?.quickDownloadPaused).toBe(true);
  });

  it('Topbar, Sidebar và App đều tính trạng thái QuickDownload từ stats', () => {
    expect(topbar).toContain('quickDownloadActive');
    expect(topbar).toContain('quickDownloadPaused');
    expect(sidebar).toContain('quickDownloadActive');
    expect(appTsx).toContain('quickDownloadActive');
  });

  it('QueuePage Việt hóa 100% các nhãn kỹ thuật và workflow tiếng Anh còn sót', () => {
    expect(queuePage).not.toContain('ProcessManager');
    expect(queuePage).not.toContain('ownership');
    expect(queuePage).not.toContain('backend');
    expect(queuePage).not.toContain('source cache');
    expect(queuePage).not.toContain('download, clip, normalize, merge và Quick Download');
    expect(queuePage).not.toContain('Workflow xử lý video');
    expect(queuePage).not.toContain('Workflow đầy đủ');
    expect(queuePage).not.toContain('Workflow đang chạy');
    expect(queuePage).not.toContain('Tất cả workflow');
    expect(queuePage).not.toContain('Hủy workflow');
    expect(queuePage).not.toContain('workflow phù hợp');
    expect(queuePage).not.toContain('thao tác ${kind}');
  });

  it('VideoLinkFilterPage Việt hóa nhãn URL/matchReason và định dạng lỗi thân thiện cho từng file', () => {
    expect(videoFilterPage).not.toContain('LỌC FILE THEO DANH SÁCH URL');
    expect(videoFilterPage).not.toContain('URL đầu vào');
    expect(videoFilterPage).toContain('Theo ID');
    expect(videoFilterPage).toContain('Theo tiêu đề');
    expect(videoFilterPage).toContain('friendlyIssue');
  });
});
