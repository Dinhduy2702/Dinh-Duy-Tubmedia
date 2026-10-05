import { CircleAlert, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { describeGpuEncoderIssue, nvidiaDriverVersionFromWindows } from '@shared/utils/nvenc-diagnosis';
import { safeUiText } from '../utils/ui-error';
import { useAppStore } from '../stores/app-store';

/**
 * #4 (khám phá bản cài 2026-10-05): NVENC không dùng được → nói rõ LÝ DO (vd. driver NVIDIA quá cũ) và cho
 * mở ngay trang tải driver chính thức. Chỉ hiện khi FFmpeg có NVENC nhưng bài thử mã hóa thất bại.
 */
export function GpuEncoderIssueNotice(): React.JSX.Element | null {
  const ffmpeg = useAppStore((state) => state.tools.find((tool) => tool.name === 'ffmpeg'));
  const hardware = useAppStore((state) => state.hardware);
  const [error, setError] = useState<string | null>(null);
  const unavailable = Boolean(
    ffmpeg?.capabilities.includes('h264_nvenc_unavailable') || ffmpeg?.capabilities.includes('hevc_nvenc_unavailable')
  );
  if (!ffmpeg || !unavailable) return null;

  const nvidia = hardware?.gpuAdapters.find((adapter) => /nvidia|geforce|quadro|rtx|gtx/i.test(adapter.name));
  const currentDriver = nvidiaDriverVersionFromWindows(nvidia?.driverVersion);
  const text = ffmpeg.gpuEncoderIssue
    ? describeGpuEncoderIssue(ffmpeg.gpuEncoderIssue, currentDriver)
    : {
        title: 'NVIDIA chưa khả dụng · CPU tự động đã thay thế',
        message: 'Việc tải và ghép không bị gián đoạn. Bấm "Kiểm tra lại" ở trang Công cụ để xem lý do chi tiết.',
        canUpdateDriver: Boolean(nvidia)
      };

  const openDriverPage = async (): Promise<void> => {
    setError(null);
    try {
      await window.desktop.tools.openNvidiaDriverPage();
    } catch (openError) {
      setError(safeUiText(openError, 'Không mở được trang tải driver NVIDIA.'));
    }
  };

  return (
    <div className="encoder-status-card is-warning gpu-encoder-issue" role="status">
      <CircleAlert size={20}/>
      <div>
        <b>{text.title}</b>
        <p>{text.message}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      {text.canUpdateDriver && (
        <button type="button" className="btn btn-small" onClick={() => void openDriverPage()}>
          <ExternalLink size={14}/>
          Tải driver NVIDIA
        </button>
      )}
    </div>
  );
}
