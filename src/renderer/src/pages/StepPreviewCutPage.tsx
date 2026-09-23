import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileVideo, FolderOpen, ImagePlay, Scissors, Square } from 'lucide-react';
import type { QuickDownloadStatus } from '@shared/quick-download';
import type { LocalCutStatus } from '@shared/local-cut';
import { parseQuickDownloadTime } from '@shared/local-cut';
import { StepTabs } from '../components/StepTabs';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { safeUiText } from '../utils/ui-error';
import { useAppStore } from '../stores/app-store';

const TERMINAL_PHASES = new Set<LocalCutStatus['phase']>(['completed', 'cancelled', 'failed']);

function baseNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function directoryNameOf(path: string): string | null {
  const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return lastSlash > 0 ? path.slice(0, lastSlash) : null;
}

/** Bước ② Xem trước & Cắt — hành trình một video (điều hướng 3 bước, đặc tả GĐ 2a).
 * Tải nhanh (bước ①) chưa có lịch sử nhiều tệp qua IPC, nên trang này cho thấy TRUNG THỰC kết quả tải
 * gần nhất (nếu đã xong). Bộ cắt riêng, đơn giản (Giai đoạn 6 mục 2 — 2026-09-23) cắt một đoạn từ MỘT
 * VIDEO CÓ SẴN TRÊN MÁY (không qua tải) — nhập giờ bắt đầu/kết thúc, xem khung hình thật, chọn sao chép
 * nhanh hoặc cắt chính xác (mã hóa lại). Bộ cắt/chuẩn hóa NHIỀU tệp cùng lúc (Smart Merge) vẫn ở trang
 * Ghép theo Timeline — không lặp lại ở đây. */
