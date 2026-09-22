import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  Copy,
  Cookie,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Wrench
} from 'lucide-react';
import type {
  QuickDownloadMediaMode,
  QuickDownloadQuality,
  QuickDownloadStatus
} from '@shared/quick-download';
import { CookieManagerDialog } from './CookieManagerDialog';
import { UnifiedDownloadProgress } from './UnifiedDownloadProgress';
import { Card } from './ui/Card';
import { InfoDisclosure } from './InfoDisclosure';
import { safeUiText } from '../utils/ui-error';
import { useAppStore } from '../stores/app-store';
import { showNotice } from '../utils/notify';
import { ImagePlay, Link2, Save, Scissors, Settings2 } from 'lucide-react';

/** "hh:mm:ss" → giây; null nếu không đúng khuôn dạng — dùng để ước tính độ dài đoạn đã chọn. */
function parseDurationToSeconds(value: string): number | null {
  const match = /^(\d{2,4}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function formatSecondsShort(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h} giờ ${m} phút` : m > 0 ? `${m} phút ${sec} giây` : `${sec} giây`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

function readableError(value: unknown, fallback: string): string {
  return safeUiText(value, fallback);
}

function quickPhaseLabel(phase: QuickDownloadStatus['phase']): string {
  const labels: Record<QuickDownloadStatus['phase'], string> = {
    queued: 'Đang xếp hàng',
    preparing: 'Đang chuẩn bị',
    downloading: 'Đang tải video',
    processing: 'Đang xử lý tệp',
    verifying: 'Đang kiểm tra tệp',
    pausing: 'Đang tạm dừng',
    paused: 'Đã tạm dừng',
    resuming: 'Đang tiếp tục',
    completed: 'Đã hoàn tất',
    cancelling: 'Đang hủy',
    cancelled: 'Đã hủy',
    failed: 'Tải chưa thành công',
    interrupted: 'Tác vụ bị gián đoạn',
    skipped: 'Bỏ qua'
  };
  return labels[phase];
}

const TERMINAL_PHASES = new Set<QuickDownloadStatus['phase']>([
  'completed',
  'cancelled',
  'failed',
  'skipped',
  'interrupted'
]);

const COOKIE_BLOCKING_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED'
]);

const UNSUPPORTED_LINK_CODE = 'UNSUPPORTED_URL';
const OUTPUT_PATH_CODE = 'OUTPUT_PATH_INVALID';

/* TUBMEDIA AUDIO MODE UI R30 */
function quickMediaNoun(mediaMode: QuickDownloadMediaMode): string {
  return mediaMode === 'audio-only' ? 'tệp âm thanh' : 'video';
}

export function QuickDownloadPanel(): ReactElement {
  const [url, setUrl] = useState('');
  const [outputDirectory, setOutputDirectory] = useState('');
  const [quality, setQuality] = useState<QuickDownloadQuality>('best');
  const [mediaMode, setMediaMode] = useState<QuickDownloadMediaMode>('video-audio');
  const [downloadSubtitles, setDownloadSubtitles] = useState(false);
  const [subtitleLanguage, setSubtitleLanguage] = useState('vi,en');
  const [downloadThumbnail, setDownloadThumbnail] = useState(false);
  const [writeMetadata, setWriteMetadata] = useState(false);
  const [useTimeline, setUseTimeline] = useState(() => {
    try {
      return window.localStorage.getItem('tubmedia.quick-download.use-timeline') === 'true';
    } catch {
      return false;
    }
  });
  const [startTime, setStartTime] = useState(() => {
    try {
      const stored = window.localStorage.getItem('tubmedia.quick-download.start-duration');
      return stored && /^\d{2,4}:[0-5]\d:[0-5]\d$/.test(stored) ? stored : '00:10:00';
    } catch {
      return '00:10:00';
    }
  });
  const [endTime, setEndTime] = useState(() => {
    try {
      const stored = window.localStorage.getItem('tubmedia.quick-download.end-duration');
      return stored && /^\d{2,4}:[0-5]\d:[0-5]\d$/.test(stored) ? stored : '00:13:00';
    } catch {
      return '00:13:00';
    }
  });
  const [accurateCut, setAccurateCut] = useState(false);
  // Giai đoạn 3 (2026-09-23): xem trước khung hình đầu/cuối đoạn — làm mới lại (xóa ảnh cũ) mỗi khi liên
  // kết hoặc mốc thời gian đổi, để không hiện nhầm ảnh của lần trước.
  const [previewFrames, setPreviewFrames] = useState<{ start: string; end: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewInvalidationKey = `${url.trim()}|${startTime}|${endTime}`;
  const previewInvalidationKeyRef = useRef(previewInvalidationKey);
  const [status, setStatus] = useState<QuickDownloadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cookieOpen, setCookieOpen] = useState(false);
  const openedCookieTask = useRef<string | null>(null);
  const setPage = useAppStore((state) => state.setPage);

  useEffect(() => {
    try {
      window.localStorage.setItem('tubmedia.quick-download.use-timeline', String(useTimeline));
    } catch {
      // Renderer storage can be unavailable in hardened test environments.
    }
  }, [useTimeline]);

  useEffect(() => {
    if (!/^\d{2,4}:[0-5]\d:[0-5]\d$/.test(startTime)) return;
    try {
      window.localStorage.setItem('tubmedia.quick-download.start-duration', startTime);
    } catch {
      // Renderer storage can be unavailable in hardened test environments.
    }
  }, [startTime]);

  useEffect(() => {
    if (!/^\d{2,4}:[0-5]\d:[0-5]\d$/.test(endTime)) return;
    try {
      window.localStorage.setItem('tubmedia.quick-download.end-duration', endTime);
    } catch {
      // Renderer storage can be unavailable in hardened test environments.
    }
  }, [endTime]);

  const running = Boolean(status && !TERMINAL_PHASES.has(status.phase));
  const paused = status?.phase === 'paused';
  const pausable = Boolean(
    status && ['preparing', 'downloading', 'processing', 'verifying'].includes(status.phase)
  );
  const canStart = Boolean(
    !running && url.trim() && outputDirectory && (!useTimeline || (startTime.trim() && endTime.trim()))
  );

  const cookieBlocked = Boolean(status?.errorCode && COOKIE_BLOCKING_CODES.has(status.errorCode));
  const unsupportedLink = status?.errorCode === UNSUPPORTED_LINK_CODE;
  const outputPathBlocked = status?.errorCode === OUTPUT_PATH_CODE;

  const displayStatusMessage = status ? safeUiText(status.message, quickPhaseLabel(status.phase)) : '';
  const displayWarnings =
    status?.warnings.map((warning) => safeUiText(warning, 'Có một cảnh báo cần kiểm tra.')) ?? [];

  const progressText = useMemo(() => {
    if (!status) return '';
    return [
      status.speed,
      status.eta ? `Còn ${status.eta}` : '',
      status.totalBytes > 0
        ? `${formatBytes(status.downloadedBytes)}/${formatBytes(status.totalBytes)}`
        : formatBytes(status.downloadedBytes)
    ]
      .filter(Boolean)
      .join(' • ');
  }, [status]);

  const rangeDurationSeconds = useMemo(() => {
    const start = parseDurationToSeconds(startTime);
    const end = parseDurationToSeconds(endTime);
    if (start === null || end === null || end <= start) return null;
    return end - start;
  }, [startTime, endTime]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([window.desktop.quickDownload.defaults(), window.desktop.quickDownload.current()])
      .then(([defaults, current]) => {
        if (!mounted) return;
        setOutputDirectory(defaults.outputDirectory);
        if (current) setStatus(current);
      })
      .catch((loadError) => {
        if (mounted) setError(readableError(loadError, 'Không đọc được trạng thái Tải nhanh.'));
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!status || TERMINAL_PHASES.has(status.phase)) return;
    const timer = window.setInterval(() => {
      void window.desktop.quickDownload
        .status(status.taskId)
        .then((next) => {
          if (next) setStatus(next);
        })
        .catch((pollError) => {
          setError(readableError(pollError, 'Không đọc được tiến trình tải.'));
        });
    }, 500);
    return () => window.clearInterval(timer);
  }, [status?.taskId, status?.phase]);

  useEffect(() => {
    if (previewInvalidationKeyRef.current === previewInvalidationKey) return;
    previewInvalidationKeyRef.current = previewInvalidationKey;
    setPreviewFrames(null);
    setPreviewError(null);
  }, [previewInvalidationKey]);

  useEffect(() => {
    if (!cookieBlocked || !status || openedCookieTask.current === status.taskId) return;
    openedCookieTask.current = status.taskId;
    setCookieOpen(true);
  }, [cookieBlocked, status]);

  async function resumeAfterCookies(): Promise<void> {
    const current = await window.desktop.quickDownload.current();
    if (current) setStatus(current);
    setError(null);
  }

  async function copyCurrentLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url.trim());
      setError(null);
    } catch {
      showNotice('warning', 'Chưa sao chép được liên kết', 'Hãy chọn và sao chép trực tiếp trong ô liên kết.');
    }
  }

  function openCurrentLink(): void {
    const target = url.trim();
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  /** Giai đoạn 3 (2026-09-23): lấy 2 khung hình thật (mốc bắt đầu + kết thúc) qua yt-dlp + ffmpeg. */
  async function loadPreviewFrames(): Promise<void> {
    const startSeconds = parseDurationToSeconds(startTime);
    const endSeconds = parseDurationToSeconds(endTime);
    const trimmedUrl = url.trim();
    if (startSeconds === null || endSeconds === null || !trimmedUrl) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const [startFrame, endFrame] = await Promise.all([
        window.desktop.quickDownload.previewFrame({ url: trimmedUrl, timestampSeconds: startSeconds }),
        window.desktop.quickDownload.previewFrame({ url: trimmedUrl, timestampSeconds: endSeconds })
      ]);
      setPreviewFrames({ start: startFrame.dataUrl, end: endFrame.dataUrl });
    } catch (previewErr) {
      setPreviewError(
        readableError(
          previewErr,
          'Không lấy được khung hình xem trước. Nguồn có thể chặn, mốc thời gian vượt quá thời lượng video, hoặc cần Cookies.'
        )
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function chooseDirectory(): Promise<void> {
    try {
      const selected = await window.desktop.quickDownload.chooseDirectory(outputDirectory);
      if (selected) setOutputDirectory(selected);
    } catch (chooseError) {
      setError(readableError(chooseError, 'Không chọn được thư mục.'));
    }
  }

  async function start(): Promise<void> {
    setError(null);
    try {
      const next = await window.desktop.quickDownload.start({
        url,
        outputDirectory,
        quality,
        mediaMode,
        mode: useTimeline ? 'range' : 'full',
        ...(useTimeline ? { startTime, endTime } : {}),
        accurateCut: useTimeline && accurateCut,
        downloadSubtitles,
        subtitleLanguage,
        downloadThumbnail,
        writeMetadata
      });
      setStatus(next);
    } catch (startError) {
      setError(readableError(startError, 'Không thể bắt đầu tải nhanh.'));
    }
  }

  async function pause(): Promise<void> {
    if (!status) return;
    try {
      const next = await window.desktop.quickDownload.pause(status.taskId);
      if (next) setStatus(next);
    } catch (pauseError) {
      setError(readableError(pauseError, 'Không thể tạm dừng Tải nhanh.'));
    }
  }

  async function resume(): Promise<void> {
    if (!status) return;
    try {
      const next = await window.desktop.quickDownload.resume(status.taskId);
      if (next) setStatus(next);
    } catch (resumeError) {
      setError(readableError(resumeError, 'Không thể tiếp tục Tải nhanh.'));
    }
  }

  async function cancel(): Promise<void> {
    if (!status) return;
    try {
      const next = await window.desktop.quickDownload.cancel(status.taskId);
      if (next) setStatus(next);
    } catch (cancelError) {
      setError(readableError(cancelError, 'Không thể hủy tải nhanh.'));
    }
  }

  async function revealOutput(): Promise<void> {
    if (!status) return;
    const revealed = await window.desktop.quickDownload.revealOutput(status.taskId);
    if (!revealed) {
      showNotice('warning', 'Không thấy tệp đầu ra', 'Tệp có thể đã bị di chuyển hoặc xóa. Hãy mở thư mục lưu để kiểm tra.');
    }
  }

  return (
    <>
      <div className="quick-download-studio" data-testid="quick-download-panel">
        <div className="tm-card-grid quick-download-grid">
          <Card icon={Link2} title="Liên kết video" subtitle="Dán liên kết, không tải nguyên playlist" className="quick-download-card-link">
            <label className="quick-download-field full">
              <span>Liên kết video</span>
              <input
                value={url}
                disabled={running}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="quick-download-heading-actions">
              <button
                type="button"
                className="quick-download-cookie-button"
                disabled={running}
                onClick={() => setCookieOpen(true)}
              >
                <Cookie size={15} />
                Cookies
              </button>
              <span className="quick-download-badge">Không tải playlist</span>
            </div>
          </Card>

          <Card icon={Scissors} title="Chọn đoạn cần tải" subtitle="Bỏ trống để tải toàn bộ video" className="quick-download-card-range">
            <label className={`quick-download-timeline-toggle ${useTimeline ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={useTimeline}
                disabled={running}
                onChange={(event) => setUseTimeline(event.target.checked)}
              />
              <span>
                <strong>Tải video theo mốc thời lượng</strong>
                <small>Chỉ hiện Timeline và cắt đoạn khi bạn bật lựa chọn này.</small>
              </span>
              <b>{useTimeline ? 'Đang bật' : 'Đang tắt'}</b>
            </label>

            {useTimeline && (
              <div className="quick-download-range-box" data-testid="quick-download-timeline-editor">
                <div className="quick-download-range-head">
                  <div>
                    <strong>Thiết lập Timeline</strong>
                    <small>Nhập HH:MM:SS. Hai mốc được tự động lưu khi thêm link và khi mở lại ứng dụng</small>
                  </div>
                  <span>Ví dụ: 25:10:30 → 25:15:30</span>
                </div>
                <div className="quick-download-range-inputs">
                  <label className="quick-download-field">
                    <span>Bắt đầu</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9:]*"
                      maxLength={10}
                      value={startTime}
                      disabled={running}
                      placeholder="00:10:00"
                      title="Mốc thời lượng bắt đầu theo định dạng Giờ:Phút:Giây"
                      aria-label="Mốc thời lượng bắt đầu"
                      className="video-duration-input"
                      onChange={(event) => setStartTime(event.target.value.replace(/[^0-9:]/g, ''))}
                    />
                  </label>
                  <div className="quick-download-arrow">→</div>
                  <label className="quick-download-field">
                    <span>Kết thúc</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9:]*"
                      maxLength={10}
                      value={endTime}
                      disabled={running}
                      placeholder="00:13:00"
                      title="Mốc thời lượng kết thúc theo định dạng Giờ:Phút:Giây"
                      aria-label="Mốc thời lượng kết thúc"
                      className="video-duration-input"
                      onChange={(event) => setEndTime(event.target.value.replace(/[^0-9:]/g, ''))}
                    />
                  </label>
                  <label className="quick-download-accurate">
                    <input
                      type="checkbox"
                      checked={accurateCut}
                      disabled={running}
                      onChange={(event) => setAccurateCut(event.target.checked)}
                    />
                    <span>
                      <strong>Cắt chính xác</strong>
                      <small>Sát điểm cắt hơn nhưng chậm hơn</small>
                    </span>
                  </label>
                </div>
                <p className="quick-download-range-estimate">
                  {rangeDurationSeconds !== null
                    ? `Độ dài đoạn đã chọn: khoảng ${formatSecondsShort(rangeDurationSeconds)}. Dung lượng ước tính chỉ biết được sau khi Tubmedia đọc thông tin nguồn.`
                    : 'Nhập đúng mốc bắt đầu/kết thúc (Giờ:Phút:Giây, kết thúc sau bắt đầu) để xem độ dài đoạn.'}
                </p>
              </div>
            )}
          </Card>

          <Card icon={ImagePlay} title="Xem trước" subtitle="Khung hình đầu và cuối đoạn đã chọn" className="quick-download-card-preview">
            {!useTimeline ? (
              <div className="tm-empty quick-download-preview-empty">
                <span className="tm-empty-icon" aria-hidden="true"><ImagePlay size={22}/></span>
                <p>Chỉ áp dụng khi bật "Tải video theo mốc thời lượng" ở thẻ bên cạnh.</p>
              </div>
            ) : (
              <div className="quick-download-preview-body">
                <div className="quick-download-preview-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={!url.trim() || rangeDurationSeconds === null || previewLoading}
                    onClick={() => void loadPreviewFrames()}
                  >
                    {previewLoading ? 'Đang lấy khung hình…' : 'Xem khung hình'}
                  </button>
                  <small>Tải một đoạn rất ngắn thật (không âm thanh) quanh mỗi mốc để lấy khung hình — không lưu lại trên máy.</small>
                </div>
                {previewError && (
                  <div className="quick-download-error" role="alert">
                    <AlertTriangle size={15}/>
                    {previewError}
                  </div>
                )}
                {previewFrames && (
                  <div className="quick-download-preview-frames">
                    <figure>
                      <img src={previewFrames.start} alt="Khung hình ở mốc bắt đầu" />
                      <figcaption>Bắt đầu · {startTime}</figcaption>
                    </figure>
                    <figure>
                      <img src={previewFrames.end} alt="Khung hình ở mốc kết thúc" />
                      <figcaption>Kết thúc · {endTime}</figcaption>
                    </figure>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card icon={Save} title="Lưu và tải" subtitle="Chọn nơi lưu rồi bắt đầu" className="quick-download-card-save">
            <label className="quick-download-field folder">
              <span>Thư mục lưu</span>
              <div className="quick-download-folder-input">
                <input value={outputDirectory} readOnly title={outputDirectory} />
                <button type="button" disabled={running} onClick={() => void chooseDirectory()}>
                  Chọn thư mục
                </button>
              </div>
            </label>

            <InfoDisclosure title="Nâng cao" summary="Loại nội dung, chất lượng, phụ đề, thumbnail, metadata" icon={Settings2}>
              <div className="quick-download-row quick-download-mode-row">
                <label className="quick-download-field quality">
                  <span>Nội dung tải</span>
                  <select
                    value={mediaMode}
                    disabled={running}
                    onChange={(event) => setMediaMode(event.target.value as QuickDownloadMediaMode)}
                  >
                    <option value="video-audio">Video + âm thanh</option>
                    <option value="audio-only">Chỉ âm thanh M4A</option>
                    <option value="video-only">Chỉ video, không âm thanh</option>
                  </select>
                </label>
                <label className="quick-download-field quality">
                  <span>Chất lượng video</span>
                  <select
                    value={quality}
                    disabled={running || mediaMode === 'audio-only'}
                    onChange={(event) => setQuality(event.target.value as QuickDownloadQuality)}
                  >
                    <option value="best">Cao nhất nguồn</option>
                    <option value="1080p">Tối đa 1080p</option>
                    <option value="720p">Tối đa 720p</option>
                    <option value="480p">Tối đa 480p</option>
                  </select>
                </label>
              </div>

              <div className="quick-download-sidecars">
                <label>
                  <input
                    type="checkbox"
                    checked={downloadSubtitles}
                    disabled={running}
                    onChange={(event) => setDownloadSubtitles(event.target.checked)}
                  />
                  <span>
                    <b>Phụ đề SRT</b>
                    <small>Phụ đề chính thức và tự động</small>
                  </span>
                </label>
                <label className="quick-download-sub-language">
                  <span>Ngôn ngữ</span>
                  <input
                    value={subtitleLanguage}
                    disabled={running || !downloadSubtitles}
                    onChange={(event) => setSubtitleLanguage(event.target.value)}
                    placeholder="vi,en"
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={downloadThumbnail}
                    disabled={running}
                    onChange={(event) => setDownloadThumbnail(event.target.checked)}
                  />
                  <span>
                    <b>Thumbnail JPG</b>
                    <small>Ảnh đại diện cạnh video</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={writeMetadata}
                    disabled={running}
                    onChange={(event) => setWriteMetadata(event.target.checked)}
                  />
                  <span>
                    <b>Metadata</b>
                    <small>Info JSON và mô tả</small>
                  </span>
                </label>
              </div>
            </InfoDisclosure>

            {!status && (
              <button
                type="button"
                className="btn btn-primary tm-btn-lg quick-download-start-lg"
                disabled={!canStart}
                onClick={() => void start()}
              >
                <Play size={17} />
                {useTimeline ? 'Tải đoạn này' : mediaMode === 'audio-only' ? 'Tải toàn bộ âm thanh' : 'Tải toàn bộ video'}
              </button>
            )}
          </Card>
        </div>

        {cookieBlocked && status && (
          <div className="quick-download-cookie-block" role="alert">
            <ShieldAlert size={20} />
            <div>
              <strong>
                {status.errorCode === 'COOKIES_EXPIRED'
                  ? 'Cookies cần được cập nhật'
                  : status.errorCode === 'BROWSER_COOKIE_DATABASE_LOCKED'
                    ? 'Trình duyệt đang khóa cookies'
                    : 'Video cần đăng nhập hoặc cookies'}
              </strong>
              <p>{displayStatusMessage}</p>
            </div>
            <button type="button" onClick={() => setCookieOpen(true)}>
              <Cookie size={15} />
              Mở 3 cách thêm cookies
            </button>
          </div>
        )}

        {unsupportedLink && status && (
          <div className="quick-download-recovery-block is-unsupported" role="alert">
            <AlertTriangle size={21} />
            <div className="quick-download-recovery-copy">
              <strong>Liên kết chưa được nền tảng tải hỗ trợ</strong>
              <p>{displayStatusMessage}</p>
              <small>
                Tubmedia đã thử bộ trích xuất chuyên dụng và chế độ liên kết trực tiếp/chung. Bạn có thể cập
                nhật yt-dlp, mở trang gốc hoặc sao chép liên kết để kiểm tra lại.
              </small>
            </div>
            <div className="quick-download-recovery-actions">
              <button type="button" className="primary" onClick={() => void start()}>
                <RotateCcw size={15} />
                Thử lại
              </button>
              <button type="button" onClick={() => setPage('tools')}>
                <Wrench size={15} />
                Cập nhật yt-dlp
              </button>
              <button type="button" onClick={openCurrentLink}>
                <ExternalLink size={15} />
                Mở liên kết
              </button>
              <button type="button" onClick={() => void copyCurrentLink()}>
                <Copy size={15} />
                Sao chép link
              </button>
            </div>
          </div>
        )}
        {outputPathBlocked && status && (
          <div className="quick-download-recovery-block is-path" role="alert">
            <AlertTriangle size={21} />
            <div className="quick-download-recovery-copy">
              <strong>Không thể tạo tệp trong đường dẫn đã chọn</strong>
              <p>{displayStatusMessage}</p>
              <small>
                Tubmedia đã tự thử lại bằng tên tệp ngắn. Hãy chọn thư mục có đường dẫn ngắn hơn, còn dung
                lượng và có quyền ghi rồi thử lại.
              </small>
            </div>
            <div className="quick-download-recovery-actions">
              <button type="button" className="primary" onClick={() => void chooseDirectory()}>
                Chọn thư mục khác
              </button>
              <button type="button" onClick={() => void start()}>
                <RotateCcw size={15} />
                Thử lại
              </button>
            </div>
          </div>
        )}
        {error && <div className="quick-download-error">{error}</div>}

        {status ? (
          <UnifiedDownloadProgress
            className="quick-download-unified-progress"
            title={status.title || `Tải nhanh 1 ${quickMediaNoun(status.mediaMode)}`}
            subtitle={displayStatusMessage}
            status={
              status.phase === 'queued'
                ? 'pending'
                : status.phase === 'preparing'
                  ? 'analyzing'
                  : status.phase === 'pausing'
                    ? 'paused'
                    : status.phase === 'resuming'
                      ? 'downloading'
                      : status.phase === 'cancelling'
                        ? 'cancelled'
                        : status.phase
            }
            progress={status.progress}
            completed={status.phase === 'completed' ? 1 : 0}
            total={1}
            detail={progressText || (paused ? 'Đang tạm dừng' : displayStatusMessage)}
            secondary={
              displayWarnings.length > 0
                ? `${displayWarnings.length} cảnh báo cần xem`
                : useTimeline
                  ? `${startTime} → ${endTime}`
                  : mediaMode === 'audio-only'
                    ? 'Chỉ âm thanh M4A'
                    : mediaMode === 'video-only'
                      ? 'Chỉ video'
                      : 'Video + âm thanh'
            }
            outputPath={status.outputPath}
            actions={
              <>
                {!running && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canStart}
                    onClick={() => void start()}
                  >
                    <Play size={15} />
                    {useTimeline
                      ? 'Tải đoạn theo Timeline'
                      : mediaMode === 'audio-only'
                        ? 'Tải âm thanh mới'
                        : 'Tải video mới'}
                  </button>
                )}
                {pausable && (
                  <button type="button" className="btn" onClick={() => void pause()}>
                    <Pause size={15} />
                    Tạm dừng
                  </button>
                )}
                {paused && (
                  <button type="button" className="btn btn-primary" onClick={() => void resume()}>
                    <Play size={15} />
                    Tiếp tục
                  </button>
                )}
                {running && (
                  <button type="button" className="btn btn-danger" onClick={() => void cancel()}>
                    <Square size={15} />
                    Hủy tải
                  </button>
                )}
                {status.phase === 'completed' && status.outputPath && (
                  <button type="button" className="btn" onClick={() => void revealOutput()}>
                    <ExternalLink size={15} />
                    Mở vị trí file
                  </button>
                )}
              </>
            }
          />
        ) : null}

        {displayWarnings.length ? (
          <details className="quick-download-warnings quick-download-unified-warnings">
            <summary>{displayWarnings.length} cảnh báo</summary>
            <ul>
              {displayWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="quick-download-note">
          {useTimeline
            ? 'Timeline đang bật: Tubmedia chỉ tải đoạn đã chọn. Cắt nhanh có thể lệch nhẹ quanh keyframe; bật Cắt chính xác khi cần mốc sát hơn.'
            : mediaMode === 'audio-only'
              ? 'Timeline đang tắt: Tubmedia tải toàn bộ tệp âm thanh. Tên file vẫn có ID nguồn và mã tác vụ để tránh ghi đè.'
              : 'Timeline đang tắt: Tubmedia tải toàn bộ video. File luôn có Video ID và mã tác vụ để không bỏ qua nhầm video trùng tên.'}
        </div>
      </div>
      <CookieManagerDialog
        open={cookieOpen}
        onClose={() => setCookieOpen(false)}
        onConfigured={resumeAfterCookies}
      />
    </>
  );
}
