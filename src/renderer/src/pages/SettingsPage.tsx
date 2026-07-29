import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  ChevronDown,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  MonitorCog,
  LoaderCircle,
  RefreshCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import type { AppSettings, QualityProfile, ResourceProfile } from '@shared/types/domain';
import { planForListCount, recommendDownloadConcurrency } from '@shared/utils/hardware-recommendation';
import { CookieManagerDialog } from '../components/CookieManagerDialog';
import { FolderField } from '../components/FolderField';
import { InfoDisclosure } from '../components/InfoDisclosure';
import { useAppStore } from '../stores/app-store';
import { createPersistentUiId, createUiEventId } from '../utils/ui-id';

const sections = ['Chung', 'Hiệu năng', 'Tải danh sách', 'Tải & Ghép', 'Lưu trữ', 'Kiểm tra', 'Cập nhật'] as const;
type Section = (typeof sections)[number];
type Patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function SettingsPage(): React.JSX.Element | null {
  const current = useAppStore((state) => state.settings);
  const hardware = useAppStore((state) => state.hardware);
  const resources = useAppStore((state) => state.resources);
  const qualities = useAppStore((state) => state.qualities);
  const setSettings = useAppStore((state) => state.setSettings);
  const setError = useAppStore((state) => state.setError);
  const setAttention = useAppStore((state) => state.setAttention);
  const [settings, setLocal] = useState<AppSettings | null>(current);
  const [section, setSection] = useState<Section>('Chung');
  const [saving, setSaving] = useState(false);
  const [settingsAction, setSettingsAction] = useState<'detect' | 'recommend' | 'apply' | null>(null);
  const [recommended, setRecommended] = useState<ResourceProfile | null>(null);
  const concurrency = hardware ? recommendDownloadConcurrency(hardware) : null;
  const currentPlan = concurrency && settings
    ? planForListCount(concurrency, settings.downloadLaneCount, settings.downloadVerifyEntireFile)
    : null;

  useEffect(() => setLocal(current), [current]);
  if (!settings) return null;

  const patch: Patch = (key, value) => setLocal((snapshot) => snapshot ? { ...snapshot, [key]: value } : snapshot);
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const next = await window.desktop.settings.update(settings);
      setSettings(next);
      setAttention({ id: createUiEventId('settings-save'), severity: 'success', title: 'Đã lưu cài đặt', message: 'Các thiết lập mới sẽ được áp dụng cho tác vụ tiếp theo.', sticky: false });
    } catch (error) { setError(messageOf(error)); }
    finally { setSaving(false); }
  };
  const detect = async (): Promise<void> => {
    setSettingsAction('detect');
    try {
      const nextHardware = await window.desktop.settings.hardware();
      useAppStore.setState({ hardware: nextHardware });
      setAttention({
        id: createUiEventId('hardware-detect'),
        severity: 'success',
        title: 'Đã kiểm tra cấu hình máy',
        message: `Đã nhận diện ${nextHardware.logicalCpuCount} luồng xử lý Bộ xử lý trung tâm và ${(nextHardware.totalMemoryBytes / 1024 ** 3).toFixed(0)} GB RAM.`,
        sticky: false
      });
    } catch (error) { setError(messageOf(error)); }
    finally { setSettingsAction(null); }
  };
  const recommend = async (): Promise<void> => {
    setSettingsAction('recommend');
    try {
      const nextRecommendation = await window.desktop.settings.recommend();
      setRecommended(nextRecommendation);
      setAttention({
        id: createUiEventId('hardware-recommend'),
        severity: 'info',
        title: 'Đã tạo cấu hình khuyến nghị',
        message: 'Kiểm tra bảng đề xuất bên phải rồi nhấn Lưu và áp dụng theo số danh sách.',
        sticky: false
      });
    } catch (error) { setError(messageOf(error)); }
    finally { setSettingsAction(null); }
  };
  const applyRecommendation = async (): Promise<void> => {
    if (!recommended || !concurrency || !currentPlan) return;
    setSettingsAction('apply');
    try {
      const saved = await window.desktop.settings.saveResourceProfile({
        ...recommended,
        downloadWorkers: currentPlan.workersPerList,
        builtIn: false
      });
      const nextSettings = await window.desktop.settings.update({
        defaultResourceProfileId: saved.id,
        maxGlobalDownloadWorkers: currentPlan.globalWorkers,
        downloadConcurrentFragments: concurrency.recommendedConcurrentFragments,
        aria2Connections: concurrency.recommendedAria2Connections
      });
      useAppStore.setState({
        resources: [...resources.filter((item) => item.id !== saved.id), saved],
        settings: nextSettings
      });
      setSettings(nextSettings);
      setLocal(nextSettings);
      setAttention({ id: createUiEventId('hardware-apply'), severity: 'success', title: 'Đã áp dụng cấu hình tối ưu', message: `${currentPlan.workersPerList} luồng tải/danh sách, tối đa ${currentPlan.globalWorkers} video tải đồng thời.`, sticky: false });
    } catch (error) { setError(messageOf(error)); }
    finally { setSettingsAction(null); }
  };

  return <div className="page-shell settings-page">
    <div className="page-heading">
      <div>
        <h1 className="text-2xl font-black">Cài đặt</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Đường dẫn, luồng tải, luồng xử lý, chất lượng, cookies và mọi tùy chọn vận hành được chỉnh trên giao diện.</p>
      </div>
      <button className="btn btn-primary" onClick={() => void save()} disabled={saving}><Save size={17}/>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</button>
    </div>

    <div className="settings-layout mt-5 grid gap-4 2xl:grid-cols-[250px_1fr_360px]">
      <aside className="card settings-nav h-fit p-2">
        {sections.map((item) => <button key={item} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold" style={section === item ? { background: 'color-mix(in srgb,var(--accent) 16%,var(--panel))', color: 'var(--accent)' } : { color: 'var(--muted)' }} onClick={() => setSection(item)}><SectionIcon name={item}/>{item}</button>)}
      </aside>

      <section className="card settings-content p-5">
        {section === 'Chung' && <General settings={settings} patch={patch} qualities={qualities} resources={resources}/>} 
        {section === 'Hiệu năng' && <Performance settings={settings} patch={patch} resources={resources} setError={setError}/>} 
        {section === 'Tải danh sách' && <DownloadSettings settings={settings} patch={patch} setError={setError}/>} 
        {section === 'Tải & Ghép' && <ProcessingSettings settings={settings} patch={patch} qualities={qualities} setError={setError}/>} 
        {section === 'Lưu trữ' && <Storage settings={settings} patch={patch}/>} 
        {section === 'Kiểm tra' && <Verification settings={settings} patch={patch}/>} 
        {section === 'Cập nhật' && <UpdateSettings settings={settings} patch={patch}/>} 
      </section>

      <aside className="settings-assistant space-y-4">
        <div className="card p-4">
          <div className="flex items-center justify-between"><h2 className="font-extrabold">Cấu hình máy</h2><button className="btn p-1.5" title="Kiểm tra lại cấu hình máy" onClick={() => void detect()} disabled={settingsAction !== null}>{settingsAction === 'detect' ? <LoaderCircle className="animate-spin" size={15}/> : <RefreshCcw size={15}/>}</button></div>
          <div className="mt-3 space-y-2 text-sm"><Row a="Bộ xử lý trung tâm" b={hardware?.cpuModel ?? '—'}/><Row a="Luồng xử lý" b={String(hardware?.logicalCpuCount ?? 0)}/><Row a="Nhân vật lý" b={String(hardware?.physicalCpuCount ?? 0)}/><Row a="RAM" b={`${((hardware?.totalMemoryBytes ?? 0) / 1024 ** 3).toFixed(0)} GB`}/><Row a="Bộ xử lý đồ họa" b={hardware?.gpuAdapters.map((item) => item.name).join(', ') || 'Chưa nhận diện'}/></div>
          <button className="btn mt-4 w-full" onClick={() => void recommend()} disabled={settingsAction !== null}>{settingsAction === 'recommend' ? <LoaderCircle className="animate-spin" size={17}/> : <Sparkles size={17}/>} {settingsAction === 'recommend' ? 'Đang phân tích...' : 'Tạo đề xuất tự động'}</button>
        </div>
        {recommended && concurrency && currentPlan && <div className="card p-4" style={{ borderColor: 'var(--accent)' }}><h3 className="font-extrabold">{recommended.name}</h3><p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{recommended.description}</p><div className="mt-3 space-y-2 text-sm"><Row a="Số danh sách khuyến nghị" b={String(concurrency.recommendedConcurrentLists)}/><Row a={`Luồng tải mỗi danh sách khi mở ${settings.downloadLaneCount} danh sách`} b={String(currentPlan.workersPerList)}/><Row a="Giới hạn tổng hiện tại" b={String(currentPlan.globalWorkers)}/><Row a="Tối đa an toàn" b={String(concurrency.maximumSafeGlobalWorkers)}/><Row a="Mảnh tải đồng thời mỗi video" b={String(concurrency.recommendedConcurrentFragments)}/><Row a="Luồng xử lý FFmpeg" b={String(recommended.ffmpegThreads)}/></div><p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>{concurrency.summary} {currentPlan.note}</p><div className="mt-3 space-y-1 rounded-lg border p-2 text-[11px]" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>{concurrency.plans.map((plan) => <div key={plan.listCount} className="flex justify-between gap-2"><span>{plan.listCount} danh sách</span><b>{plan.workersPerList}/danh sách · {plan.globalWorkers} tổng</b></div>)}</div><button className="btn btn-primary mt-4 w-full" onClick={() => void applyRecommendation()} disabled={settingsAction !== null}>{settingsAction === 'apply' ? <LoaderCircle className="animate-spin" size={17}/> : <Save size={17}/>} {settingsAction === 'apply' ? 'Đang áp dụng...' : 'Lưu và áp dụng theo số danh sách'}</button></div>}
        <details className="settings-safety-note">
          <summary><ShieldCheck size={17}/><span><b>Nguyên tắc áp dụng cấu hình</b><small>Chỉ tác động các tác vụ được tạo sau khi lưu.</small></span><ChevronDown size={16}/></summary>
          <p>Số luồng tải và luồng xử lý mới chỉ áp dụng cho tác vụ tiếp theo. Tiến trình nền, tệp và cơ sở dữ liệu luôn được xử lý qua lớp bảo vệ của ứng dụng.</p>
        </details>
      </aside>
    </div>
  </div>;
}

function SectionIcon({ name }: { name: Section }): React.JSX.Element {
  const Icon = name === 'Chung' ? MonitorCog : name === 'Hiệu năng' ? Gauge : name === 'Tải danh sách' ? Download : name === 'Tải & Ghép' ? SlidersHorizontal : name === 'Lưu trữ' ? HardDrive : name === 'Kiểm tra' ? ShieldCheck : Wrench;
  return <Icon size={17}/>;
}

function General({ settings, patch, qualities, resources }: { settings: AppSettings; patch: Patch; qualities: QualityProfile[]; resources: ResourceProfile[] }): React.JSX.Element {
  return <Block title="Giao diện và mặc định" icon={MonitorCog}><Grid><Select label="Giao diện" value={settings.theme} onChange={(value) => patch('theme', value as AppSettings['theme'])} options={[['system','Theo giao diện Windows'],['dark','Màu tối'],['light','Màu sáng']]}/><Select label="Khi đóng ứng dụng" value={settings.closeBehavior} onChange={(value) => patch('closeBehavior', value as AppSettings['closeBehavior'])} options={[['ask','Luôn hỏi'],['pause_and_exit','Tạm dừng và đóng'],['cancel_and_exit','Hủy và đóng'],['tray','Thu nhỏ xuống khay hệ thống']]}/><Select label="Thành phẩm Tải & Ghép mặc định" value={settings.defaultQualityProfileId} onChange={(value) => patch('defaultQualityProfileId', value)} options={qualities.map((item) => [item.id, item.name])}/><Select label="Cấu hình tài nguyên mặc định" value={settings.defaultResourceProfileId} onChange={(value) => patch('defaultResourceProfileId', value)} options={resources.map((item) => [item.id, item.name])}/><Toggle label="Thu nhỏ xuống khay hệ thống" checked={settings.minimizeToTray} onChange={(value) => patch('minimizeToTray', value)}/><Toggle label="Khởi động cùng Windows" checked={settings.startWithWindows} onChange={(value) => patch('startWithWindows', value)}/></Grid></Block>;
}

function Performance({ settings, patch, resources, setError }: { settings: AppSettings; patch: Patch; resources: ResourceProfile[]; setError: (error: string | null) => void }): React.JSX.Element {
  const selected = resources.find((item) => item.id === settings.defaultResourceProfileId) ?? resources[0];
  const [draft, setDraft] = useState<ResourceProfile | null>(null);
  useEffect(() => {
    setDraft(selected
      ? { ...selected, id: createPersistentUiId('resource-custom'), name: `${selected.name} · Tùy chỉnh`, builtIn: false }
      : null);
  }, [selected]);
  const saveDraft = async (): Promise<void> => {
    if (!draft) return;
    try {
      const saved = await window.desktop.settings.saveResourceProfile({ ...draft, builtIn: false });
      useAppStore.setState({ resources: [...resources.filter((item) => item.id !== saved.id), saved] });
      patch('defaultResourceProfileId', saved.id);
      useAppStore.getState().setAttention({ id: createUiEventId('resource-profile'), severity: 'success', title: 'Đã lưu Cấu hình tài nguyên', message: `Cấu hình ${saved.name} đã được chọn làm mặc định sau khi lưu cài đặt.`, sticky: false });
    } catch (error) { setError(messageOf(error)); }
  };
  if (!draft) return <Block title="Cấu hình tài nguyên" icon={Cpu}><p>Không có Cấu hình tài nguyên.</p></Block>;
  type NumericResourceKey = 'downloadWorkers' | 'analyzeWorkers' | 'normalizeWorkers' | 'remuxWorkers' | 'clipWorkers' | 'ffmpegThreads' | 'filterThreads' | 'filterComplexThreads' | 'cpuSoftLimitPercent' | 'memoryFreeMinimumBytes' | 'diskFreeMinimumBytes' | 'gpuJobs';
  const number = (key: NumericResourceKey, value: number): void => setDraft({ ...draft, [key]: value });
  return <Block title="Cấu hình tài nguyên" icon={Cpu}>
    <Select label="Cấu hình đang dùng" value={settings.defaultResourceProfileId} onChange={(value) => patch('defaultResourceProfileId', value)} options={resources.map((item) => [item.id, item.name])}/>
    <h3 className="mb-3 mt-6 font-black">Tạo cấu hình tùy chỉnh từ cấu hình đang chọn</h3>
    <Grid><Text label="Tên cấu hình" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })}/><Select label="Mức ưu tiên tiến trình" value={draft.processPriority} onChange={(value) => setDraft({ ...draft, processPriority: value as ResourceProfile['processPriority'] })} options={[['idle','Rất thấp'],['below_normal','Dưới bình thường'],['normal','Bình thường'],['above_normal','Trên bình thường'],['high','Cao']]}/><NumberField label="Luồng tải mỗi danh sách" value={draft.downloadWorkers} min={1} max={16} onChange={(value) => number('downloadWorkers', value)}/><NumberField label="Luồng phân tích" value={draft.analyzeWorkers} min={1} max={16} onChange={(value) => number('analyzeWorkers', value)}/><NumberField label="Luồng chuẩn hóa" value={draft.normalizeWorkers} min={1} max={4} onChange={(value) => number('normalizeWorkers', value)}/><NumberField label="Luồng cắt đoạn" value={draft.clipWorkers} min={1} max={8} onChange={(value) => number('clipWorkers', value)}/><NumberField label="Luồng đóng gói lại" value={draft.remuxWorkers} min={1} max={8} onChange={(value) => number('remuxWorkers', value)}/><NumberField label="Tác vụ Bộ xử lý đồ họa (0 = Bộ xử lý trung tâm tự động)" value={draft.gpuJobs} min={0} max={4} onChange={(value) => number('gpuJobs', value)}/><NumberField label="Luồng xử lý FFmpeg" value={draft.ffmpegThreads} min={1} max={128} onChange={(value) => number('ffmpegThreads', value)}/><NumberField label="Luồng bộ lọc" value={draft.filterThreads} min={1} max={64} onChange={(value) => number('filterThreads', value)}/><NumberField label="Luồng bộ lọc phức hợp" value={draft.filterComplexThreads} min={1} max={64} onChange={(value) => number('filterComplexThreads', value)}/><NumberField label="Giới hạn Bộ xử lý trung tâm mềm %" value={draft.cpuSoftLimitPercent} min={20} max={100} onChange={(value) => number('cpuSoftLimitPercent', value)}/><NumberField label="RAM trống tối thiểu GB" value={Math.round(draft.memoryFreeMinimumBytes / 1024 ** 3)} min={1} max={512} onChange={(value) => number('memoryFreeMinimumBytes', value * 1024 ** 3)}/><NumberField label="Dung lượng ổ đĩa trống tối thiểu GB" value={Math.round(draft.diskFreeMinimumBytes / 1024 ** 3)} min={1} max={2048} onChange={(value) => number('diskFreeMinimumBytes', value * 1024 ** 3)}/></Grid>
    <button className="btn btn-primary mt-5" onClick={() => void saveDraft()}><Save size={17}/>Lưu cấu hình tùy chỉnh</button>
  </Block>;
}

