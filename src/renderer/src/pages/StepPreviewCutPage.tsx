import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileVideo, FolderOpen, ImagePlay, Info, Scissors, Square } from 'lucide-react';
import type { QuickDownloadStatus } from '@shared/quick-download';
import type { MediaInfo } from '@shared/types/domain';
import type { LocalCutAspectRatio, LocalCutStatus } from '@shared/local-cut';
import { parseQuickDownloadTime } from '@shared/local-cut';
import { formatTimestamp } from '@shared/utils/timestamp';
import { formatBitrate, formatFileSize, formatFps, formatHdr, formatVideoCodec } from '@shared/utils/media-info-format';
import { StepTabs } from '../components/StepTabs';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { safeUiText } from '../utils/ui-error';
import { useAppStore } from '../stores/app-store';

const TERMINAL_PHASES = new Set<LocalCutStatus['phase']>(['completed', 'cancelled', 'failed']);

// Giai đoạn 6 mục 3 (2026-09-24): đổi tỉ lệ khung hình — nền mờ kiểu CapCut (đã hỏi và được chọn), luôn
// mã hóa lại nên "cắt chính xác" bị khóa (ẩn ý nghĩa) khi chọn một tỉ lệ khác 'original'.
// Mục 4 bước 2 (2026-09-24): đổi nhãn thành preset đặt tên theo nền tảng — khớp đúng ASPECT_RATIO_PRESETS
// ở DownloadMergePage.tsx (Ghép theo Timeline, bước 1) để nhất quán trong toàn app. Cơ chế bên dưới
// (LocalCutAspectRatio, bộ lọc nền mờ) hoàn toàn không đổi — chỉ đổi cách gọi tên hiển thị.
const ASPECT_RATIO_OPTIONS: Array<{ value: LocalCutAspectRatio; label: string }> = [
  { value: 'original', label: 'Giữ nguyên tỉ lệ nguồn' },
  { value: '9:16', label: 'Dọc 9:16 · Shorts/TikTok/Reels' },
  { value: '1:1', label: 'Vuông 1:1 · Instagram/Facebook' },
  { value: '16:9', label: 'Ngang 16:9 · YouTube/Facebook' }
];

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
 * nhanh hoặc cắt chính xác (mã hóa lại). Mục 3 (2026-09-24) thêm đổi tỉ lệ khung hình (9:16/1:1/16:9,
 * nền mờ kiểu CapCut) ngay trong cùng công cụ này — chọn tỉ lệ khác 'original' luôn buộc mã hóa lại nên
 * ô "cắt chính xác" bị khóa ở trạng thái bật kèm ghi chú. Mục 4 bước 2 (2026-09-24) đổi nhãn các lựa
 * chọn tỉ lệ thành preset có tên nền tảng (khớp nhãn ở Ghép theo Timeline, bước 1) — không xây UI mới,
 * không đổi cơ chế. Mục 6 (2026-09-24) thêm thẻ "Xem thông tin tệp" — chọn một tệp bất kỳ (không nhất
 * thiết liên quan tới cắt), hiển thị đầy đủ thông tin kỹ thuật qua MediaAnalyzer/ffprobe (đã có sẵn từ
 * trước, dùng nội bộ cho luồng ghép, giờ mới đưa ra giao diện lần đầu qua IPC media:analyze). Bộ cắt/
 * chuẩn hóa NHIỀU tệp cùng lúc (Smart Merge) vẫn ở trang Ghép theo Timeline — không lặp lại ở đây. */
