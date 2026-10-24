import { useEffect } from 'react';
import type { AppUpdateStatus, LogEntry, QueueJob } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { isNewerAppVersion } from '../../../shared/app-version';
import { coalesceBatchJobFailureAttention } from '../../../shared/batch-error-notification-aggregator.js';
import { UPDATE_ATTENTION_ID_PREFIX, shouldShowUpdateNotice, updateNoticeKey } from '../utils/update-notice';

const JOB_FLUSH_MS = 150;
const LOG_FLUSH_MS = 280;
const QUEUE_FLUSH_MS = 220;
/**
 * 2026-10-24: thông báo cập nhật đã hiện trong PHIÊN này (mở lại app thì nhắc lại nếu vẫn còn bản mới / bản chờ cài). Trước
 * đây ghi vĩnh viễn vào localStorage theo phiên bản. Ngoài module để dùng chung khi hook gắn lại (React StrictMode, đổi cửa sổ).
 */
const updateNoticesShownThisSession = new Set<string>();

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
      useAppStore.getState().receiveLiveLogs(pendingLogs.splice(0));
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
      const key = updateNoticeKey(state, version);
      // Đã vào trang Cập nhật trong phiên này, hoặc đã hiện đúng thông báo này → không hiện lại (việc dò vẫn chạy ngầm).
      if (
        !shouldShowUpdateNotice({
          updateCenterVisited: store.updateCenterVisited,
          shownThisSession: updateNoticesShownThisSession,
          key
        })
      ) {
        return;
      }
      updateNoticesShownThisSession.add(key);

      const downloaded = state === 'downloaded';
      store.setAttention({
        id: `${UPDATE_ATTENTION_ID_PREFIX}${key}`,
        severity: downloaded ? 'success' : 'info',
        title: downloaded ? 'Bản cập nhật đã sẵn sàng' : `Đã có Tubmedia ${version}`,
        message: downloaded
          ? 'Bản cập nhật đã tải và xác minh xong. Bấm Cài đặt & khởi động lại để cài ngay; dữ liệu và cấu hình được giữ nguyên.'
          : 'Một phiên bản Tubmedia mới hơn đang có sẵn. Chọn Cập nhật ngay để tải và theo dõi tiến độ trực tiếp trong app.',
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
        const projectName = notice.projectId
          ? store.projects.find((project) => project.id === notice.projectId)?.name
          : undefined;
        const aggregatedNotice = coalesceBatchJobFailureAttention(notice, projectName);
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