function DownloadSettings({ settings, patch, setError }: { settings: AppSettings; patch: Patch; setError: (error: string | null) => void }): React.JSX.Element {
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
  const chooseCookies = async (): Promise<void> => {
    try {
      const selected = await window.desktop.dialogs.chooseCookiesFile();
      if (selected) {
        patch('cookiesFilePath', selected);
        patch('cookiesBrowser', 'none');
      }
    } catch (error) { setError(messageOf(error)); }
  };
  const qualityInvalid = settings.downloadMaxHeight > 0 && settings.downloadMinHeight > settings.downloadMaxHeight;
  const fpsInvalid = settings.downloadMaxFps > 0 && settings.downloadMinFps > settings.downloadMaxFps;
  const videoBitrateInvalid = settings.downloadVideoBitrateKbps > 0 && settings.downloadMinVideoBitrateKbps > settings.downloadVideoBitrateKbps;
  const audioInvalid = settings.downloadAudioBitrateKbps > 0 && settings.downloadMinAudioBitrateKbps > settings.downloadAudioBitrateKbps;
  const capCutMode = settings.downloadCompatibilityMode !== 'source';
  const highestSourceActive =
    !capCutMode &&
    settings.downloadMinHeight === 0 &&
    settings.downloadMaxHeight === 0 &&
    settings.downloadMinFps === 0 &&
    settings.downloadMaxFps === 0 &&
    settings.downloadCodecPreference === 'auto' &&
    settings.downloadMinVideoBitrateKbps === 0 &&
    settings.downloadVideoBitrateKbps === 0 &&
    settings.downloadMinAudioBitrateKbps === 0 &&
    settings.downloadAudioBitrateKbps === 0;
  const reference1080Active =
    !capCutMode &&
    settings.downloadMinHeight === 720 &&
    settings.downloadMaxHeight === 1080 &&
    settings.downloadMinFps === 0 &&
    settings.downloadMaxFps === 0 &&
    settings.downloadCodecPreference === 'h264' &&
    settings.downloadContainerPreference === 'mp4' &&
    settings.downloadAllowBelowMinimum &&
    settings.useAria2c &&
    settings.aria2Connections === 16 &&
    settings.downloadConcurrentFragments === 2 &&
    settings.maxGlobalDownloadWorkers === 2;
  const light720Active =
    !capCutMode &&
    settings.downloadMinHeight === 0 &&
    settings.downloadMaxHeight === 720 &&
    settings.downloadCodecPreference === 'h264' &&
    settings.downloadContainerPreference === 'mp4';
  const useHighestSource = (): void => {
    patch('downloadCompatibilityMode', 'source');
    patch('downloadMinHeight', 0);
    patch('downloadMaxHeight', 0);
    patch('downloadMinFps', 0);
    patch('downloadMaxFps', 0);
    patch('downloadCodecPreference', 'auto');
    patch('downloadMinVideoBitrateKbps', 0);
    patch('downloadVideoBitrateKbps', 0);
    patch('downloadMinAudioBitrateKbps', 0);
    patch('downloadAudioBitrateKbps', 0);
    patch('downloadAllowBelowMinimum', false);
  };
  const useReference1080 = (): void => {
    patch('downloadCompatibilityMode', 'source');
    patch('downloadMinHeight', 720);
    patch('downloadMaxHeight', 1080);
    patch('downloadMinFps', 0);
    patch('downloadMaxFps', 0);
    patch('downloadCodecPreference', 'h264');
    patch('downloadContainerPreference', 'mp4');
    patch('downloadMinVideoBitrateKbps', 0);
    patch('downloadVideoBitrateKbps', 0);
    patch('downloadMinAudioBitrateKbps', 0);
    patch('downloadAudioBitrateKbps', 0);
    patch('downloadAllowBelowMinimum', true);
    patch('useAria2c', true);
    patch('aria2Connections', 16);
    patch('downloadConcurrentFragments', 2);
    patch('maxGlobalDownloadWorkers', 2);
  };
  const useLight720 = (): void => {
    patch('downloadCompatibilityMode', 'source');
    patch('downloadMinHeight', 0);
    patch('downloadMaxHeight', 720);
    patch('downloadMinFps', 0);
    patch('downloadMaxFps', 30);
    patch('downloadCodecPreference', 'h264');
    patch('downloadContainerPreference', 'mp4');
    patch('downloadMinVideoBitrateKbps', 0);
    patch('downloadVideoBitrateKbps', 0);
    patch('downloadMinAudioBitrateKbps', 0);
    patch('downloadAudioBitrateKbps', 0);
    patch('downloadAllowBelowMinimum', true);
  };
  return <Block title="Tải danh sách video · đầu ra riêng" icon={Download}>
    <InfoDisclosure className="settings-scope-disclosure mb-5" icon={Download} title="Phạm vi: Tải danh sách" summary="Không tác động nguồn hoặc thành phẩm của Tải & Ghép." status="ĐỘC LẬP" tone="info">
      <p className="settings-detail-copy">Thiết lập này chỉ áp dụng cho Tải danh sách. yt-dlp tự xử lý YouTube, Google Drive, TikTok, Facebook, Instagram, X, Vimeo, Reddit, Dailymotion và những nền tảng được hỗ trợ khác; Cookies, mạng và công cụ là hạ tầng dùng chung.</p>
    </InfoDisclosure>
    <h3 className="mb-3 font-black">Chất lượng đầu ra của Tải danh sách</h3>
    <div className="download-preset-grid">
      <div className={`download-source-preset ${reference1080Active ? 'is-active' : ''}`}>
        <ShieldCheck size={19}/><div><b>Đa nền tảng 720p–1080p · KHUYÊN DÙNG</b><span>H.264 + MP4, fallback thông minh, aria2c 16 kết nối, 2 fragment và tối đa 2 video tải đồng thời; đầu ra giống workflow tham chiếu, dễ phát và dễ dựng.</span></div>
        <button className="btn" type="button" disabled={reference1080Active} onClick={useReference1080}>{reference1080Active ? 'Đang dùng' : 'Áp dụng'}</button>
      </div>
      <div className={`download-source-preset ${highestSourceActive ? 'is-active' : ''}`}>
        <HardDrive size={19}/><div><b>Nguồn cao nhất</b><span>Không giới hạn độ phân giải, FPS hay codec; mạnh nhất khi cần giữ 2K/4K, HDR và bitrate tối đa nền tảng cung cấp.</span></div>
        <button className="btn" type="button" disabled={highestSourceActive} onClick={useHighestSource}>{highestSourceActive ? 'Đang dùng' : 'Áp dụng'}</button>
      </div>
      <div className={`download-source-preset ${light720Active ? 'is-active' : ''}`}>
        <Gauge size={19}/><div><b>720p nhẹ và nhanh</b><span>H.264 MP4 tối đa 720p/30 FPS; mạnh nhất khi cần tiết kiệm dung lượng, tải nhanh và xem trên máy cấu hình thấp.</span></div>
        <button className="btn" type="button" disabled={light720Active} onClick={useLight720}>{light720Active ? 'Đang dùng' : 'Áp dụng'}</button>
      </div>
    </div>
    <Select label="Chế độ tương thích video" value={settings.downloadCompatibilityMode} onChange={(value) => patch('downloadCompatibilityMode', value as AppSettings['downloadCompatibilityMode'])} options={[["source","Theo nguồn · dùng thiết lập thủ công"],["capcut_sdr_1080p","CapCut trực tiếp · SDR 1080p"],["capcut_sdr_2k","CapCut trực tiếp · SDR 1080p–2K (1440p)"]]}/>
    {capCutMode
      ? <div className="my-4 rounded-xl border p-4 text-sm leading-6" style={{ borderColor: 'var(--good)', background: 'color-mix(in srgb,var(--good) 7%,var(--panel2))' }}>
        <b style={{ color: 'var(--good)' }}>Dựng trực tiếp trong CapCut, không tạo và không cần Proxy</b>
        <p className="mt-1" style={{ color: 'var(--muted)' }}>Ứng dụng bắt buộc nguồn tối thiểu 1080p, giữ tối đa 60 FPS và xuất MP4 H.264 8-bit yuv420p, SDR BT.709, AAC 48 kHz. HDR/PQ/HLG/BT.2020, 10-bit, VP9, AV1 hoặc HEVC chỉ được chuyển đổi sau khi bạn chủ động chọn chế độ này.</p>
      </div>
      : <>
        <div className="mt-4"/>
        <Grid>
          <NumberField label="Độ phân giải tối thiểu (0 = không giới hạn)" value={settings.downloadMinHeight} min={0} max={4320} onChange={(value) => patch('downloadMinHeight', value)}/>
          <NumberField label="Độ phân giải tối đa (0 = cao nhất nguồn)" value={settings.downloadMaxHeight} min={0} max={4320} onChange={(value) => patch('downloadMaxHeight', value)}/>
          <NumberField label="FPS tối thiểu (0 = không giới hạn)" value={settings.downloadMinFps} min={0} max={240} onChange={(value) => patch('downloadMinFps', value)}/>
          <NumberField label="FPS tối đa (0 = cao nhất nguồn)" value={settings.downloadMaxFps} min={0} max={240} onChange={(value) => patch('downloadMaxFps', value)}/>
          <Select label="Ưu tiên codec video" value={settings.downloadCodecPreference} onChange={(value) => patch('downloadCodecPreference', value as AppSettings['downloadCodecPreference'])} options={[["auto","Tự động · chất lượng tốt nhất"],["h264","H.264 · tương thích cao"],["hevc","HEVC/H.265"],["vp9","VP9"],["av1","AV1"]]}/>
          <Select label="Định dạng tệp thành phẩm" value={settings.downloadContainerPreference} onChange={(value) => patch('downloadContainerPreference', value as AppSettings['downloadContainerPreference'])} options={[["auto","Tự động · ưu tiên MP4, dự phòng MKV"],["mp4","Bắt buộc MP4"],["mkv","Giữ MKV"]]}/>
          <NumberField label="Bitrate video tối thiểu kbps (0 = không giới hạn)" value={settings.downloadMinVideoBitrateKbps} min={0} max={200000} onChange={(value) => patch('downloadMinVideoBitrateKbps', value)}/>
          <NumberField label="Bitrate video tối đa kbps (0 = cao nhất nguồn)" value={settings.downloadVideoBitrateKbps} min={0} max={200000} onChange={(value) => patch('downloadVideoBitrateKbps', value)}/>
          <NumberField label="Bitrate âm thanh tối thiểu (0 = không giới hạn)" value={settings.downloadMinAudioBitrateKbps} min={0} max={512} onChange={(value) => patch('downloadMinAudioBitrateKbps', value)}/>
          <NumberField label="Bitrate âm thanh tối đa (0 = cao nhất nguồn)" value={settings.downloadAudioBitrateKbps} min={0} max={512} onChange={(value) => patch('downloadAudioBitrateKbps', value)}/>
          <Toggle label="Cho phép fallback thấp hơn mức tối thiểu khi nguồn không có" checked={settings.downloadAllowBelowMinimum} onChange={(value) => patch('downloadAllowBelowMinimum', value)}/>
        </Grid>
      </>}
    <div className="mt-4"/>
    <Grid>
      <Select label="Số danh sách hiển thị" value={String(settings.downloadLaneCount)} onChange={(value) => patch('downloadLaneCount', Number(value) as AppSettings['downloadLaneCount'])} options={[["1","1 danh sách"],["2","2 danh sách"],["3","3 danh sách"],["4","4 danh sách"]]}/>
      <Toggle label="Kiểm tra toàn bộ video sau tải bằng FFmpeg (Chuyên sâu)" checked={settings.downloadVerifyEntireFile} onChange={(value) => patch('downloadVerifyEntireFile', value)}/>
    </Grid>
    {!capCutMode && (qualityInvalid || fpsInvalid || videoBitrateInvalid || audioInvalid) && <div className="mt-3 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>Giới hạn không hợp lệ: giá trị tối thiểu không được lớn hơn giá trị tối đa, trừ khi tối đa bằng 0.</div>}
    <p className="mt-3 text-xs leading-5" style={{ color: 'var(--muted)' }}>Kiểm tra toàn bộ chuyên sâu giải mã toàn bộ tệp để phát hiện lỗi ở đầu, giữa hoặc cuối video. Tính năng này chính xác hơn nhưng dùng thêm Bộ xử lý trung tâm và tốc độ đọc ổ đĩa; ứng dụng sẽ đề xuất giảm luồng tải khi bật.</p>

    <h3 className="mb-3 mt-7 font-black">Cookies và đăng nhập</h3>
    <InfoDisclosure
      className="settings-cookie-disclosure"
      icon={ShieldCheck}
      title="Cookies chỉ dùng khi video yêu cầu"
      summary="Ứng dụng luôn thử tải công khai trước."
      status="BẢO MẬT"
      tone="good"
      actions={<button className="btn btn-small btn-primary" type="button" onClick={() => setCookieDialogOpen(true)}>Quản lý cookies</button>}
    >
      <p className="settings-detail-copy">Chỉ khi yt-dlp xác nhận video cần đăng nhập, cookies đã lưu mới được dùng hoặc ứng dụng mới thông báo cho bạn thêm cookies.</p>
    </InfoDisclosure>
    <Grid>
      <Select label="Cookies từ trình duyệt" value={settings.cookiesBrowser} onChange={(value) => { patch('cookiesBrowser', value as AppSettings['cookiesBrowser']); if (value !== 'none') patch('cookiesFilePath', ''); }} options={[["none","Không dùng"],["chrome","Chrome"],["edge","Edge"],["firefox","Firefox"]]}/>
      <Text label="Hồ sơ trình duyệt (không bắt buộc)" value={settings.cookiesBrowserProfile} onChange={(value) => patch('cookiesBrowserProfile', value)} placeholder="Mặc định hoặc Hồ sơ 1"/>
      <label><span className="label">Tệp cookies Netscape</span><div className="flex gap-2"><input className="input" value={settings.cookiesFilePath} onChange={(event: ChangeEvent<HTMLInputElement>) => patch('cookiesFilePath', event.target.value)}/><button className="btn" type="button" onClick={() => void chooseCookies()}>Chọn</button></div></label>
    </Grid>
    <details className="settings-inline-note mt-3"><summary>Phương án khi Chrome/Edge khóa cookies<ChevronDown size={15}/></summary><p>Ứng dụng sẽ tạm dừng đúng hàng đợi; Firefox, dán trực tiếp hoặc tệp TXT là phương án thay thế.</p></details>
    <CookieManagerDialog open={cookieDialogOpen} onClose={() => setCookieDialogOpen(false)} onConfigured={async () => { const next = await window.desktop.settings.get(); patch('cookiesFilePath', next.cookiesFilePath); patch('cookiesBrowser', next.cookiesBrowser); patch('cookiesBrowserProfile', next.cookiesBrowserProfile); }}/>

    <h3 className="mb-3 mt-7 font-black">Công cụ và mạng</h3>
    <Grid>
      <Text label="Đường dẫn yt-dlp" value={settings.ytdlpPath} onChange={(value) => patch('ytdlpPath', value)} placeholder="Để trống để dùng tool portable/managed/PATH"/>
      <Text label="Đường dẫn FFmpeg" value={settings.ffmpegPath} onChange={(value) => patch('ffmpegPath', value)}/>
      <Text label="Đường dẫn ffprobe" value={settings.ffprobePath} onChange={(value) => patch('ffprobePath', value)}/>
      <Text label="Đường dẫn aria2c" value={settings.aria2cPath} onChange={(value) => patch('aria2cPath', value)}/>
      <Text label="Proxy mạng khi tải (không liên quan Proxy của CapCut)" value={settings.proxy} onChange={(value) => patch('proxy', value)} placeholder="Để trống nếu không dùng proxy mạng"/>
      <Text label="Giới hạn tốc độ" value={settings.rateLimit} onChange={(value) => patch('rateLimit', value)} placeholder="Ví dụ 20M"/>
      <Toggle label="Dùng aria2c khi khả dụng" checked={settings.useAria2c} onChange={(value) => patch('useAria2c', value)}/>
      <NumberField label="Kết nối aria2c mỗi video" value={settings.aria2Connections} min={1} max={32} onChange={(value) => patch('aria2Connections', value)}/>
      <NumberField label="Tổng video tải đồng thời toàn ứng dụng" value={settings.maxGlobalDownloadWorkers} min={1} max={16} onChange={(value) => patch('maxGlobalDownloadWorkers', value)}/>
      <NumberField label="Fragment đồng thời mỗi video" value={settings.downloadConcurrentFragments} min={1} max={8} onChange={(value) => patch('downloadConcurrentFragments', value)}/>
    </Grid>
  </Block>;
}

function ProcessingSettings({ settings, patch, qualities, setError }: { settings: AppSettings; patch: Patch; qualities: QualityProfile[]; setError: (error: string | null) => void }): React.JSX.Element {
  const tools = useAppStore((state) => state.tools);
  const ffmpeg = tools.find((tool) => tool.name === 'ffmpeg');
  const cpuReady = Boolean(ffmpeg?.capabilities.includes('libx264'));
  const nvencReady = Boolean(ffmpeg?.capabilities.includes('h264_nvenc') || ffmpeg?.capabilities.includes('hevc_nvenc'));
  const nvencUnavailable = Boolean(ffmpeg?.capabilities.includes('h264_nvenc_unavailable') || ffmpeg?.capabilities.includes('hevc_nvenc_unavailable'));
  const selected = qualities.find((item) => item.id === settings.defaultQualityProfileId) ?? qualities[0];
  const [draft, setDraft] = useState<QualityProfile | null>(null);
  useEffect(() => {
    setDraft(selected
      ? { ...selected, id: createPersistentUiId('quality-custom'), name: `${selected.name} · Tùy chỉnh`, mode: 'custom', builtIn: false }
      : null);
  }, [selected]);
  const saveDraft = async (): Promise<void> => {
    if (!draft) return;
    try {
      const saved = await window.desktop.settings.saveQualityProfile({ ...draft, builtIn: false });
      useAppStore.setState({ qualities: [...qualities.filter((item) => item.id !== saved.id), saved] });
      patch('defaultQualityProfileId', saved.id);
      useAppStore.getState().setAttention({ id: createUiEventId('quality-profile'), severity: 'success', title: 'Đã lưu Cấu hình chất lượng', message: `Cấu hình ${saved.name} đã được chọn làm mặc định sau khi lưu cài đặt.`, sticky: false });
    } catch (error) { setError(messageOf(error)); }
  };
  if (!draft) return <Block title="Tải & Ghép · thành phẩm riêng" icon={SlidersHorizontal}><p>Không có cấu hình thành phẩm ghép.</p></Block>;
  return <Block title="Tải & Ghép · thành phẩm riêng" icon={SlidersHorizontal}>
    <InfoDisclosure className="settings-scope-disclosure mb-5" icon={SlidersHorizontal} title="Phạm vi: Tải & Ghép" summary="Chỉ quyết định video thành phẩm cuối." status="ĐỘC LẬP" tone="good">
      <p className="settings-detail-copy">Link Google Drive trong Tải & Ghép dùng cơ chế tải mặc định/nguyên bản của yt-dlp như code tham chiếu, không ép format source và không chịu giới hạn chất lượng của Tải danh sách. Các lựa chọn bên dưới chỉ quyết định cách tạo thành phẩm cuối.</p>
    </InfoDisclosure>
    <div className="mb-5 grid gap-4 lg:grid-cols-2"><Select label="Số quy trình tải & ghép hiển thị" value={String(settings.mergeLaneCount)} onChange={(value) => patch('mergeLaneCount', Number(value) as AppSettings['mergeLaneCount'])} options={[["1","1 quy trình"],["2","2 quy trình"],["3","3 quy trình"],["4","4 quy trình"]]}/><Select label="Quy trình ghép hoạt động đồng thời" value={String(settings.maxGlobalMergeJobs)} onChange={(value) => patch('maxGlobalMergeJobs', Number(value) as AppSettings['maxGlobalMergeJobs'])} options={[["1","1 quy trình (mượt nhất)"],["2","2 quy trình"],["3","3 quy trình"],["4","4 quy trình"]]}/></div>
    <details className="settings-inline-note mb-5"><summary>Cách giới hạn quy trình song song hoạt động<ChevronDown size={15}/></summary><p>Khi xuất 4K/HEVC, kiểm tra chuyên sâu hoặc chuẩn hóa nhiều nguồn, nên giữ giới hạn hoạt động thấp. Quy trình vượt giới hạn sẽ chờ lượt và không tranh tài nguyên.</p></details>
    <InfoDisclosure
      className="settings-encoder-disclosure mb-5"
      icon={Cpu}
      title="Mã hóa bằng bộ xử lý trung tâm tự động"
      summary="H.264 dùng libx264 · HEVC dùng libx265"
      status={cpuReady ? 'SẴN SÀNG' : 'CẦN KIỂM TRA'}
      tone={cpuReady ? (nvencUnavailable ? 'warning' : 'good') : 'warning'}
      autoOpen={!cpuReady || nvencUnavailable}
    >
      <p className="settings-detail-copy">NVENC chỉ chạy khi user ép chọn và kiểm tra thực tế thành công. {nvencUnavailable ? 'NVIDIA hiện không tương thích; tác vụ tự chuyển sang bộ xử lý trung tâm và không bị dừng.' : nvencReady ? 'NVENC đã vượt qua kiểm tra, nhưng CPU tự động vẫn là mặc định an toàn.' : 'Ứng dụng tiếp tục dùng CPU để ưu tiên tính ổn định.'}</p>
    </InfoDisclosure>
    <Select label="Cấu hình đang dùng" value={settings.defaultQualityProfileId} onChange={(value) => patch('defaultQualityProfileId', value)} options={qualities.map((item) => [item.id, item.name])}/>
    <h3 className="mb-3 mt-6 font-black">Tạo cấu hình chất lượng tùy chỉnh</h3>
    <Grid><Text label="Tên cấu hình" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })}/><Select label="Bộ mã hóa video" value={draft.videoCodec} onChange={(value) => setDraft({ ...draft, videoCodec: value as QualityProfile['videoCodec'] })} options={[['copy','Sao chép khi tương thích'],['h264','H.264'],['hevc','HEVC']]}/><Select label="Bộ mã hóa" value={draft.encoder} onChange={(value) => setDraft({ ...draft, encoder: value as QualityProfile['encoder'] })} options={[['cpu_auto','Bộ xử lý trung tâm tự động · khuyến nghị'],['auto','Tự động · ưu tiên bộ xử lý trung tâm'],['libx264','Bộ xử lý trung tâm cố định · libx264/libx265 theo codec'],['h264_nvenc','Ép H.264 NVENC · nâng cao'],['hevc_nvenc','Ép HEVC NVENC · nâng cao']]}/><Select label="Kiểm soát dung lượng khi phải mã hóa lại" value={draft.bitrateMode ?? 'quality'} onChange={(value) => setDraft({ ...draft, bitrateMode: value as NonNullable<QualityProfile['bitrateMode']> })} options={[['quality','Theo CRF/CQ · dung lượng có thể giảm mạnh'],['source_average','Theo dung lượng thật từng nguồn · khuyến nghị']]}/><Select label="FPS" value={draft.fpsMode} onChange={(value) => setDraft({ ...draft, fpsMode: value as QualityProfile['fpsMode'] })} options={[['source','Cao nhất theo nguồn'],['30','30'],['60','60'],['custom','Tùy chỉnh']]}/><NullableNumber label="Chiều rộng tối đa (trống = theo nguồn)" value={draft.maxWidth} onChange={(value) => setDraft({ ...draft, maxWidth: value })}/><NullableNumber label="Chiều cao tối đa (trống = theo nguồn)" value={draft.maxHeight} onChange={(value) => setDraft({ ...draft, maxHeight: value })}/><NullableNumber label="FPS tùy chỉnh" value={draft.customFps} onChange={(value) => setDraft({ ...draft, customFps: value })}/><NumberField label="CRF Bộ xử lý trung tâm" value={draft.crf} min={0} max={51} onChange={(value) => setDraft({ ...draft, crf: value })}/><NumberField label="CQ NVENC" value={draft.cq} min={0} max={51} onChange={(value) => setDraft({ ...draft, cq: value })}/><Text label="Mức tối ưu mã hóa" value={draft.preset} onChange={(value) => setDraft({ ...draft, preset: value })}/><Text label="Định dạng điểm ảnh" value={draft.pixelFormat} onChange={(value) => setDraft({ ...draft, pixelFormat: value })}/><Select label="HDR" value={draft.hdrMode} onChange={(value) => setDraft({ ...draft, hdrMode: value as QualityProfile['hdrMode'] })} options={[['auto','Tự động'],['keep','Giữ dải sáng HDR'],['tonemap_sdr','Chuyển SDR'],['forbid','Không HDR']]}/><Select label="Âm thanh" value={draft.audioMode} onChange={(value) => setDraft({ ...draft, audioMode: value as QualityProfile['audioMode'] })} options={[['copy_if_compatible','Sao chép nếu tương thích'],['aac_256','AAC 256k'],['aac_320','AAC 320k'],['mute','Tắt âm thanh'],['silent','Đường âm thanh im lặng']]}/><NumberField label="Tần số lấy mẫu" value={draft.sampleRate} min={8000} max={192000} onChange={(value) => setDraft({ ...draft, sampleRate: value })}/><Toggle label="Cho phép phóng lớn" checked={draft.allowUpscale} onChange={(value) => setDraft({ ...draft, allowUpscale: value })}/><Toggle label="Ép âm thanh nổi" checked={draft.forceStereo} onChange={(value) => setDraft({ ...draft, forceStereo: value })}/></Grid>
    <button className="btn btn-primary mt-5" onClick={() => void saveDraft()}><Save size={17}/>Lưu cấu hình chất lượng</button>
  </Block>;
}

