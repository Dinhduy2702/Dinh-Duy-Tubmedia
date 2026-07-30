import { HardDrive, ShieldCheck, Trash2 } from 'lucide-react';
import { SystemCleanupPanel } from '../components/SystemCleanupPanel';

export function SystemCleanupPage(): React.JSX.Element {
  return (
    <div className="page-shell system-cleanup-page">
      <section className="cleanup-page-hero">
        <div className="cleanup-page-hero-icon">
          <Trash2 size={27} />
        </div>
        <div>
          <span>BẢO TRÌ VÀ GIẢI PHÓNG DUNG LƯỢNG</span>
          <h1>Dọn dẹp máy</h1>
          <p>
            Quét file rác theo danh sách an toàn, xem rõ dung lượng và mức độ cần xóa trước khi thực hiện.
          </p>
        </div>
        <div className="cleanup-page-hero-badges">
          <b>
            <ShieldCheck size={15} />
            Chặn thư mục nguy hiểm
          </b>
          <b>
            <HardDrive size={15} />
            Quét trước khi xóa
          </b>
        </div>
      </section>

      <SystemCleanupPanel />
    </div>
  );
}
