import { useEffect } from 'react';
import type { AppUpdateStatus, LogEntry, QueueJob } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';

const JOB_FLUSH_MS = 150;
const LOG_FLUSH_MS = 280;
const QUEUE_FLUSH_MS = 220;

export function useDesktopEvents(): void {
  useEffect(() => {
    const pendingJobs = new Map<string, QueueJob>();
    const pendingLogs: LogEntry[] = [];
    let latestQueue: QueueJob[] | null = null;
    let jobTimer: number | null = null;
    let logTimer: number | null = null;
    let queueTimer: number | null = null;
    let lastUpdateNotice = '';

    const flushJobs = (): void => {
      jobTimer = null;
      if (pendingJobs.size === 0) return;
      const jobs = [...pendingJobs.values()];
      pendingJobs.clear();
      useAppStore.getState().updateJobs(jobs);
    };
    const scheduleJobs = (): void => {
      if (jobTimer !== null) return;
      jobTimer = window.setTimeout(flushJobs, document.hidden ? 600 : JOB_FLUSH_MS);
    };

    const flushLogs = (): void => {
      logTimer = null;
      if (pendingLogs.length === 0) return;
      useAppStore.getState().pushLogs(pendingLogs.splice(0));
    };
    const scheduleLogs = (): void => {
      if (logTimer !== null) return;
      logTimer = window.setTimeout(flushLogs, document.hidden ? 1_000 : LOG_FLUSH_MS);
    };

    const flushQueue = (): void => {
      queueTimer = null;
      if (!latestQueue) return;
      useAppStore.getState().replaceJobs(latestQueue);
      latestQueue = null;
    };
    const scheduleQueue = (): void => {
      if (queueTimer !== null) return;
      queueTimer = window.setTimeout(flushQueue, document.hidden ? 700 : QUEUE_FLUSH_MS);
    };

    const updateStatus = (status: AppUpdateStatus): void => {
      const store = useAppStore.getState();
      store.setUpdateStatus(status);
      if (status.state !== 'available' && status.state !== 'downloaded') return;
      const key = `${status.state}:${status.info?.version ?? ''}`;
      if (key === lastUpdateNotice) return;
      lastUpdateNotice = key;
      store.setAttention({
        id: `app-update-${key}`,
        severity: status.state === 'downloaded' ? 'success' : 'info',
        title: status.state === 'downloaded'
          ? 'Bản cập nhật đã sẵn sàng'
          : `Đã có Tubmedia ${status.info?.version ?? 'mới'}`,
        message: status.state === 'downloaded'
          ? 'Mở Trung tâm cập nhật để sao lưu và cài đặt khi các tác vụ đã dừng.'
          : 'Bạn có thể tải trong nền và tiếp tục sử dụng ứng dụng.',
        sticky: status.state === 'downloaded'
      });
    };

    const unsubscribe = [
      window.desktop.events.onJobProgress((job) => {
        pendingJobs.set(job.id, job);
        scheduleJobs();
      }),
      window.desktop.events.onQueueChanged((jobs) => {
        latestQueue = jobs;
        scheduleQueue();
      }),
      window.desktop.events.onLog((entry) => {
        pendingLogs.push(entry);
        scheduleLogs();
      }),
      window.desktop.events.onSystemStats((stats) => useAppStore.getState().setStats(stats)),
      window.desktop.events.onUpdateStatus(updateStatus),
      window.desktop.events.onAttention((notice) => useAppStore.getState().setAttention(notice)),
      window.desktop.events.onToolsChanged((tools) => useAppStore.setState({ tools }))
    ];

    const onVisibility = (): void => {
      if (!document.hidden) {
        flushJobs();
        flushLogs();
        flushQueue();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe.forEach((dispose) => dispose());
      document.removeEventListener('visibilitychange', onVisibility);
      if (jobTimer !== null) window.clearTimeout(jobTimer);
      if (logTimer !== null) window.clearTimeout(logTimer);
      if (queueTimer !== null) window.clearTimeout(queueTimer);
    };
  }, []);
}
