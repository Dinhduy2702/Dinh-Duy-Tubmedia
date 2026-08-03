import { lazy, Suspense, useEffect, useRef } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import { useDesktopEvents } from '../hooks/use-desktop-events';
import { Sidebar } from '../layout/Sidebar';
import { Topbar } from '../layout/Topbar';
import { AttentionCenter } from '../components/AttentionCenter';
import { DiagnosticDock } from '../components/DiagnosticDock';
import { TubmediaMark } from '../components/TubmediaBrand';
import { friendlyIssue } from '../utils/ui-error';

const EditorHomePage = lazy(() =>
  import('../pages/EditorHomePage').then((module) => ({ default: module.EditorHomePage }))
);
const DownloadWorkbenchPage = lazy(() =>
  import('../pages/DownloadWorkbenchPage').then((module) => ({ default: module.DownloadWorkbenchPage }))
);
const DownloadMergePage = lazy(() =>
  import('../pages/DownloadMergePage').then((module) => ({ default: module.DownloadMergePage }))
);
const QueuePage = lazy(() => import('../pages/QueuePage').then((module) => ({ default: module.QueuePage })));
const HistoryPage = lazy(() =>
  import('../pages/HistoryPage').then((module) => ({ default: module.HistoryPage }))
);
const DiagnosticsPage = lazy(() =>
  import('../pages/DiagnosticsPage').then((module) => ({ default: module.DiagnosticsPage }))
);
const ToolsPage = lazy(() => import('../pages/ToolsPage').then((module) => ({ default: module.ToolsPage })));
const SystemCleanupPage = lazy(() =>
  import('../pages/SystemCleanupPage').then((module) => ({ default: module.SystemCleanupPage }))
);
const UpdatesPage = lazy(() =>
  import('../pages/UpdatesPage').then((module) => ({ default: module.UpdatesPage }))
);
const LogsPage = lazy(() => import('../pages/LogsPage').then((module) => ({ default: module.LogsPage })));
const SettingsPage = lazy(() =>
  import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
);
const AboutPage = lazy(() => import('../pages/AboutPage').then((module) => ({ default: module.AboutPage })));

const ACTIVE_STATUSES = new Set([
  'analyzing',
  'downloading',
  'verifying',
  'normalizing',
  'processing',
  'merging',
  'retrying'
]);

function PageLoader(): React.JSX.Element {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <LoaderCircle className="animate-spin" size={21} />
      <span>Đang mở khu vực làm việc...</span>
    </div>
  );
}

export function App(): React.JSX.Element {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const ready = useAppStore((state) => state.ready);
  const loading = useAppStore((state) => state.loading);
  const page = useAppStore((state) => state.page);
  const settings = useAppStore((state) => state.settings);
  const error = useAppStore((state) => state.error);
  const processing = useAppStore((state) => state.jobs.some((job) => ACTIVE_STATUSES.has(job.status)));
  const startupToolMessage = useAppStore(
    (state) => state.logs.find((entry) => entry.module === 'tools' || entry.module === 'update')?.message
  );
  const bootstrapStarted = useRef(false);
  useDesktopEvents();

  useEffect(() => {
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = (): void => {
      document.documentElement.classList.toggle(
        'light',
        settings?.theme === 'light' || (settings?.theme === 'system' && media.matches)
      );
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings?.theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('is-processing', processing);
    return () => document.documentElement.classList.remove('is-processing');
  }, [processing]);

  if (!ready) {
    const issue = error ? friendlyIssue(error) : null;
    return (
      <div className="startup-shell flex h-screen items-center justify-center p-6">
        <div className="startup-ambient startup-ambient-one" />
        <div className="startup-ambient startup-ambient-two" />
        <div className="startup-card-wrap">
          <div className="startup-light-frame" />
          <div className="card startup-card max-w-xl p-7 text-center">
            <div className="startup-brand">
              <div className="startup-logo">
                <TubmediaMark size={72} />
              </div>
              <div className="startup-brand-copy">
                <b>TUBMEDIA</b>
                <span>TRUNG TÂM TẢI &amp; GHÉP VIDEO</span>
              </div>
            </div>
            {loading ? (
              <div className="startup-loader" aria-label="Đang khởi động">
                <LoaderCircle className="animate-spin" size={22} />
              </div>
            ) : (
              <RefreshCcw className="mx-auto" size={34} style={{ color: 'var(--bad)' }} />
            )}
            <div className="startup-title">
              {loading
                ? 'Đang chuẩn bị không gian làm việc'
                : (issue?.title ?? 'Không thể khởi động ứng dụng')}
            </div>
            {loading && (
              <div className="startup-status" aria-live="polite">
                {startupToolMessage ?? 'Đang dò, kiểm tra và tự sửa công cụ cần thiết'}
                <span className="startup-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
            {loading && (
              <div className="startup-note">
                Lần chạy đầu có thể tải yt-dlp và FFmpeg. Không cần bấm kiểm tra thủ công.
              </div>
            )}
            {loading && (
              <div className="startup-progress">
                <i />
              </div>
            )}
            {issue && (
              <div
                className="mt-3 rounded-lg border p-3 text-left text-sm"
                style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
              >
                <p className="m-0 leading-6">{issue.message}</p>
                <ol className="mt-2 grid gap-1 pl-5 text-xs" style={{ color: 'var(--muted)' }}>
                  {issue.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <details className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <summary>Thông tin kỹ thuật</summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{issue.technical}</pre>
                </details>
              </div>
            )}
            {!loading && (
              <button className="btn btn-primary mt-4" onClick={() => void bootstrap()}>
                <RefreshCcw size={17} />
                Thử lại
              </button>
            )}
          </div>
        </div>
        <div className="startup-credit">
          <span>Phát triển phần mềm</span>
          <b>by Đình Duy</b>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex h-screen">
      <Sidebar />
      <div className="app-workspace flex min-w-0 flex-1 flex-col">
        <Topbar />
        <AttentionCenter />
        <DiagnosticDock />
        <main className="app-main scroll min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<PageLoader />}>
            {page === 'editor-home' && <EditorHomePage />}
            {page === 'download-workbench' && <DownloadWorkbenchPage />}
            {page === 'download-merge' && <DownloadMergePage />}
            {page === 'activity' && <QueuePage mode="all" />}
            {page === 'history' && <HistoryPage />}
            {page === 'diagnostics' && <DiagnosticsPage />}
            {page === 'tools' && <ToolsPage />}
            {page === 'cleanup' && <SystemCleanupPage />}
            {page === 'updates' && <UpdatesPage />}
            {page === 'logs' && <LogsPage />}
            {page === 'settings' && <SettingsPage />}
            {page === 'about' && <AboutPage />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
