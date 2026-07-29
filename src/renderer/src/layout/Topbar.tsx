import {
  Bell,
  CheckCircle2,
  Cpu,
  DownloadCloud,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  RefreshCcw,
  Sun,
  Wrench
} from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../stores/app-store';
import { createUiEventId } from '../utils/ui-id';

const pct = (value: number | undefined): string => `${Math.round(value ?? 0)}%`;
const CONTROLLABLE = new Set(['pending', 'analyzing', 'downloading', 'verifying', 'normalizing', 'processing', 'merging', 'retrying', 'paused', 'interrupted']);
const ACTIVE = new Set(['pending', 'analyzing', 'downloading', 'verifying', 'normalizing', 'processing', 'merging', 'retrying']);
const PAUSED = new Set(['paused', 'interrupted']);

export function Topbar(): React.JSX.Element {
  const cpuPercent = useAppStore((state) => state.stats?.cpuPercent);
  const queueSummary = useAppStore(useShallow((state) => {
    let activeJobs = 0;
    let controllableCount = 0;
    let pausedCount = 0;
    for (const job of state.jobs) {
      if (ACTIVE.has(job.status)) activeJobs += 1;
      if (CONTROLLABLE.has(job.status)) {
        controllableCount += 1;
        if (PAUSED.has(job.status)) pausedCount += 1;
      }
    }
    return {
      activeJobs,
      controllableCount,
      allPaused: controllableCount > 0 && pausedCount === controllableCount
    };
  }));
  const toolSummary = useAppStore(useShallow((state) => {
    const checkedTools = state.tools.filter((tool) => tool.lastCheckedAt !== null).length;
    return {
      connecting: checkedTools < state.tools.length,
      ready: ['yt-dlp', 'ffmpeg', 'ffprobe'].every(
        (name) => state.tools.find((tool) => tool.name === name)?.available
      )
    };
  }));
  const settings = useAppStore((state) => state.settings);
  const updateStatus = useAppStore((state) => state.updateStatus);
  const refreshJobs = useAppStore((state) => state.refreshJobs);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const setPage = useAppStore((state) => state.setPage);
  const [busy, setBusy] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);

  const isLight = document.documentElement.classList.contains('light');
  const updateReady = updateStatus?.state === 'downloaded';
  const updateAvailable = updateStatus?.state === 'available' || updateStatus?.state === 'downloading';
  const updateBusy = updateStatus?.state === 'checking' || updateStatus?.state === 'downloading' || updateStatus?.state === 'installing';

  const toggleTheme = async (): Promise<void> => {
    if (!settings || themeBusy) return;
    const nextTheme = isLight ? 'dark' : 'light';
    const previousTheme = settings.theme;
    document.documentElement.classList.toggle('light', nextTheme === 'light');
    setThemeBusy(true);
    try {
      const next = await window.desktop.settings.update({ theme: nextTheme });
      useAppStore.getState().setSettings(next);
    } catch (error) {
      document.documentElement.classList.toggle(
        'light',
        previousTheme === 'light' ||
          (previousTheme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
      );
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setThemeBusy(false);
    }
  };

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      if (queueSummary.allPaused) await window.desktop.queue.resumeAll();
      else await window.desktop.queue.pauseAll();
      await refreshJobs();
      setAttention({
        id: createUiEventId('global-queue'),
        severity: queueSummary.allPaused ? 'success' : 'warning',
        title: queueSummary.allPaused ? 'Đã tiếp tục tất cả' : 'Đã tạm dừng tất cả',
        message: 'Thao tác đã áp dụng cho toàn bộ danh sách tải và toàn bộ quy trình tải–ghép.',
        sticky: false
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return <header className="app-topbar">
    <div className="topbar-metrics">
      <div className="topbar-cpu-card">
        <div className="topbar-cpu-icon"><Cpu size={18}/></div>
        <div><span>BỘ XỬ LÝ</span><b>{pct(cpuPercent)}</b></div>
        <i className={`topbar-sparkline ${(cpuPercent ?? 0) > 2 ? 'is-live' : ''}`} aria-hidden="true"><span/><span/><span/><span/><span/><span/></i>
      </div>
      <div className="topbar-job-pill">
        <span className={queueSummary.activeJobs > 0 ? 'pulse-dot' : ''}/>
        <div><b>{queueSummary.activeJobs}</b><small>công việc đang chạy</small></div>
      </div>
    </div>

    <div className="topbar-actions">
      <button
        aria-label={isLight ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}
        aria-checked={isLight}
        className={`topbar-theme-switch ${isLight ? 'is-light' : 'is-dark'}`}
        disabled={!settings || themeBusy}
        onClick={() => void toggleTheme()}
        role="switch"
        title={isLight ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}
      >
        <span className="topbar-theme-switch-label" aria-hidden="true">{isLight ? 'Sáng' : 'Tối'}</span>
        <span className="topbar-theme-switch-track" aria-hidden="true">
          <Sun className="topbar-theme-switch-sun" size={13}/>
          <Moon className="topbar-theme-switch-moon" size={13}/>
          <span className="topbar-theme-switch-thumb">
            {themeBusy ? <LoaderCircle className="animate-spin" size={14}/> : isLight ? <Sun size={14}/> : <Moon size={14}/>} 
          </span>
        </span>
      </button>
      <button className={`tool-status-button ${toolSummary.ready ? 'is-ready' : ''}`} onClick={() => setPage('tools')} title="Mở Trung tâm công cụ">
        {toolSummary.connecting ? <LoaderCircle className="animate-spin" size={17}/> : toolSummary.ready ? <CheckCircle2 size={17}/> : <Wrench size={17}/>} 
        <span>{toolSummary.connecting ? 'Đang tự kết nối' : toolSummary.ready ? 'Công cụ sẵn sàng' : 'Cần sửa công cụ'}</span>
      </button>
      <button
        className={`topbar-update-button ${updateReady ? 'is-ready' : updateAvailable ? 'is-available' : ''}`}
        onClick={() => setPage('updates')}
        title="Mở Trung tâm cập nhật"
      >
        {updateReady ? <DownloadCloud size={17}/> : <RefreshCcw size={17}/>} 
        <span>{updateReady ? 'Cài bản mới' : updateAvailable ? 'Có bản mới' : updateBusy ? 'Đang kiểm tra' : 'Cập nhật thủ công'}</span>
        {(updateReady || updateAvailable) && <i aria-hidden="true"/>}
      </button>
      <button className="btn btn-primary topbar-pause" disabled={busy || queueSummary.controllableCount === 0} onClick={() => void toggle()}>
        {busy ? <LoaderCircle className="animate-spin" size={17}/> : queueSummary.allPaused ? <Play size={17}/> : <Pause size={17}/>}<span>{queueSummary.allPaused ? 'Tiếp tục tất cả' : 'Tạm dừng tất cả'}</span>
      </button>
      <button className="btn btn-ghost topbar-icon-button" title="Mở nhật ký" aria-label="Mở nhật ký" onClick={() => setPage('logs')}><Bell size={18}/></button>
    </div>
  </header>;
}