function Storage({ settings, patch }: { settings: AppSettings; patch: Patch }): React.JSX.Element {
  return <Block title="Thư mục và bộ nhớ đệm" icon={HardDrive}><div className="space-y-4"><FolderField label="Thư mục nguồn mặc định" value={settings.defaultSourceFolder} onChange={(value) => patch('defaultSourceFolder', value)}/><FolderField label="Thư mục tạm mặc định" value={settings.defaultTempFolder} onChange={(value) => patch('defaultTempFolder', value)}/><FolderField label="Thư mục đầu ra mặc định" value={settings.defaultOutputFolder} onChange={(value) => patch('defaultOutputFolder', value)}/><Grid><Select label="Chính sách lưu nguồn" value={settings.sourceCachePolicy} onChange={(value) => patch('sourceCachePolicy', value as AppSettings['sourceCachePolicy'])} options={[['forever','Giữ vĩnh viễn'],['days','Giữ theo số ngày'],['project_complete','Xóa khi hoàn tất'],['manual','Chỉ xóa thủ công']]}/><NumberField label="Số ngày giữ bộ nhớ đệm" value={settings.sourceCacheDays} min={1} max={3650} onChange={(value) => patch('sourceCacheDays', value)}/></Grid></div></Block>;
}
function Verification({ settings, patch }: { settings: AppSettings; patch: Patch }): React.JSX.Element { return <Block title="Kiểm tra tệp và nhật ký" icon={ShieldCheck}><Grid><Select label="Mức kiểm tra mặc định" value={settings.verificationLevel} onChange={(value) => patch('verificationLevel', value as AppSettings['verificationLevel'])} options={[['fast','Nhanh'],['standard','Tiêu chuẩn'],['deep','Chuyên sâu']]}/><NumberField label="Giữ nhật ký (ngày)" value={settings.logRetentionDays} min={1} max={3650} onChange={(value) => patch('logRetentionDays', value)}/><NumberField label="Làm mới giao diện (mili giây)" value={settings.progressRefreshMs} min={100} max={5000} onChange={(value) => patch('progressRefreshMs', value)}/></Grid><p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>Tệp lỗi chỉ nằm tạm trong khu cách ly để bảo vệ thành phẩm; Tubmedia tự dọn sau khi hoàn tất, hủy hoặc xóa quy trình. Kiểm tra chuyên sâu giải mã toàn bộ tệp.</p></Block>; }
function UpdateSettings({ settings, patch }: { settings: AppSettings; patch: Patch }): React.JSX.Element { return <Block title="Cập nhật công cụ và ứng dụng" icon={Wrench}><p className="mb-4 text-xs leading-5" style={{ color: 'var(--muted)' }}>Bản cài đặt phát hành sẽ tự đọc máy chủ cập nhật đã đóng gói. Trường URL bên dưới chỉ dùng khi cần đổi sang máy chủ HTTPS riêng mà không build lại ứng dụng.</p><Grid><Text label="Địa chỉ danh sách cập nhật công cụ (cũ, không bắt buộc)" value={settings.toolManifestUrl} onChange={(value) => patch('toolManifestUrl', value)}/><Text label="Máy chủ cập nhật ứng dụng tùy chọn (HTTPS)" value={settings.appFeedUrl} onChange={(value) => patch('appFeedUrl', value)}/><Select label="Kênh cập nhật công cụ" value={settings.toolUpdateChannel} onChange={(value) => patch('toolUpdateChannel', value as AppSettings['toolUpdateChannel'])} options={[['stable','Ổn định'],['beta','Thử nghiệm']]}/><Select label="Kênh cập nhật ứng dụng" value={settings.appUpdateChannel} onChange={(value) => patch('appUpdateChannel', value as AppSettings['appUpdateChannel'])} options={[['stable','Ổn định'],['beta','Thử nghiệm']]}/><Toggle label="Tự kiểm tra cập nhật công cụ" checked={settings.autoCheckToolUpdates} onChange={(value) => patch('autoCheckToolUpdates', value)}/><Toggle label="Tự kiểm tra cập nhật ứng dụng khi khởi động và mỗi 6 giờ" checked={settings.autoCheckAppUpdates} onChange={(value) => patch('autoCheckAppUpdates', value)}/></Grid><p className="mt-4 text-xs leading-5" style={{ color: 'var(--muted)' }}>Khuyến nghị: để trống URL tùy chọn và build bản phát hành bằng <b>npm.cmd run release:windows</b>. Khi đó latest.yml/beta.yml và blockmap được tạo đồng bộ với installer.</p></Block>; }

