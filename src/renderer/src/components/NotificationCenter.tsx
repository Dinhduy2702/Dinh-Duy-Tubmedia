import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Info,
  Pin,
  PinOff,
  Settings2,
  Trash2,
  Wrench,
  X,
  XCircle
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import type { Project, QueueJob } from '@shared/types/domain';
import { useShallow } from 'zustand/react/shallow';
import {
  useAppStore,
  type NotificationRecord,
  type PageId
} from '../stores/app-store';

const FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unread', label: 'Chưa đọc' },
  { id: 'action', label: 'Cần xử lý' }
] as const;

type NotificationFilter = (typeof FILTERS)[number]['id'];

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Vừa xong';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(timestamp).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function isActionRequired(notification: NotificationRecord): boolean {
  return Boolean(
    notification.sticky ||
      notification.severity === 'warning' ||
      notification.severity === 'error'
  );
}

function textField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function outputPathFromJob(
  notification: NotificationRecord,
  jobs: readonly QueueJob[],
  projects: readonly Project[]
): string | null {
  if (notification.outputPath) return notification.outputPath;
  const job = notification.jobId
    ? jobs.find((candidate) => candidate.id === notification.jobId)
    : null;
  if (job) {
    for (const key of [
      'outputPath',
      'outputFile',
      'outputFolder',
      'destinationPath',
      'destinationFolder'
    ]) {
      const path = textField(job.input, key);
      if (path) return path;
    }
  }
  const project = notification.projectId
    ? projects.find((candidate) => candidate.id === notification.projectId)
    : null;
  return project?.outputFolder ?? null;
}

function pathLooksLikeFile(path: string): boolean {
  return /[\\/][^\\/]+\.[a-z0-9]{2,6}$/i.test(path);
}

function targetFor(notification: NotificationRecord): { page: PageId; label: string } | null {
  const code = notification.code?.toUpperCase() ?? '';
  const id = notification.id.toLowerCase();
  const title = notification.title.toLowerCase();
  if (code.startsWith('APP_UPDATE_') || id.startsWith('app-update-')) {
    return { page: 'updates', label: 'Mở cập nhật' };
  }
  if (code.includes('DISK_') || code === 'DISK_FULL') {
    return { page: 'cleanup', label: 'Dọn dung lượng' };
  }
  if (code.startsWith('TOOL_') || title.includes('công cụ')) {
    return { page: 'tools', label: 'Mở công cụ' };
  }
  if (
    code.includes('COOKIE') ||
    code.includes('AUTHENTICATION') ||
    code.includes('PERMISSION') ||
    code.includes('FILE_LOCKED') ||
    notification.jobId
  ) {
    return { page: 'activity', label: 'Xem tác vụ' };
  }
  if (notification.severity === 'success') {
    return { page: 'history', label: 'Xem lịch sử' };
  }
  if (notification.severity === 'error' || notification.severity === 'warning') {
    return { page: 'diagnostics', label: 'Mở chẩn đoán' };
  }
  return null;
}

function ToneIcon({ notification }: { notification: NotificationRecord }): React.JSX.Element {
  if (notification.severity === 'error') return <XCircle size={20} />;
  if (notification.severity === 'warning') return <AlertTriangle size={20} />;
  if (notification.severity === 'success') return <CheckCircle2 size={20} />;
  return <Info size={20} />;
}

