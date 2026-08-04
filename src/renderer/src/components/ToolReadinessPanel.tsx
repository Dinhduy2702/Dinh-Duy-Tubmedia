import { CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, Wrench } from 'lucide-react';
import type { ToolStatus } from '@shared/types/domain';
import { useAppStore } from '../stores/app-store';
import { InfoDisclosure } from './InfoDisclosure';
import { safeUiText } from '../utils/ui-error';

const REQUIRED = ['yt-dlp', 'ffmpeg', 'ffprobe'] as const;

function shortPath(value: string | null): string {
  if (!value) return 'Chưa tìm thấy';
  if (value.length <= 62) return value;
  return `…${value.slice(-59)}`;
}

function toolByName(tools: ToolStatus[], name: typeof REQUIRED[number]): ToolStatus | undefined {
  return tools.find((tool) => tool.name === name);
}

export function ToolReadinessPanel({ workflow }: { workflow: 'download' | 'merge' }): React.JSX.Element {
  const tools = useAppStore((state) => state.tools);
  const setPage = useAppStore((state) => state.setPage);
  const required = REQUIRED.map((name) => toolByName(tools, name));
  const ready = required.every((tool) => tool?.available);
  const connecting = required.some((tool) => !tool?.lastCheckedAt);
  const ffmpeg = toolByName(tools, 'ffmpeg');
  const cpuReady = Boolean(ffmpeg?.capabilities.includes('cpu_auto'));
  const nvencUnavailable = Boolean(
    ffmpeg?.capabilities.includes('h264_nvenc_unavailable') ||
    ffmpeg?.capabilities.includes('hevc_nvenc_unavailable')
  );

  const title = connecting
    ? 'Đang tự kết nối công cụ'
    : ready
      ? 'Công cụ nền đã sẵn sàng'
      : 'Công cụ nền cần sửa chữa';
  const summary = connecting
    ? 'yt-dlp, FFmpeg và ffprobe tiếp tục được kiểm tra ở nền.'
    : ready
      ? 'yt-dlp · FFmpeg · ffprobe'
      : 'Mở Trung tâm công cụ để xem lỗi và tự sửa.';

  return <InfoDisclosure
    className="tool-readiness-disclosure"
    icon={connecting ? LoaderCircle : ready ? CheckCircle2 : CircleAlert}
    title={title}
    summary={summary}
    status={connecting ? 'ĐANG KẾT NỐI' : ready ? 'SẴN SÀNG' : 'CẦN SỬA'}
    tone={connecting ? 'info' : ready ? 'good' : 'danger'}
    autoOpen={!connecting && !ready}
    actions={<button className="btn btn-small" onClick={() => setPage('tools')}><Wrench size={15}/>Công cụ<ExternalLink size={12}/></button>}
  >
    <div className="tool-chip-grid">
      {REQUIRED.map((name) => {
        const tool = toolByName(tools, name);
        return <div key={name} className={`tool-chip ${tool?.available ? 'tool-chip-ready' : 'tool-chip-broken'}`} title={tool?.executablePath ?? safeUiText(tool?.error, 'Công cụ chưa sẵn sàng.')}>
          <span className="tool-chip-dot"/>
          <div><b>{name}</b><small>{tool?.version ?? 'đang nhận diện'}</small><em>{shortPath(tool?.executablePath ?? null)}</em></div>
        </div>;
      })}
    </div>
    {workflow === 'merge' && cpuReady && <div className="tool-readiness-note">
      <b>Bộ xử lý trung tâm tự động đã sẵn sàng</b>
      <p>H.264 dùng libx264, HEVC dùng libx265. {nvencUnavailable ? 'NVIDIA không tương thích nên ứng dụng tự chuyển sang bộ xử lý trung tâm.' : 'NVIDIA chỉ được dùng khi vượt qua kiểm tra thực tế.'}</p>
    </div>}
  </InfoDisclosure>;
}
