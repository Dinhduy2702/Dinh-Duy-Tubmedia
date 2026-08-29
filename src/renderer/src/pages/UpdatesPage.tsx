import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCcw,
  Rocket,
  Server,
  Settings,
  ShieldCheck
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AppUpdateReleaseInfo, AppUpdateStatus } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { formatReleaseNotesForDisplay } from '../../../shared/release-notes';

const LAST_KNOWN_RELEASE_KEY = 'tubmedia:last-known-app-release';

const channelLabel = (value: string | undefined): string => (value === 'beta' ? 'Thử nghiệm' : 'Ổn định');

function bytes(value: number | undefined): string {
  const safe = value ?? 0;
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 ** 2) return `${(safe / 1024).toFixed(1)} KB`;
  if (safe < 1024 ** 3) return `${(safe / 1024 ** 2).toFixed(1)} MB`;
  return `${(safe / 1024 ** 3).toFixed(2)} GB`;
}

function readLastKnownRelease(): AppUpdateReleaseInfo | null {
  try {
    const raw = window.localStorage.getItem(LAST_KNOWN_RELEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUpdateReleaseInfo;
    return typeof parsed?.version === 'string' && parsed.version.trim() ? parsed : null;
  } catch {
    return null;
  }
}

function stableState(status: AppUpdateStatus | null): AppUpdateStatus['state'] {
  if (!status) return 'idle';
  return status.state;
}

function badgeLabel(state: AppUpdateStatus['state']): string {
  if (state === 'available') return 'Có phiên bản mới';
  if (state === 'downloading') return 'Đang tải cập nhật';
  if (state === 'downloaded') return 'Sẵn sàng cài đặt';
  if (state === 'installing') return 'Đang cài đặt';
  if (state === 'checking') return 'Đang kiểm tra';
  if (state === 'error') return 'Cần thử lại';
  if (state === 'disabled') return 'Cập nhật tự động chưa sẵn sàng';
  return 'Đang dùng bản mới nhất';
}

// TUBMEDIA_V133_PROFESSIONAL_PASSIVE_UPDATE_CENTER
export function UpdatesPage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const status = useAppStore((state) => state.updateStatus);
  const setStatus = useAppStore((state) => state.setUpdateStatus);
  const setError = useAppStore((state) => state.setError);
  const setPage = useAppStore((state) => state.setPage);
  const [busy, setBusy] = useState<'check' | 'update' | 'install' | null>(null);
  const [lastKnownRelease, setLastKnownRelease] = useState<AppUpdateReleaseInfo | null>(() =>
    readLastKnownRelease()
  );

  useEffect(() => {
    if (!status?.info?.version) return;
    setLastKnownRelease(status.info);
    try {
      window.localStorage.setItem(LAST_KNOWN_RELEASE_KEY, JSON.stringify(status.info));
    } catch {
      // Cache is optional. Update UX must stay usable when storage is unavailable.
    }
  }, [status?.info]);

  const state = stableState(status);
  const currentVersion = status?.currentVersion ?? '—';
  const latestInfo = status?.info ?? lastKnownRelease;
  const latestVersion = latestInfo?.version ?? currentVersion;
  const hasNewRelease =
    state === 'available' || state === 'downloading' || state === 'downloaded' || state === 'installing';
  const downloading = state === 'downloading';
  const progress = status?.progress?.percent ?? 0;
  const feedConfigured =
    Boolean(settings?.appFeedUrl) ||
    Boolean(status?.supported && !status.message?.includes('chưa được liên kết với máy chủ cập nhật'));

  const headline = useMemo(() => {
    if (state === 'available') return `Đã có phiên bản mới ${latestVersion}`;
    if (state === 'downloading') return `Đang tải Tubmedia ${latestVersion}`;
    if (state === 'downloaded') return `Tubmedia ${latestVersion} đã sẵn sàng cài đặt`;
    if (state === 'installing') return `Đang cài đặt Tubmedia ${latestVersion}`;
    if (state === 'checking') return 'Đang kiểm tra phiên bản mới...';
    if (state === 'error') return 'Chưa thể kiểm tra hoặc tải bản cập nhật';
    if (state === 'disabled') return 'Cập nhật tự động hiện chưa sẵn sàng';
    return `Bạn đang dùng phiên bản mới nhất ${latestVersion}`;
  }, [latestVersion, state]);

  const runUpdate = async (): Promise<void> => {
    if (state !== 'available' && state !== 'downloaded') return;
    const kind = state === 'downloaded' ? 'install' : 'update';
    setBusy(kind);
    try {
      if (state === 'downloaded') {
        await window.desktop.updates.install();
        return;
      }
      const result = await window.desktop.updates.download();
      setStatus(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async (): Promise<void> => {
    if (state === 'downloading' || state === 'installing') return;
    setBusy('check');
    try {
      const result = await window.desktop.updates.check();
      setStatus(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page-shell updates-page">
      <div className="page-heading-row">
        <div>
          <h1 className="text-2xl font-black">Trung tâm cập nhật</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Tubmedia tự đồng bộ phiên bản mới trong nền. Trang này chỉ hiển thị thông tin và hành động khi có
            bản cập nhật thực sự.
          </p>
        </div>

        <span className={`update-state-badge update-state-${state}`}>
          {state === 'error' ? (
            <AlertTriangle size={15} />
          ) : state === 'checking' ? (
            <RefreshCcw size={15} className="animate-spin" />
          ) : state === 'available' || state === 'downloading' ? (
            <Download size={15} />
          ) : state === 'downloaded' || state === 'installing' ? (
            <Rocket size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          {badgeLabel(state)}
        </span>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <section className="card update-main-card p-5">
          <div className="update-version-row">
            <div className="update-version-icon">
              <Rocket size={24} />
            </div>

            <div className="min-w-0 flex-1">
              <span>PHIÊN BẢN HIỆN TẠI</span>
              <b>{currentVersion}</b>
              <small>Kênh {channelLabel(settings?.appUpdateChannel)}</small>
            </div>

            <div className="update-next-version">
              <span>PHIÊN BẢN MỚI NHẤT</span>
              <b>{latestVersion}</b>
            </div>
          </div>

          <div className="update-message mt-4">
            <div>
              <b>{headline}</b>
              {status?.message && (state === 'error' || state === 'disabled') && (
                <small>{status.message}</small>
              )}
              {status?.checkedAt && status.state !== 'checking' && (
                <small>
                  Thông tin phiên bản cập nhật lúc {new Date(status.checkedAt).toLocaleString('vi-VN')}
                </small>
              )}
            </div>
          </div>

          {downloading && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <b>Đang tải {Math.round(progress)}%</b>
                <span style={{ color: 'var(--muted)' }}>
                  {bytes(status?.progress?.transferred)} / {bytes(status?.progress?.total)} ·{' '}
                  {bytes(status?.progress?.bytesPerSecond)}/s
                </span>
              </div>
              <div className="progress is-static update-progress">
                <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
              </div>
            </div>
          )}

          {latestInfo?.releaseNotes && (
            <details className="update-notes mt-4" open={hasNewRelease}>
              <summary>Thông tin phiên bản {latestVersion}</summary>
              <div style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                {formatReleaseNotesForDisplay(latestInfo.releaseNotes)}
              </div>
            </details>
          )}

          {(state === 'available' || state === 'downloaded') && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy !== null} onClick={() => void runUpdate()}>
                {state === 'downloaded' ? <Rocket size={17} /> : <Download size={17} />}
                {busy
                  ? state === 'downloaded'
                    ? 'Đang chuẩn bị...'
                    : 'Đang bắt đầu tải...'
                  : state === 'downloaded'
                    ? 'Cài đặt & khởi động lại'
                    : 'Cập nhật ngay'}
              </button>
            </div>
          )}

          {!['available', 'downloading', 'downloaded', 'installing'].includes(state) && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn" disabled={busy !== null} onClick={() => void runCheck()}>
                <RefreshCcw size={17} className={busy === 'check' ? 'animate-spin' : ''} />
                {busy === 'check'
                  ? 'Đang kiểm tra...'
                  : state === 'error'
                    ? 'Thử kiểm tra lại'
                    : 'Kiểm tra cập nhật'}
              </button>
            </div>
          )}
        </section>

        <div className="grid gap-4">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-black">
              <ShieldCheck size={20} style={{ color: 'var(--good)' }} />
              Nâng cấp an toàn
            </h2>
            <ol className="update-safety-list mt-4">
              <li>
                <b>1</b>
                <span>Thông tin bản mới được đồng bộ tự động, không chặn công việc đang chạy.</span>
              </li>
              <li>
                <b>2</b>
                <span>Tải và hiển thị toàn bộ tiến trình ngay trong Tubmedia.</span>
              </li>
              <li>
                <b>3</b>
                <span>Chỉ cài khi mọi tác vụ đã an toàn; bộ cài chạy im lặng, không mở wizard cài mới.</span>
              </li>
              <li>
                <b>4</b>
                <span>Giữ nguyên dự án, cookies, cấu hình và dữ liệu người dùng.</span>
              </li>
            </ol>
          </section>

          <section className={`card update-feed-card p-5 ${feedConfigured ? 'is-ready' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="update-feed-icon">
                <Server size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <b>{feedConfigured ? 'Cập nhật tự động đã sẵn sàng' : 'Chưa liên kết máy chủ cập nhật'}</b>
                <p>
                  {feedConfigured
                    ? 'Tubmedia kiểm tra khi khởi động và định kỳ; bạn vẫn có thể kiểm tra lại ngay trên trang này.'
                    : 'Bản cài đặt chưa có nguồn cập nhật hợp lệ.'}
                </p>
              </div>
            </div>

            {!feedConfigured && (
              <button className="btn mt-4" onClick={() => setPage('settings')}>
                <Settings size={16} />
                Mở cài đặt cập nhật
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