export function StepPreviewCutPage(): React.JSX.Element {
  const setPage = useAppStore((state) => state.setPage);
  const [latest, setLatest] = useState<QuickDownloadStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('00:00:00');
  const [endTime, setEndTime] = useState('00:00:10');
  const [accurateCut, setAccurateCut] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<LocalCutAspectRatio>('original');

  const [infoFile, setInfoFile] = useState<string | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [previewFrames, setPreviewFrames] = useState<{ start: string; end: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewInvalidationKey = `${sourceFile ?? ''}|${startTime}|${endTime}|${aspectRatio}`;
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

  // Giai đoạn 6 mục 6 (2026-09-24) — "Xem thông tin tệp": dùng lại đúng hộp thoại chọn tệp của "Cắt tệp
  // có sẵn" (localCut.chooseFile) nhưng KHÔNG liên quan tới việc cắt — chỉ để xem thông tin. Tự động phân
  // tích ngay sau khi chọn tệp, không cần thêm một cú bấm nữa.
  async function chooseInfoFile(): Promise<void> {
    try {
      const selected = await window.desktop.localCut.chooseFile();
      if (!selected) return;
      setInfoFile(selected);
      setInfo(null);
      setInfoError(null);
      setInfoLoading(true);
      try {
        const result = await window.desktop.media.analyze(selected);
        setInfo(result);
      } catch (analyzeError) {
        setInfoError(safeUiText(analyzeError, 'Không đọc được thông tin tệp.'));
      } finally {
        setInfoLoading(false);
      }
    } catch (chooseError) {
      setInfoError(safeUiText(chooseError, 'Không chọn được tệp.'));
    }
  }

  async function loadPreviewFrames(): Promise<void> {
    if (!sourceFile || startSeconds === null || endSeconds === null) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const [startFrame, endFrame] = await Promise.all([
        window.desktop.localCut.previewFrame({ filePath: sourceFile, timestampSeconds: startSeconds, aspectRatio }),
        window.desktop.localCut.previewFrame({ filePath: sourceFile, timestampSeconds: endSeconds, aspectRatio })
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
        accurateCut,
        aspectRatio
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

          <div className="local-cut-aspect-row" role="radiogroup" aria-label="Preset xuất theo nền tảng">
            <span className="local-cut-aspect-row-label">Preset xuất theo nền tảng</span>
            <div className="local-cut-aspect-buttons">
              {ASPECT_RATIO_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={aspectRatio === option.value}
                  className={`btn btn-small${aspectRatio === option.value ? ' btn-primary' : ''}`}
                  disabled={running}
                  onClick={() => setAspectRatio(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {aspectRatio !== 'original' && (
              <small className="local-cut-aspect-note">
                Nền mờ phóng to từ chính video, video gốc giữ nguyên tỉ lệ ở giữa (kiểu CapCut) — không cắt mất khung hình, không viền đen.
              </small>
            )}
          </div>

          <div className="local-cut-options">
            <label>
              <input
                type="checkbox"
                checked={aspectRatio !== 'original' || accurateCut}
                disabled={running || aspectRatio !== 'original'}
                onChange={(event) => setAccurateCut(event.target.checked)}
              />
              <span>
                <b>Cắt chính xác từng giây</b>
                <small>
                  {aspectRatio !== 'original'
                    ? 'Đổi tỉ lệ khung hình luôn mã hóa lại — không thể sao chép nhanh.'
                    : 'Mã hóa lại (chậm hơn). Bỏ tích: sao chép nhanh, giữ nguyên chất lượng, có thể lệch vài giây quanh điểm cắt gần nhất.'}
                </small>
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

    <Card icon={Info} title="Xem thông tin tệp" subtitle="Chọn một video bất kỳ để xem đầy đủ thông tin kỹ thuật (độ phân giải, codec, bitrate, dung lượng...)">
      <div className="local-cut-file-row">
        <div>
          {infoFile ? (
            <>
              <b>{baseNameOf(infoFile)}</b>
              <small title={infoFile}>{infoFile}</small>
            </>
          ) : (
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Chưa chọn tệp nào</span>
          )}
        </div>
        <button type="button" className="btn btn-small" disabled={infoLoading} onClick={() => void chooseInfoFile()}>
          {infoFile ? 'Đổi tệp khác' : 'Chọn tệp'}
        </button>
      </div>

      {infoLoading && (
        <p style={{ marginTop: '0.8rem', color: 'var(--muted)', fontSize: '0.8rem' }}>Đang đọc thông tin tệp…</p>
      )}

      {infoError && (
        <div className="quick-download-error" role="alert" style={{ marginTop: '0.8rem' }}>
          <AlertTriangle size={15}/>
          {infoError}
        </div>
      )}

      {info && !infoLoading && (
        <dl className="local-cut-info-grid">
          <div><dt>Độ phân giải</dt><dd>{info.width} × {info.height}{info.displayAspectRatio ? ` (${info.displayAspectRatio})` : ''}</dd></div>
          <div><dt>Thời lượng</dt><dd>{formatTimestamp(info.duration)}</dd></div>
          <div><dt>Khung hình/giây</dt><dd>{formatFps(info)}</dd></div>
          <div><dt>Codec hình</dt><dd>{formatVideoCodec(info)}</dd></div>
          <div><dt>Bitrate hình</dt><dd>{formatBitrate(info.videoBitrate)}</dd></div>
          <div><dt>Độ sâu màu</dt><dd>{info.bitDepth ? `${info.bitDepth}-bit` : 'Không rõ'}</dd></div>
          <div><dt>Định dạng điểm ảnh</dt><dd>{info.pixelFormat}</dd></div>
          <div><dt>HDR</dt><dd>{formatHdr(info)}</dd></div>
          <div><dt>Codec âm thanh</dt><dd>{info.audioCodec ? info.audioCodec.toUpperCase() : 'Không có âm thanh'}</dd></div>
          {info.audioCodec && (
            <>
              <div><dt>Bitrate âm thanh</dt><dd>{formatBitrate(info.audioBitrate)}</dd></div>
              <div><dt>Kênh âm thanh</dt><dd>{info.channels ? `${info.channels} kênh${info.channelLayout ? ` (${info.channelLayout})` : ''}` : 'Không rõ'}</dd></div>
              <div><dt>Tần số lấy mẫu</dt><dd>{info.sampleRate ? `${info.sampleRate} Hz` : 'Không rõ'}</dd></div>
            </>
          )}
          <div><dt>Định dạng tệp</dt><dd>{info.formatName ?? 'Không rõ'}</dd></div>
          <div><dt>Dung lượng tệp</dt><dd>{formatFileSize(info.fileSize)}</dd></div>
        </dl>
      )}
    </Card>
  </div>;
}
