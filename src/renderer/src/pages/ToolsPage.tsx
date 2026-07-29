import {
  CheckCircle2,
  CircleAlert,
  DownloadCloud,
  FileText,
  FolderOpen,
  LoaderCircle,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  UploadCloud,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ToolStatus, ToolUpdateCheck } from '@shared/types/domain';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../stores/app-store';
import { createUiEventId } from '../utils/ui-id';
import { toolSourceLabel } from '../utils/vi-labels';

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const REQUIRED = ['yt-dlp', 'ffmpeg', 'ffprobe'] as const;

const toolIcons: Record<ToolStatus['name'], LucideIcon> = {
  'yt-dlp': FileText,
  ffmpeg: Settings2,
  ffprobe: Search,
  ffplay: Play,
  aria2c: DownloadCloud
};

function capabilityLabel(value: string): string {
  const labels: Record<string, string> = {
    ytdlp_download: 'Đã xác nhận tải video',
    ytdlp_metadata: 'Đã xác nhận đọc thông tin liên kết',
    ytdlp_progress: 'Đã xác nhận xuất tiến trình tải',
    ytdlp_ffmpeg_bridge: 'Đã xác nhận kết nối với FFmpeg',
    ffprobe_analysis: 'Đã xác nhận phân tích thông tin video',
    ffprobe_streams: 'Đã xác nhận đọc luồng hình và âm thanh',
    ffprobe_json: 'Đã xác nhận xuất dữ liệu phân tích',
    ffplay_preview: 'Đã xác nhận phát và xem trước video',
    ffplay_autoexit: 'Đã xác nhận chế độ xem trước tự đóng',
    aria2_download: 'Đã xác nhận tải dữ liệu',
    aria2_multiconnection: 'Đã xác nhận tải nhiều kết nối',
    cpu_auto: 'Tự động dùng bộ xử lý trung tâm',
    libx264: 'Mã hóa H.264 bằng bộ xử lý trung tâm',
    libx265: 'Mã hóa HEVC bằng bộ xử lý trung tâm',
    h264_nvenc: 'Mã hóa H.264 bằng NVIDIA hoạt động',
    hevc_nvenc: 'Mã hóa HEVC bằng NVIDIA hoạt động',
    h264_nvenc_unavailable: 'Mã hóa H.264 bằng NVIDIA chưa tương thích',
    hevc_nvenc_unavailable: 'Mã hóa HEVC bằng NVIDIA chưa tương thích',
    aac: 'Âm thanh AAC',
    zscale: 'Bộ lọc đổi kích thước chất lượng cao',
    tonemap: 'Chuyển đổi dải sáng',
    concat: 'Ghép nối video',
    mp4: 'Định dạng MP4'
  };
  return labels[value] ?? value;
}

