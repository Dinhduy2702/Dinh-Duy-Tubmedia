import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileDown,
  FileJson,
  Filter,
  FolderInput,
  LoaderCircle,
  MoveRight,
  SearchCheck,
  ShieldCheck,
  TriangleAlert
} from 'lucide-react';
import type { VideoLinkFilterRequest, VideoLinkFilterResult } from '@shared/video-link-filter';
import { FolderField } from '../components/FolderField';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppStore } from '../stores/app-store';

type RunMode = VideoLinkFilterRequest['mode'];

function requestKey(input: Omit<VideoLinkFilterRequest, 'mode'>): string {
  return JSON.stringify(input);
}

export function VideoLinkFilterPage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const [sourceFolder, setSourceFolder] = useState(settings?.defaultSourceFolder ?? '');
  const [destinationFolder, setDestinationFolder] = useState(settings?.defaultOutputFolder ?? '');
  const [linksText, setLinksText] = useState('');
  const [linksFile, setLinksFile] = useState('');
  const [flatten, setFlatten] = useState(false);
  const [titleMatch, setTitleMatch] = useState(true);
  const [useYtDlp, setUseYtDlp] = useState(true);
  const [busy, setBusy] = useState<RunMode | 'file' | null>(null);
  const [result, setResult] = useState<VideoLinkFilterResult | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const baseRequest = useMemo(
    () => ({
      sourceFolder: sourceFolder.trim(),
      destinationFolder: destinationFolder.trim(),
      linksText,
      flatten,
      titleMatch,
      useYtDlp
    }),
    [destinationFolder, flatten, linksText, sourceFolder, titleMatch, useYtDlp]
  );
  const currentKey = useMemo(() => requestKey(baseRequest), [baseRequest]);
  const canRun = Boolean(baseRequest.sourceFolder && baseRequest.destinationFolder && linksText.trim()) && !busy;
  const canMove =
    canRun &&
    previewKey === currentKey &&
    result?.mode === 'preview' &&
    result.matchedVideos > 0;

  const chooseLinksFile = async (): Promise<void> => {
    if (busy) return;
    setBusy('file');
    try {
      const selected = await window.desktop.videoFilter.chooseLinksFile();
      if (!selected) return;
      setLinksFile(selected.path);
      setLinksText(selected.text);
      setPreviewKey('');
      setResult(null);
    } catch (error) {
      useAppStore.getState().setError(error);
    } finally {
      setBusy(null);
    }
  };

  const run = async (mode: RunMode): Promise<void> => {
    if (!canRun) return;
    setBusy(mode);
    try {
      const next = await window.desktop.videoFilter.run({ ...baseRequest, mode });
      setResult(next);
      if (mode === 'preview') {
        setPreviewKey(currentKey);
      } else {
        setPreviewKey('');
        setConfirmOpen(false);
        useAppStore.getState().setAttention({
          id: `video-filter-${Date.now()}`,
          severity: next.failed > 0 ? 'warning' : 'success',
          title: next.failed > 0 ? 'Đã chuyển video, có mục cần kiểm tra' : 'Đã lọc video theo link',
          message:
            next.failed > 0
              ? `Đã chuyển ${next.movedVideos}/${next.matchedVideos} video; ${next.failed} video chuyển thất bại.`
              : `Đã chuyển ${next.movedVideos} video khớp sang thư mục đích.`,
          code: 'VIDEO_FILTER_COMPLETED',
          sticky: false
        });
      }
    } catch (error) {
      useAppStore.getState().setError(error);
    } finally {
      setBusy(null);
    }
  };

  const saveReport = async (): Promise<void> => {
    if (!result) return;
    try {
      await window.desktop.videoFilter.saveReport({
        defaultName: `Tubmedia-video-filter-${result.mode}-${Date.now()}.json`,
        content: JSON.stringify(result, null, 2),
        defaultFolder: result.destinationFolder
      });
    } catch (error) {
      useAppStore.getState().setError(error);
    }
  };

  const changedAfterPreview = Boolean(previewKey && previewKey !== currentKey);

  return (
    <div className="page-shell video-filter-page">
      <section className="video-filter-hero">
        <div className="video-filter-hero-icon">
          <Filter size={27} />
        </div>
        <div>
          <span>LỌC FILE THEO DANH SÁCH URL</span>
          <h1>Lọc video theo link</h1>
          <p>
            Đối chiếu ID và tiêu đề từ danh sách link với video đã tải, xem trước chính xác rồi mới chuyển file.
          </p>
        </div>
        <div className="video-filter-hero-badges">
          <b>
            <ShieldCheck size={15} />
            Xem trước trước khi chuyển
          </b>
          <b>
            <SearchCheck size={15} />
            ID + tiêu đề dự phòng
          </b>
        </div>
      </section>

      <section className="card video-filter-config">
        <div className="video-filter-section-title">
          <FolderInput size={18} />
          <div>
            <h2>1. Chọn dữ liệu</h2>
            <p>Tubmedia quét thư mục nguồn theo mọi thư mục con và không sửa file khi đang xem trước.</p>
          </div>
        </div>

        <div className="video-filter-path-grid">
          <FolderField
            label="Thư mục chứa video cần lọc"
            value={sourceFolder}
            onChange={(value) => {
              setSourceFolder(value);
            }}
            disabled={Boolean(busy)}
          />
          <FolderField
            label="Thư mục nhận video khớp"
            value={destinationFolder}
            onChange={(value) => {
              setDestinationFolder(value);
            }}
            disabled={Boolean(busy)}
          />
        </div>

        <label>
          <span className="label">Danh sách link</span>
          <textarea
            className="textarea video-filter-links"
            value={linksText}
            disabled={Boolean(busy)}
            placeholder={'Dán link YouTube, TikTok, Facebook, Instagram... mỗi link một dòng hoặc chọn file link.'}
            onChange={(event) => {
              setLinksText(event.target.value);
              setLinksFile('');
            }}
          />
        </label>

        <div className="video-filter-file-row">
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void chooseLinksFile()}>
            {busy === 'file' ? <LoaderCircle className="animate-spin" size={17} /> : <FileDown size={17} />}
            {busy === 'file' ? 'Đang đọc...' : 'Chọn file link'}
          </button>
          <span title={linksFile}>{linksFile || 'Hỗ trợ TXT, CSV, LOG, MD, JSON, URL và LIST.'}</span>
        </div>

        <div className="video-filter-options">
          <label>
            <input
              type="checkbox"
              checked={useYtDlp}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setUseYtDlp(event.target.checked);
              }}
            />
            <span>
              <b>Dùng yt-dlp để nhận diện link</b>
              <small>Chính xác hơn với playlist và nền tảng khó tách ID.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={titleMatch}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setTitleMatch(event.target.checked);
              }}
            />
            <span>
              <b>Khớp dự phòng theo tiêu đề</b>
              <small>Chỉ dùng ngưỡng cao khi tên file không chứa ID.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={flatten}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setFlatten(event.target.checked);
              }}
            />
            <span>
              <b>Gom tất cả vào một thư mục</b>
              <small>Tắt để giữ nguyên cấu trúc thư mục con.</small>
            </span>
          </label>
        </div>

        <div className="video-filter-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canRun}
            onClick={() => void run('preview')}
          >
            {busy === 'preview' ? <LoaderCircle className="animate-spin" size={17} /> : <SearchCheck size={17} />}
            {busy === 'preview' ? 'Đang đối chiếu...' : 'Xem trước kết quả'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canMove}
            onClick={() => setConfirmOpen(true)}
          >
            <MoveRight size={17} />
            Chuyển video khớp
          </button>
          {changedAfterPreview && (
            <span className="video-filter-preview-stale">
              <TriangleAlert size={15} />
              Dữ liệu đã đổi — hãy xem trước lại trước khi chuyển.
            </span>
          )}
        </div>
      </section>

      {result && (
        <section className="card video-filter-result">
          <div className="video-filter-result-head">
            <div>
              <span>KẾT QUẢ {result.mode === 'preview' ? 'XEM TRƯỚC' : 'CHUYỂN FILE'}</span>
              <h2>
                {result.mode === 'preview'
                  ? `Tìm thấy ${result.matchedVideos} video khớp`
                  : `Đã chuyển ${result.movedVideos}/${result.matchedVideos} video`}
              </h2>
            </div>
            <div className="video-filter-result-actions">
              <button type="button" className="btn" onClick={() => void saveReport()}>
                <FileJson size={17} />
                Lưu báo cáo JSON
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void window.desktop.app.showPath(result.destinationFolder)}
              >
                <ExternalLink size={17} />
                Mở thư mục đích
              </button>
            </div>
          </div>

          <div className="video-filter-stats">
            <div>
              <span>URL đầu vào</span>
              <b>{result.inputUrls}</b>
            </div>
            <div>
              <span>ID nhận diện</span>
              <b>{result.recognizedLinks}</b>
            </div>
            <div>
              <span>Video đã quét</span>
              <b>{result.scannedVideos}</b>
            </div>
            <div>
              <span>Video khớp</span>
              <b>{result.matchedVideos}</b>
            </div>
            <div>
              <span>Link chưa thấy</span>
              <b>{result.unmatchedLinks.length}</b>
            </div>
            <div>
              <span>Lỗi</span>
              <b>{result.failed}</b>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="video-filter-warning">
              <TriangleAlert size={17} />
              <div>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
            </div>
          )}

          <div className="video-filter-table-wrap">
            <table className="table video-filter-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Khớp</th>
                  <th>Nền tảng</th>
                  <th>ID</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {result.moves.slice(0, 500).map((move) => (
                  <tr key={`${move.source}-${move.videoId}`}>
                    <td>
                      <b title={move.source}>{move.relativePath}</b>
                      <small title={move.destination}>→ {move.destination}</small>
                    </td>
                    <td>{move.matchReason}</td>
                    <td>{move.platform || '—'}</td>
                    <td><code>{move.videoId}</code></td>
                    <td>
                      <span className={`video-filter-status is-${move.status}`}>
                        {move.status === 'preview' && 'Sẽ chuyển'}
                        {move.status === 'moved' && <><CheckCircle2 size={14} /> Đã chuyển</>}
                        {move.status === 'failed' && 'Lỗi'}
                      </span>
                      {move.error && <small className="video-filter-error">{move.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.moves.length > 500 && (
              <p className="video-filter-limit-note">
                Đang hiển thị 500/{result.moves.length} kết quả. Báo cáo JSON vẫn chứa đầy đủ.
              </p>
            )}
          </div>

          {result.unmatchedLinks.length > 0 && (
            <details className="video-filter-unmatched">
              <summary>{result.unmatchedLinks.length} link chưa tìm thấy video tương ứng</summary>
              <div>
                {result.unmatchedLinks.slice(0, 200).map((link) => (
                  <p key={`${link.id}-${link.url}`}>
                    <code>{link.id}</code>
                    <span>{link.platform}</span>
                    <span title={link.url}>{link.url}</span>
                  </p>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Chuyển các video đã xem trước?"
        message="Tubmedia sẽ di chuyển video khớp sang thư mục đích. Nếu khác ổ đĩa, ứng dụng sẽ sao chép, kiểm tra kích thước rồi mới xóa file nguồn."
        confirmLabel={`Chuyển ${result?.matchedVideos ?? 0} video`}
        busy={busy === 'move'}
        details={[
          `Nguồn: ${sourceFolder || 'Chưa chọn'}`,
          `Đích: ${destinationFolder || 'Chưa chọn'}`,
          'File trùng tên sẽ tự thêm (1), (2)... để không ghi đè.'
        ]}
        onConfirm={() => void run('move')}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
