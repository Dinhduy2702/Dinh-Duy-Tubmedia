import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { QuickDownloadMode, QuickDownloadQuality, QuickDownloadStatus } from '@shared/quick-download';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);

  return `${(value / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

const TERMINAL_PHASES = new Set(['completed', 'cancelled', 'failed']);

export function QuickDownloadPanel(): ReactElement {
  const [url, setUrl] = useState('');
  const [outputDirectory, setOutputDirectory] = useState('');
  const [quality, setQuality] = useState<QuickDownloadQuality>('best');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('13:00');
  const [accurateCut, setAccurateCut] = useState(false);
  const [status, setStatus] = useState<QuickDownloadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = Boolean(status && !TERMINAL_PHASES.has(status.phase));

  const progressText = useMemo(() => {
    if (!status) {
      return '';
    }

    const parts = [
      status.speed,
      status.eta ? `Còn ${status.eta}` : '',
      status.totalBytes > 0
        ? `${formatBytes(status.downloadedBytes)}/${formatBytes(status.totalBytes)}`
        : formatBytes(status.downloadedBytes)
    ].filter(Boolean);

    return parts.join(' • ');
  }, [status]);

  useEffect(() => {
    let mounted = true;

    void window.desktop.quickDownload
      .defaults()
      .then((defaults) => {
        if (mounted) {
          setOutputDirectory(defaults.outputDirectory);
        }
      })
      .catch((loadError) => {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Không đọc được thư mục mặc định.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!status || TERMINAL_PHASES.has(status.phase)) {
      return;
    }

    const timer = window.setInterval(() => {
      void window.desktop.quickDownload
        .status(status.taskId)
        .then((next) => {
          if (next) {
            setStatus(next);
          }
        })
        .catch((pollError) => {
          setError(pollError instanceof Error ? pollError.message : 'Không đọc được tiến trình tải.');
        });
    }, 500);

    return () => window.clearInterval(timer);
  }, [status?.taskId, status?.phase]);

  async function chooseDirectory(): Promise<void> {
    try {
      const selected = await window.desktop.quickDownload.chooseDirectory(outputDirectory);

      if (selected) {
        setOutputDirectory(selected);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : 'Không chọn được thư mục.');
    }
  }

  async function start(mode: QuickDownloadMode): Promise<void> {
    setError(null);

    try {
      const next = await window.desktop.quickDownload.start({
        url,
        outputDirectory,
        quality,
        mode,
        startTime,
        endTime,
        accurateCut
      });
      setStatus(next);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Không thể bắt đầu tải nhanh.');
    }
  }

  async function cancel(): Promise<void> {
    if (!status) {
      return;
    }

    try {
      const next = await window.desktop.quickDownload.cancel(status.taskId);

      if (next) {
        setStatus(next);
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Không thể hủy tải nhanh.');
    }
  }

  async function revealOutput(): Promise<void> {
    if (!status) {
      return;
    }

    const revealed = await window.desktop.quickDownload.revealOutput(status.taskId);

    if (!revealed) {
      setError('File đầu ra không còn tồn tại.');
    }
  }

  return (
    <section className="card quick-download-panel" data-testid="quick-download-panel">
      <div className="quick-download-heading">
        <div>
          <span className="quick-download-eyebrow">TẢI NHANH 1 VIDEO</span>
          <h2>Tải toàn bộ hoặc lấy riêng một đoạn</h2>
          <p>
            Dán một liên kết, chọn chất lượng rồi tải toàn bộ video hoặc nhập mốc thời gian như 10:00 → 13:00.
          </p>
        </div>

        <span className="quick-download-badge">Không tải playlist</span>
      </div>

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

      <div className="quick-download-row">
        <label className="quick-download-field folder">
          <span>Thư mục lưu</span>
          <div className="quick-download-folder-input">
            <input value={outputDirectory} readOnly title={outputDirectory} />
            <button type="button" disabled={running} onClick={() => void chooseDirectory()}>
              Chọn thư mục
            </button>
          </div>
        </label>

        <label className="quick-download-field quality">
          <span>Chất lượng</span>
          <select
            value={quality}
            disabled={running}
            onChange={(event) => setQuality(event.target.value as QuickDownloadQuality)}
          >
            <option value="best">Cao nhất</option>
            <option value="1080p">Tối đa 1080p</option>
            <option value="720p">Tối đa 720p</option>
            <option value="480p">Tối đa 480p</option>
          </select>
        </label>
      </div>

      <div className="quick-download-range-box">
        <div className="quick-download-range-head">
          <div>
            <strong>Tải video theo khoảng thời gian</strong>
            <small>Hỗ trợ MM:SS hoặc HH:MM:SS</small>
          </div>
          <span>Ví dụ: 10:00 → 13:00</span>
        </div>

        <div className="quick-download-range-inputs">
          <label className="quick-download-field">
            <span>Bắt đầu</span>
            <input
              value={startTime}
              disabled={running}
              onChange={(event) => setStartTime(event.target.value)}
              placeholder="10:00"
            />
          </label>

          <div className="quick-download-arrow">→</div>

          <label className="quick-download-field">
            <span>Kết thúc</span>
            <input
              value={endTime}
              disabled={running}
              onChange={(event) => setEndTime(event.target.value)}
              placeholder="13:00"
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
      </div>

      {error && <div className="quick-download-error">{error}</div>}

      {status && (
        <div className="quick-download-progress">
          <div className="quick-download-progress-head">
            <div>
              <strong>{status.title || status.message}</strong>
              {status.title && <small>{status.message}</small>}
            </div>
            <span>{Math.round(status.progress)}%</span>
          </div>

          <div className="quick-download-progress-track">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, status.progress))}%`
              }}
            />
          </div>

          {progressText && <div className="quick-download-progress-meta">{progressText}</div>}

          {status.outputPath && (
            <div className="quick-download-output" title={status.outputPath}>
              {status.outputPath}
            </div>
          )}

          {status.warnings.length > 0 && (
            <details className="quick-download-warnings">
              <summary>{status.warnings.length} cảnh báo</summary>
              <pre>{status.warnings.join('\n')}</pre>
            </details>
          )}
        </div>
      )}

      <div className="quick-download-actions">
        <button
          type="button"
          className="quick-download-button secondary"
          disabled={running || !url.trim() || !outputDirectory}
          onClick={() => void start('full')}
        >
          Tải nhanh toàn bộ
        </button>

        <button
          type="button"
          className="quick-download-button primary"
          disabled={running || !url.trim() || !outputDirectory || !startTime.trim() || !endTime.trim()}
          onClick={() => void start('range')}
        >
          Tải đoạn đã chọn
        </button>

        {running && (
          <button type="button" className="quick-download-button danger" onClick={() => void cancel()}>
            Hủy tải
          </button>
        )}

        {status?.phase === 'completed' && status.outputPath && (
          <button type="button" className="quick-download-button success" onClick={() => void revealOutput()}>
            Mở vị trí file
          </button>
        )}
      </div>

      <div className="quick-download-note">
        Chế độ nhanh có thể lệch nhẹ quanh điểm keyframe. Bật “Cắt chính xác” khi cần mốc sát hơn. File luôn
        có ID video và mã tác vụ để không bỏ qua nhầm hai video trùng tên.
      </div>
    </section>
  );
}