function Block({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }): React.JSX.Element { return <div><h2 className="mb-5 flex items-center gap-2 text-lg font-black"><Icon size={20} style={{ color: 'var(--accent)' }}/>{title}</h2>{children}</div>; }
function Grid({ children }: { children: ReactNode }): React.JSX.Element { return <div className="grid gap-4 lg:grid-cols-2">{children}</div>; }
function Text({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }): React.JSX.Element { return <label><span className="label">{label}</span><input className="input" value={value} placeholder={placeholder} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}/></label>; }
function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }): React.JSX.Element { return <label><span className="label">{label}</span><input className="input" type="number" min={min} max={max} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}/></label>; }
function NullableNumber({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }): React.JSX.Element { return <label><span className="label">{label}</span><input className="input" type="number" value={value ?? ''} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value === '' ? null : Number(event.target.value))}/></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string,string]> }): React.JSX.Element { return <label><span className="label">{label}</span><select className="select" value={value} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): React.JSX.Element { return <label className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}><span className="text-sm font-bold">{label}</span><input type="checkbox" checked={checked} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)} className="h-5 w-5 accent-blue-500"/></label>; }
function Row({ a, b }: { a: string; b: string }): React.JSX.Element { return <div className="flex justify-between gap-3"><span style={{ color: 'var(--muted)' }}>{a}</span><b className="text-right">{b}</b></div>; }
