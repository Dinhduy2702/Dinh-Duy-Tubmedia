import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCcw,
  Rocket,
  Server,
  Settings,
  ShieldCheck
} from 'lucide-react';
import { useState } from 'react';
import type { AppUpdateStatus } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { createUiEventId } from '../utils/ui-id';

import { formatReleaseNotesForDisplay } from '../../../shared/release-notes';
const channelLabel = (value: string | undefined): string => (value === 'beta' ? 'Thử nghiệm' : 'Ổn định');

function bytes(value: number | undefined): string {
  const safe = value ?? 0;
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 ** 2) return `${(safe / 1024).toFixed(1)} KB`;
  if (safe < 1024 ** 3) return `${(safe / 1024 ** 2).toFixed(1)} MB`;
  return `${(safe / 1024 ** 3).toFixed(2)} GB`;
}

function stateLabel(status: AppUpdateStatus | null): string {
  if (!status) return 'Chưa đọc trạng thái';
  const labels: Record<AppUpdateStatus['state'], string> = {
    idle: 'Sẵn sàng',
    disabled: 'Chưa liên kết máy chủ',
    checking: 'Đang kiểm tra',
    available: 'Có phiên bản mới',
    'not-available': 'Đang dùng bản mới nhất',
    downloading: 'Đang tải trong nền',
    downloaded: 'Sẵn sàng cài đặt',
    installing: 'Đang chuẩn bị cài đặt',
    error: 'Cập nhật gặp sự cố'
  };
  return labels[status.state];
}

export function UpdatesPage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const status = useAppStore((state) => state.updateStatus);
  const setStatus = useAppStore((state) => state.setUpdateStatus);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const setPage = useAppStore((state) => state.setPage);
  const [busy, setBusy] = useState<'check' | 'download' | 'install' | null>(null);

  const run = async (kind: 'check' | 'download' | 'install'): Promise<void> => {
    setBusy(kind);
    try {
      if (kind === 'install') {
        await window.desktop.updates.install();
        return;
      }
      const result = await window.desktop.updates[kind]();
      setStatus(result);
      if (kind === 'check' && result.state === 'not-available') {
        setAttention({
          id: createUiEventId('update-current'),
          severity: 'success',
          title: 'Tubmedia đã được cập nhật',
          message: `Bạn đang dùng phiên bản ${result.currentVersion}.`,
          sticky: false
        });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const downloading = status?.state === 'downloading';
  const progress = status?.progress?.percent ?? 0;
  const canDownload = status?.state === 'available';
  const canInstall = status?.state === 'downloaded';
  const feedConfigured =
    Boolean(settings?.appFeedUrl) || Boolean(status?.supported && status?.state !== 'disabled');

  return (
    <div className="page-shell updates-page">
      <div className="page-heading-row">
        <div>
          <h1 className="text-2xl font-black">Trung tâm cập nhật</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Tải phiên bản mới trong nền, sao lưu dữ liệu và nâng cấp ngay trên thư mục cài đặt hiện tại.
          </p>
        </div>
        <span className={`update-state-badge update-state-${status?.state ?? 'idle'}`}>
          {status?.state === 'not-available' || status?.state === 'downloaded' ? (
            <CheckCircle2 size={15} />
          ) : status?.state === 'downloading' ? (
            <Download size={15} />
          ) : status?.state === 'installing' ? (
            <Rocket size={15} />
          ) : (
            <RefreshCcw size={15} />
          )}
          {stateLabel(status)}
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
              <b>{status?.currentVersion ?? '—'}</b>
              <small>Kênh {channelLabel(settings?.appUpdateChannel)}</small>
            </div>
            {status?.info?.version && (
              <div className="update-next-version">
                <span>PHIÊN BẢN MỚI</span>
                <b>{status.info.version}</b>
              </div>
            )}
          </div>

          <div className="update-message mt-4">
            <div>
              <b>{status?.message ?? 'Chưa kiểm tra bản cập nhật.'}</b>
              {status?.checkedAt && (
                <small>Kiểm tra lúc {new Date(status.checkedAt).toLocaleString('vi-VN')}</small>
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

          {status?.info?.releaseNotes && (
            <details
              className="update-notes mt-4"
              open={status.state === 'available' || status.state === 'downloaded'}
            >
              <summary>Điểm mới trong phiên bản {status.info.version}</summary>
              <div style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                {formatReleaseNotesForDisplay(status.info.releaseNotes)}
              </div>
            </details>
          )}

          {status?.error && (
            <details className="update-error-detail mt-4">
              <summary>Thông tin kỹ thuật</summary>
              <pre>{status.error}</pre>
            </details>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn" disabled={busy !== null || downloading} onClick={() => void run('check')}>
              <RefreshCcw size={17} />
              {busy === 'check' ? 'Đang kiểm tra...' : 'Kiểm tra ngay'}
            </button>
            {canDownload && (
              <button className="btn" disabled={busy !== null} onClick={() => void run('download')}>
                <Download size={17} />
                {busy === 'download' ? 'Đang tải...' : 'Tải trong nền'}
              </button>
            )}
            {canInstall && (
              <button
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void run('install')}
              >
                <Rocket size={17} />
                {busy === 'install' ? 'Đang chuẩn bị...' : 'Sao lưu và cài đặt'}
              </button>
            )}
          </div>
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
                <span>Tải gói cập nhật trong nền, không chặn công việc đang chạy.</span>
              </li>
              <li>
                <b>2</b>
                <span>Chỉ cài khi hàng đợi đã dừng để không làm hỏng tệp đang xử lý.</span>
              </li>
              <li>
                <b>3</b>
                <span>Tự sao lưu cơ sở dữ liệu trước khi khởi động lại.</span>
              </li>
              <li>
                <b>4</b>
                <span>Giữ nguyên thư mục cài đặt, dự án, cookies và cấu hình người dùng.</span>
              </li>
            </ol>
          </section>

          <section className={`card update-feed-card p-5 ${feedConfigured ? 'is-ready' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="update-feed-icon">
                <Server size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <b>{feedConfigured ? 'Máy chủ cập nhật đã sẵn sàng' : 'Chưa liên kết máy chủ cập nhật'}</b>
                <p>
                  {feedConfigured
                    ? 'Ứng dụng chỉ kiểm tra khi người dùng bấm Kiểm tra ngay; không chạy vòng xoay cập nhật nền.'
                    : 'Bản phát hành phải được build với URL HTTPS hoặc nhập URL nâng cao trong Cài đặt.'}
                </p>
              </div>
            </div>
            {!feedConfigured && (
              <button className="btn mt-4" onClick={() => setPage('settings')}>
                <Settings size={16} />
                Mở cài đặt cập nhật
              </button>
            )}
            {feedConfigured && settings?.appFeedUrl && (
              <button
                className="btn btn-ghost mt-3 px-0"
                onClick={() => void window.desktop.app.writeClipboard(settings.appFeedUrl)}
              >
                <ExternalLink size={15} />
                Sao chép URL máy chủ
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