export function StepPreviewCutPage(): React.JSX.Element {
  const setPage = useAppStore((state) => state.setPage);
  const [latest, setLatest] = useState<QuickDownloadStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('00:00:00');
  const [endTime, setEndTime] = useState('00:00:10');
  const [accurateCut, setAccurateCut] = useState(false);

  const [previewFrames, setPreviewFrames] = useState<{ start: string; end: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewInvalidationKey = `${sourceFile ?? ''}|${startTime}|${endTime}`;
  const previewInvalidationKeyRef = useRef(previewInvalidationKey);

  const [status, setStatus] = useState<LocalCutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.desktop.quickDownload
      .current()
      .then((current) => {
        if (mounted) setLatest(current);
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (previewInvalidationKeyRef.current === previewInvalidationKey) return;
    previewInvalidationKeyRef.current = previewInvalidationKey;
    setPreviewFrames(null);
    setPreviewError(null);
  }, [previewInvalidationKey]);

  useEffect(() => {
    if (!status || TERMINAL_PHASES.has(status.phase)) return;
    const timer = window.setInterval(() => {
      void window.desktop.localCut
        .status(status.taskId)
        .then((next) => {
          if (next) setStatus(next);
        })
        .catch((pollError) => {
          setError(safeUiText(pollError, 'Không đọc được tiến trình cắt.'));
        });
    }, 500);
    return () => window.clearInterval(timer);
  }, [status?.taskId, status?.phase]);

  const ready = latest?.phase === 'completed' && Boolean(latest.outputPath);
  const running = Boolean(status && !TERMINAL_PHASES.has(status.phase));

  function parsedSeconds(value: string): number | null {
    try {
      return parseQuickDownloadTime(value);
    } catch {
      return null;
    }
  }

  const startSeconds = parsedSeconds(startTime);
  const endSeconds = parsedSeconds(endTime);
  const rangeValid = startSeconds !== null && endSeconds !== null && endSeconds - startSeconds >= 1;

  async function chooseFile(): Promise<void> {
    try {
      const selected = await window.desktop.localCut.chooseFile();
      if (selected) {
        setSourceFile(selected);
        setOutputDirectory((current) => current ?? directoryNameOf(selected));
        setStatus(null);
        setError(null);
      }
    } catch (chooseError) {
      setError(safeUiText(chooseError, 'Không chọn được tệp.'));
    }
  }

  function useDownloadedFile(): void {
    if (!latest?.outputPath) return;
    setSourceFile(latest.outputPath);
    setOutputDirectory(latest.outputDirectory || null);
    setStatus(null);
    setError(null);
  }

  async function chooseOutputDirectory(): Promise<void> {
    try {
      const selected = await window.desktop.quickDownload.chooseDirectory(outputDirectory ?? undefined);
      if (selected) setOutputDirectory(selected);
    } catch (chooseError) {
      setError(safeUiText(chooseError, 'Không chọn được thư mục lưu.'));
    }
  }

  async function loadPreviewFrames(): Promise<void> {
    if (!sourceFile || startSeconds === null || endSeconds === null) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const [startFrame, endFrame] = await Promise.all([
        window.desktop.localCut.previewFrame({ filePath: sourceFile, timestampSeconds: startSeconds }),
        window.desktop.localCut.previewFrame({ filePath: sourceFile, timestampSeconds: endSeconds })
      ]);
      setPreviewFrames({ start: startFrame.dataUrl, end: endFrame.dataUrl });
    } catch (previewErr) {
      setPreviewError(
        safeUiText(previewErr, 'Không lấy được khung hình — mốc thời gian có thể vượt quá thời lượng thật của tệp.')
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function startCut(): Promise<void> {
    if (!sourceFile || !outputDirectory) return;
    setError(null);
    try {
      const next = await window.desktop.localCut.start({
        filePath: sourceFile,
        outputDirectory,
        startTime,
        endTime,
        accurateCut
      });
      setStatus(next);
    } catch (startError) {
      setError(safeUiText(startError, 'Không thể bắt đầu cắt.'));
    }
  }

  async function cancelCut(): Promise<void> {
    if (!status) return;
    try {
      const next = await window.desktop.localCut.cancel(status.taskId);
      if (next) setStatus(next);
    } catch (cancelError) {
      setError(safeUiText(cancelError, 'Không gửi được yêu cầu dừng.'));
    }
  }

  return <div className="page-shell step-preview-cut-page">
    <div className="tm-step-heading">
      <div>
        <h1>Xem trước & Cắt</h1>
        <p>Xem lại video vừa tải và cắt đoạn cần dùng trước khi ghép.</p>
      </div>
      <StepTabs current="step-preview-cut"/>
    </div>

    <Card icon={ImagePlay} title="Video vừa tải" subtitle="Kết quả gần nhất từ bước ① Tải">
      {!loaded ? null : ready && latest ? (
        <div className="step-preview-ready">
          <div>
            <b>{latest.title || 'Video đã tải'}</b>
            <small>{latest.outputPath}</small>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn" onClick={useDownloadedFile}>
              <Scissors size={15}/>
              Cắt đoạn này
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void window.desktop.quickDownload.revealOutput(latest.taskId)}
            >
              <FolderOpen size={15}/>
              Mở vị trí file
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={ImagePlay}
          title="Chưa có video nào tải xong"
          description="Sang bước ① Tải để tải một video, rồi quay lại đây để xem trước và cắt."
          action={<button type="button" className="btn btn-primary" onClick={() => setPage('step-download')}>Đi tới bước ① Tải</button>}
        />
      )}
    </Card>

    <Card icon={Scissors} title="Cắt tệp có sẵn trên máy" subtitle="Chọn một video đã có sẵn (không cần tải), cắt một đoạn và xuất ra tệp mới">
      {!sourceFile ? (
        <EmptyState
          icon={FileVideo}
          title="Chưa chọn video nào"
          description="Chọn một tệp video có sẵn trên máy để cắt một đoạn — không cần tải qua Tubmedia. Muốn cắt/chuẩn hóa nhiều tệp cùng lúc thì dùng Ghép theo Timeline."
          action={<button type="button" className="btn btn-primary" onClick={() => void chooseFile()}>Chọn tệp video</button>}
        />
      ) : (
        <>
          <div className="local-cut-file-row">
            <div>
              <b>{baseNameOf(sourceFile)}</b>
              <small title={sourceFile}>{sourceFile}</small>
            </div>
            <button type="button" className="btn btn-small" disabled={running} onClick={() => void chooseFile()}>
              Đổi tệp khác
            </button>
          </div>

          <div className="local-cut-range-row">
            <label className="local-cut-field">
              <span>Bắt đầu (giờ:phút:giây)</span>
              <input
                type="text"
                value={startTime}
                disabled={running}
                onChange={(event) => setStartTime(event.target.value)}
                placeholder="00:00:00"
              />
            </label>
            <label className="local-cut-field">
              <span>Kết thúc (giờ:phút:giây)</span>
              <input
                type="text"
                value={endTime}
                disabled={running}
                onChange={(event) => setEndTime(event.target.value)}
                placeholder="00:00:10"
              />
            </label>
          </div>

          <div className="local-cut-options">
            <label>
              <input
                type="checkbox"
                checked={accurateCut}
                disabled={running}
                onChange={(event) => setAccurateCut(event.target.checked)}
              />
              <span>
                <b>Cắt chính xác từng giây</b>
                <small>Mã hóa lại (chậm hơn). Bỏ tích: sao chép nhanh, giữ nguyên chất lượng, có thể lệch vài giây quanh điểm cắt gần nhất.</small>
              </span>
            </label>
            <button type="button" className="btn btn-small" disabled={!rangeValid || previewLoading} onClick={() => void loadPreviewFrames()}>
              {previewLoading ? 'Đang lấy khung hình…' : 'Xem khung hình'}
            </button>
          </div>

          {previewError && (
            <div className="quick-download-error" role="alert">
              <AlertTriangle size={15}/>
              {previewError}
            </div>
          )}
          {previewFrames && (
            <div className="local-cut-preview-frames">
              <figure>
                <img src={previewFrames.start} alt="Khung hình ở mốc bắt đầu"/>
                <figcaption>Bắt đầu · {startTime}</figcaption>
              </figure>
              <figure>
                <img src={previewFrames.end} alt="Khung hình ở mốc kết thúc"/>
                <figcaption>Kết thúc · {endTime}</figcaption>
              </figure>
            </div>
          )}

          <div className="local-cut-file-row" style={{ marginTop: '0.8rem' }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 800 }}>Lưu vào</span>
              <small>{outputDirectory ?? 'Chưa chọn thư mục lưu'}</small>
            </div>
            <button type="button" className="btn btn-small" disabled={running} onClick={() => void chooseOutputDirectory()}>
              Đổi thư mục lưu
            </button>
          </div>

          {error && (
            <div className="quick-download-error" role="alert">
              <AlertTriangle size={15}/>
              {error}
            </div>
          )}

          <div className="local-cut-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running || !rangeValid || !outputDirectory}
              onClick={() => void startCut()}
            >
              <Scissors size={15}/>
              Cắt đoạn này
            </button>
            {running && (
              <button type="button" className="btn" onClick={() => void cancelCut()}>
                <Square size={15}/>
                Dừng
              </button>
            )}
          </div>

          {status && (
            <div className="local-cut-progress">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span>{status.message}</span>
                <span>{Math.round(status.progress)}%</span>
              </div>
              <div className="progress">
                <span style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }}/>
              </div>
            </div>
          )}

          {status?.phase === 'completed' && status.outputPath && (
            <div className="local-cut-result">
              <div>
                <b>Đã cắt xong</b>
                <small title={status.outputPath}>{status.outputPath}</small>
              </div>
              <button type="button" className="btn" onClick={() => void window.desktop.localCut.revealOutput(status.taskId)}>
                <FolderOpen size={15}/>
                Mở vị trí file
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  </div>;
}