export function ToolsPage(): React.JSX.Element {
  const tools = useAppStore((state) => state.tools);
  const refresh = useAppStore((state) => state.refreshTools);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const [busy, setBusy] = useState<string | null>(null);
  const [updates, setUpdates] = useState<ToolUpdateCheck[]>([]);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const ready = REQUIRED.every((name) => tools.find((tool) => tool.name === name)?.available);
  const connecting = tools.some((tool) => tool.lastCheckedAt === null);
  const ffmpeg = tools.find((tool) => tool.name === 'ffmpeg');
  const cpuReady = Boolean(ffmpeg?.capabilities.includes('cpu_auto'));
  const nvencUnavailable = Boolean(
    ffmpeg?.capabilities.includes('h264_nvenc_unavailable') ||
    ffmpeg?.capabilities.includes('hevc_nvenc_unavailable')
  );

  useEffect(() => {
    let mounted = true;
    void window.desktop.tools.checkUpdates().then((value) => { if (mounted) setUpdates(value); }).catch((error: unknown) => { if (mounted) setUpdateCheckError(messageOf(error)); });
    return () => { mounted = false; };
  }, [tools]);

  const run = async (label: string, task: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await task();
      await refresh();
      setAttention({
        id: createUiEventId('tools-action'),
        severity: 'success',
        title: label,
        message: 'Kết quả được dùng chung cho tất cả danh sách tải và quy trình tải–ghép.',
        sticky: false
      });
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const checkAgain = (): Promise<void> => run('Đã kiểm tra lại công cụ', async () => {
    useAppStore.setState({ tools: await window.desktop.tools.healthCheck() });
  });

  const repairAll = (): Promise<void> => run('Đã sửa chữa công cụ', async () => {
    useAppStore.setState({ tools: await window.desktop.tools.repairAll() });
  });

  const updateAll = (): Promise<void> => run('Đã cập nhật toàn bộ công cụ', async () => {
    useAppStore.setState({ tools: await window.desktop.tools.updateAll() });
  });

  const updateOne = (name: ToolStatus['name']): Promise<void> => run(`Đã cập nhật ${name}`, async () => {
    await window.desktop.tools.update(name);
  });

  const restorePrevious = (name: ToolStatus['name']): Promise<void> => run(`Đã khôi phục phiên bản trước của ${name}`, async () => {
    await window.desktop.tools.rollback(name);
  });

  const openFolder = async (): Promise<void> => {
    try {
      const folder = await window.desktop.tools.openFolder();
      setAttention({
        id: createUiEventId('tools-folder'),
        severity: 'info',
        title: 'Đã mở thư mục công cụ',
        message: folder,
        sticky: false
      });
    } catch (error) {
      setError(messageOf(error));
    }
  };

  return <div className="page-shell tools-page tubmedia-tools-page">
    <section className={`tools-overview ${ready ? 'is-ready' : ''}`}>
      <div className="tools-overview-status">
        <div className="tools-overview-icon">{connecting ? <LoaderCircle className="animate-spin" size={24}/> : ready ? <CheckCircle2 size={24}/> : <CircleAlert size={24}/>}</div>
        <div>
          <span>TRẠNG THÁI TOÀN ỨNG DỤNG</span>
          <b>{connecting ? 'Đang tự động kết nối công cụ' : ready ? 'Sẵn sàng tải và ghép' : 'Có công cụ cần sửa chữa'}</b>
        </div>
      </div>
      <div className="tools-overview-summary">
        <div><span>Công cụ hoạt động</span><b>{tools.filter((tool) => tool.available).length}/{tools.length}</b></div>
        <div><span>Mã hóa bằng bộ xử lý trung tâm</span><b>{cpuReady ? 'Sẵn sàng' : connecting ? 'Đang kiểm tra' : 'Chưa sẵn sàng'}</b></div>
        <div><span>Mã hóa bằng NVIDIA</span><b>{nvencUnavailable ? 'Tự chuyển sang bộ xử lý trung tâm' : 'Theo kết quả thực tế'}</b></div>
      </div>
    </section>

    <section className="tool-command-bar">
      <button className="btn" onClick={() => void openFolder()} disabled={busy !== null}><FolderOpen size={17}/>Mở thư mục công cụ</button>
      <button className="btn" onClick={() => void checkAgain()} disabled={busy !== null}><RefreshCcw className={busy === 'Đã kiểm tra lại công cụ' ? 'animate-spin' : ''} size={17}/>{busy === 'Đã kiểm tra lại công cụ' ? 'Đang kiểm tra...' : 'Kiểm tra lại'}</button>
      <button className="btn" onClick={() => void repairAll()} disabled={busy !== null}><ShieldCheck size={17}/>{busy === 'Đã sửa chữa công cụ' ? 'Đang sửa chữa...' : 'Sửa chữa tất cả'}</button>
      {updates.some((item) => item.available) && <button className="btn btn-primary" onClick={() => void updateAll()} disabled={busy !== null}><UploadCloud size={17}/>{busy === 'Đã cập nhật toàn bộ công cụ' ? 'Đang cập nhật...' : 'Cập nhật công cụ có bản mới'}</button>}
      {!updates.some((item) => item.available) && !updateCheckError && <span className="badge badge-good"><CheckCircle2 size={15}/>Tất cả công cụ đang ở bản mới nhất</span>}
    </section>

    {cpuReady && nvencUnavailable && <section className="encoder-status-grid">
      <div className="encoder-status-card is-warning"><CircleAlert size={20}/><div><b>NVIDIA chưa khả dụng · CPU tự động đã thay thế</b><p>Việc tải và ghép không bị gián đoạn.</p></div></div>
    </section>}

    <div className="tools-grid">
      {tools.map((tool) => {
        const Icon = toolIcons[tool.name];
        const updateInfo = updates.find((item) => item.name === tool.name);
        return <article className={`tool-card tool-card-${tool.health}`} key={tool.name}>
          <header className="tool-card-header">
            <div className="tool-card-icon"><Icon size={23}/></div>
            <div className="tool-card-heading">
              <div className="tool-card-title"><h2>{tool.name}</h2><StatusBadge status={tool.health}/></div>
              <span className="tool-card-version">Phiên bản: {tool.version ?? 'Chưa nhận phiên bản'}{updateInfo?.available ? ` · Có bản mới ${updateInfo.latestVersion}` : tool.available ? ' · Mới nhất' : ''}</span>
            </div>
          </header>

          <div className="tool-card-details">
            <div><span>Nguồn công cụ</span><b>{toolSourceLabel(tool.source)}</b></div>
            <div><span>Đường dẫn</span><b title={tool.executablePath ?? ''}>{tool.executablePath ?? 'Chưa tìm thấy tệp thực thi'}</b></div>
            <div><span>Kiểm tra gần nhất</span><b>{tool.lastCheckedAt ? new Date(tool.lastCheckedAt).toLocaleString('vi-VN') : 'Đang tự động kiểm tra'}</b></div>
          </div>

          <div className="tool-capabilities">
            {tool.capabilities.slice(0, 8).map((capability) => <span key={capability}>{capabilityLabel(capability)}</span>)}
            {tool.capabilities.length > 8 && <span>+{tool.capabilities.length - 8} khả năng khác</span>}
            {!tool.capabilities.length && <em>{connecting ? 'Đang nhận diện khả năng của công cụ.' : tool.available ? 'Đã xác nhận tệp thực thi và phiên bản.' : 'Chưa thể kiểm tra khả năng vì công cụ chưa chạy được.'}</em>}
          </div>

          {tool.error && !connecting && <div className="tool-error-box"><CircleAlert size={17}/><span>{tool.error}</span></div>}

          <footer className="tool-card-actions">
            <div className="tool-action-group tool-action-group-secondary">
              <button className="tool-action-button" onClick={() => void openFolder()} disabled={busy !== null}><span><FolderOpen size={16}/></span><b>Mở thư mục</b></button>
              <button className="tool-action-button" onClick={() => void checkAgain()} disabled={busy !== null}><span><RefreshCcw size={16}/></span><b>Kiểm tra lại</b></button>
            </div>
            <div className="tool-action-divider"/>
            <div className="tool-action-group tool-action-group-maintenance">
              <button className="tool-action-button tool-action-restore" onClick={() => void restorePrevious(tool.name)} disabled={busy !== null}><RotateCcw size={16}/><b>Khôi phục</b><small>Bản trước</small></button>
              {updateInfo?.available ? <button className="tool-action-button tool-action-update" onClick={() => void updateOne(tool.name)} disabled={busy !== null}><UploadCloud size={16}/><b>Cập nhật</b><small>{updateInfo.latestVersion}</small></button> : <div className="tool-action-button tool-action-current" aria-label="Công cụ đang ở bản mới nhất"><CheckCircle2 size={16}/><b>Mới nhất</b><small>{tool.version ?? 'Đã xác minh'}</small></div>}
            </div>
          </footer>
        </article>;
      })}
    </div>
  </div>;
}
