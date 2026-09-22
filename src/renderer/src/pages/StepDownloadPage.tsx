import { StepTabs } from '../components/StepTabs';
import { QuickDownloadPanel } from '../components/QuickDownloadPanel';

/** Bước ① Tải — hành trình một video (điều hướng 3 bước, đặc tả GĐ 2a). */
export function StepDownloadPage(): React.JSX.Element {
  return <div className="page-shell step-download-page">
    <div className="tm-step-heading">
      <div>
        <h1>Tải</h1>
        <p>Dán một liên kết video, chọn đoạn cần dùng (tùy chọn) rồi tải về máy.</p>
      </div>
      <StepTabs current="step-download"/>
    </div>
    <QuickDownloadPanel/>
  </div>;
}
