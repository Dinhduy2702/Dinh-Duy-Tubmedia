import { useEffect } from 'react';
import type { AppUpdateStatus, LogEntry, QueueJob } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { isNewerAppVersion } from '../../../shared/app-version';
import { coalesceBatchJobFailureAttention } from '../../../shared/batch-error-notification-aggregator.js';

const JOB_FLUSH_MS = 150;
const LOG_FLUSH_MS = 280;
const QUEUE_FLUSH_MS = 220;
const UPDATE_NOTICE_STORAGE_PREFIX = 'tubmedia:update-notice:v1';

function claimUpdateNotice(state: 'available' | 'downloaded', version: string): boolean {
  const storageKey = `${UPDATE_NOTICE_STORAGE_PREFIX}:${state}:${version}`;
  try {
    if (window.localStorage.getItem(storageKey) === '1') return false;
    window.localStorage.setItem(storageKey, '1');
  } catch {
    // localStorage có thể bị chặn; bộ nhớ trong phiên bên dưới vẫn ngăn lặp liên tục.
  }
  return true;
}

/* TUBMEDIA_R31N_NOTIFICATION_SPAM_COOKIE_ACTION */
const COOKIE_BLOCKING_CODES_R31N = [
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED'
];

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

      const version = status.info?.version ?? '';
      const remoteIsNewer = isNewerAppVersion(version, status.currentVersion);
      if (!remoteIsNewer || (status.state !== 'available' && status.state !== 'downloaded')) {
        return;
      }

      const state = status.state;
      const key = `${state}:${version}`;
      if (key === lastUpdateNotice) return;
      lastUpdateNotice = key;
      if (!claimUpdateNotice(state, version)) return;

      const downloaded = state === 'downloaded';
      store.setAttention({
        id: `app-update-${key}`,
        severity: downloaded ? 'success' : 'info',
        title: downloaded ? 'Bản cập nhật đã sẵn sàng' : `Đã có Tubmedia ${version}`,
        message: downloaded
          ? 'Bản cập nhật đã tải xong. Tubmedia đang chuẩn bị cài đặt và tự khởi động lại.'
          : 'Một phiên bản Tubmedia mới hơn đang có sẵn. Chọn Cập nhật ngay để tải bản mới. Tiến độ sẽ hiển thị trực tiếp trong Tubmedia; tải xong ứng dụng sẽ tự cài đặt và khởi động lại.',
        sticky: downloaded
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
      window.desktop.events.onAttention((notice) => {
        /* TUBMEDIA_R31N_NOTIFICATION_SPAM_COOKIE_ACTION: one actionable cookie blocker for the whole app */
        if (COOKIE_BLOCKING_CODES_R31N.includes(notice.code ?? '')) {
          const store = useAppStore.getState();
          store.dismissAttentionByCodes(COOKIE_BLOCKING_CODES_R31N);
          store.setAttention({
            id: 'cookie-blocker:global',
            severity: 'warning',
            title: 'Cần thêm Cookies',
            message:
              'Một hoặc nhiều video cần đăng nhập hoặc xác minh. Nhấn “Thêm Cookies” một lần; sau khi lưu, các video bị chặn sẽ tự tiếp tục.',
            code: 'AUTHENTICATION_REQUIRED',
            sticky: true,
            ...(notice.steps?.length ? { steps: notice.steps } : {})
          });
          return;
        }

        const store = useAppStore.getState();
        if (notice.code === 'DISK_SPACE_RECOVERED') {
          store.dismissAttentionByCodes(['DISK_FULL'], notice.projectId);
        }
        /* TUBMEDIA_R18_R10_CENTRAL_ATTENTION_AGGREGATION */
        const aggregatedNotice = coalesceBatchJobFailureAttention(notice);
        if (aggregatedNotice) {
          store.setAttention(aggregatedNotice);
        }
      }),
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