export function NotificationCenter(): React.JSX.Element | null {
  const panelRef = useRef<HTMLElement | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const {
    open,
    notifications,
    jobs,
    projects,
    closeNotificationCenter,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
    clearReadNotifications,
    toggleNotificationPin,
    setPage,
    setAttention
  } = useAppStore(
    useShallow((state) => ({
      open: state.notificationCenterOpen,
      notifications: state.notifications,
      jobs: state.jobs,
      projects: state.projects,
      closeNotificationCenter: state.closeNotificationCenter,
      markNotificationRead: state.markNotificationRead,
      markAllNotificationsRead: state.markAllNotificationsRead,
      removeNotification: state.removeNotification,
      clearReadNotifications: state.clearReadNotifications,
      toggleNotificationPin: state.toggleNotificationPin,
      setPage: state.setPage,
      setAttention: state.setAttention
    }))
  );

  const counts = useMemo(
    () => ({
      unread: notifications.filter((notification) => !notification.readAt).length,
      action: notifications.filter(isActionRequired).length,
      read: notifications.filter((notification) => Boolean(notification.readAt) && !notification.pinned).length
    }),
    [notifications]
  );

  const visible = useMemo(() => {
    const filtered = notifications.filter((notification) => {
      if (filter === 'unread') return !notification.readAt;
      if (filter === 'action') return isActionRequired(notification);
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  }, [filter, notifications]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      markAllNotificationsRead();
      closeNotificationCenter();
    };
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeNotificationCenter, markAllNotificationsRead, open]);

  if (!open) return null;

  const closeAndRead = (): void => {
    markAllNotificationsRead();
    closeNotificationCenter();
  };

  const navigate = (notification: NotificationRecord, page: PageId): void => {
    markNotificationRead(notification.id);
    setPage(page);
    closeNotificationCenter();
  };

  const openOutput = async (notification: NotificationRecord): Promise<void> => {
    const path = outputPathFromJob(notification, jobs, projects);
    if (!path) return;
    markNotificationRead(notification.id);
    try {
      await window.desktop.app.showPath(path);
    } catch (error) {
      setAttention({
        id: `notification-path-${Date.now()}`,
        severity: 'warning',
        title: 'Không thể mở vị trí đầu ra',
        message: error instanceof Error ? error.message : String(error),
        sticky: false
      });
    }
  };

  const copyOutput = async (notification: NotificationRecord): Promise<void> => {
    const path = outputPathFromJob(notification, jobs, projects);
    if (!path) return;
    markNotificationRead(notification.id);
    try {
      await window.desktop.app.writeClipboard(path);
      setAttention({
        id: `notification-copy-${Date.now()}`,
        severity: 'success',
        title: 'Đã sao chép đường dẫn',
        message: 'Đường dẫn đầu ra đã được sao chép vào bộ nhớ tạm.',
        sticky: false
      });
    } catch (error) {
      setAttention({
        id: `notification-copy-error-${Date.now()}`,
        severity: 'warning',
        title: 'Không thể sao chép đường dẫn',
        message: error instanceof Error ? error.message : String(error),
        sticky: false
      });
    }
  };

  return (
    <div className="notification-center-layer" aria-hidden={false}>
      <div className="notification-center-backdrop" onMouseDown={closeAndRead} />
      <aside
        id="notification-center-panel"
        className="notification-center-panel"
        aria-labelledby="notification-center-title"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="notification-center-header">
          <div className="notification-center-heading">
            <span className="notification-center-bell" aria-hidden="true">
              <Bell size={21} />
            </span>
            <div>
              <h2 id="notification-center-title">Trung tâm thông báo</h2>
              <p>
                {counts.unread > 0
                  ? `${counts.unread} thông báo chưa đọc`
                  : 'Bạn đã xem tất cả thông báo'}
              </p>
            </div>
          </div>
          <button className="notification-center-close" aria-label="Đóng Trung tâm thông báo" onClick={closeAndRead}>
            <X size={19} />
          </button>
        </header>

        <div className="notification-center-toolbar">
          <div className="notification-center-filters" role="tablist" aria-label="Bộ lọc thông báo">
            {FILTERS.map((item) => {
              const count = item.id === 'unread' ? counts.unread : item.id === 'action' ? counts.action : notifications.length;
              return (
                <button
                  key={item.id}
                  className={filter === item.id ? 'is-active' : ''}
                  onClick={() => setFilter(item.id)}
                  role="tab"
                  aria-selected={filter === item.id}
                >
                  {item.label}
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="notification-center-bulk-actions">
            <button disabled={counts.unread === 0} onClick={markAllNotificationsRead} title="Đánh dấu tất cả đã đọc">
              <CheckCheck size={16} />
              <span>Đã đọc</span>
            </button>
            <button disabled={counts.read === 0} onClick={clearReadNotifications} title="Xóa thông báo đã đọc">
              <Trash2 size={16} />
              <span>Xóa đã đọc</span>
            </button>
          </div>
        </div>

        <div className="notification-center-list scroll">
          {visible.length === 0 ? (
            <div className="notification-center-empty">
              <Bell size={32} />
              <b>
                {filter === 'unread'
                  ? 'Không còn thông báo chưa đọc'
                  : filter === 'action'
                    ? 'Không có việc nào cần xử lý'
                    : 'Chưa có thông báo'}
              </b>
              <span>Kết quả tải, ghép, cập nhật và cảnh báo quan trọng sẽ xuất hiện tại đây.</span>
            </div>
          ) : (
            visible.map((notification) => {
              const path = outputPathFromJob(notification, jobs, projects);
              const target = targetFor(notification);
              const showDiagnostics =
                (notification.severity === 'error' || notification.severity === 'warning') &&
                target?.page !== 'diagnostics';
              return (
                <article
                  key={notification.id}
                  className={`notification-item notification-${notification.severity} ${notification.readAt ? 'is-read' : 'is-unread'} ${notification.pinned ? 'is-pinned' : ''}`}
                >
                  <div className="notification-item-tone" aria-hidden="true">
                    <ToneIcon notification={notification} />
                  </div>
                  <div className="notification-item-content">
                    <div
                      className="notification-item-main"
                      role="button"
                      tabIndex={0}
                      onClick={() => markNotificationRead(notification.id)}
                      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          markNotificationRead(notification.id);
                        }
                      }}
                    >
                      <div className="notification-item-title-row">
                        <b>{notification.title}</b>
                        {notification.count > 1 && <span className="notification-count">×{notification.count}</span>}
                        {notification.sticky && <span className="notification-action-label">Cần xử lý</span>}
                        {notification.pinned && <Pin size={13} aria-label="Đã ghim" />}
                        {!notification.readAt && <i className="notification-unread-dot" aria-label="Chưa đọc" />}
                      </div>
                      <p>{notification.message}</p>
                      {notification.steps && notification.steps.length > 0 && (
                        <ol>
                          {notification.steps.slice(0, 3).map((step, index) => (
                            <li key={`${notification.id}-${index}`}>{step}</li>
                          ))}
                        </ol>
                      )}
                      <time dateTime={notification.updatedAt}>{relativeTime(notification.updatedAt)}</time>
                    </div>

                    <div className="notification-item-actions">
                      {path && (
                        <>
                          <button onClick={() => void openOutput(notification)}>
                            {pathLooksLikeFile(path) ? <ExternalLink size={15} /> : <FolderOpen size={15} />}
                            {pathLooksLikeFile(path) ? 'Mở tệp' : 'Mở thư mục'}
                          </button>
                          <button className="is-icon" onClick={() => void copyOutput(notification)} title="Sao chép đường dẫn" aria-label="Sao chép đường dẫn">
                            <Copy size={15} />
                          </button>
                        </>
                      )}
                      {target && (
                        <button className="is-primary" onClick={() => navigate(notification, target.page)}>
                          {target.page === 'updates' ? (
                            <Settings2 size={15} />
                          ) : target.page === 'cleanup' ? (
                            <HardDrive size={15} />
                          ) : target.page === 'tools' ? (
                            <Wrench size={15} />
                          ) : (
                            <Activity size={15} />
                          )}
                          {target.label}
                        </button>
                      )}
                      {showDiagnostics && (
                        <button onClick={() => navigate(notification, 'diagnostics')}>
                          <Activity size={15} />
                          Mở chẩn đoán
                        </button>
                      )}
                      {!notification.readAt && (
                        <button className="is-icon" onClick={() => markNotificationRead(notification.id)} title="Đánh dấu đã đọc" aria-label="Đánh dấu đã đọc">
                          <Check size={15} />
                        </button>
                      )}
                      <button
                        className="is-icon"
                        onClick={() => toggleNotificationPin(notification.id)}
                        title={notification.pinned ? 'Bỏ ghim' : 'Ghim thông báo'}
                        aria-label={notification.pinned ? 'Bỏ ghim thông báo' : 'Ghim thông báo'}
                      >
                        {notification.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                      </button>
                      <button className="is-icon is-danger" onClick={() => removeNotification(notification.id)} title="Xóa thông báo" aria-label="Xóa thông báo">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <footer className="notification-center-footer">
          <Info size={14} />
          <span>Thông báo thành công giữ 24 giờ; cảnh báo quan trọng được giữ lâu hơn và có thể ghim.</span>
        </footer>
      </aside>
    </div>
  );
}
