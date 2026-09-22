import { useMemo } from 'react';
import { FolderOpen, PackageCheck, Sparkles } from 'lucide-react';
import { StepTabs } from '../components/StepTabs';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { progressFillStyle } from '../utils/progress-style';
import { useAppStore } from '../stores/app-store';

function inputText(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

/** Bước ③ Ghép & Xuất — hành trình một video (điều hướng 3 bước, đặc tả GĐ 2a).
 * Hiện dữ liệu THẬT của hàng đợi ghép (đã dùng chung ProcessManager với Tải & Ghép đa làn) và trỏ sang
 * đó để thực hiện ghép/xuất — chưa nhân bản một bộ máy ghép video thứ hai ở giai đoạn này. */
export function StepMergeExportPage(): React.JSX.Element {
  const setPage = useAppStore((state) => state.setPage);
  // Không lọc TRỰC TIẾP trong selector: .filter() tạo mảng mới mỗi lần nên useAppStore luôn thấy giá trị
  // "khác", gây render lại vô hạn (React error #185). Lấy state.jobs (tham chiếu ổn định) rồi lọc bằng
  // useMemo, chỉ tính lại khi jobs thật sự đổi.
  const jobs = useAppStore((state) => state.jobs);
  const mergeJobs = useMemo(() => jobs.filter((job) => job.type === 'merge'), [jobs]);

  return <div className="page-shell step-merge-export-page">
    <div className="tm-step-heading">
      <div>
        <h1>Ghép & Xuất</h1>
        <p>Ghép các đoạn đã cắt và xuất thành phẩm cuối cùng.</p>
      </div>
      <StepTabs current="step-merge-export"/>
    </div>

    <Card icon={PackageCheck} title="Hàng đợi ghép" subtitle={`${mergeJobs.length} tác vụ ghép trong hệ thống`}>
      {mergeJobs.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Chưa có tác vụ ghép nào"
          description="Cắt xong ở bước ② thì mở Tải & Ghép (đa làn) để tạo và xuất quy trình ghép."
          action={<button type="button" className="btn btn-primary" onClick={() => setPage('step-preview-cut')}>Quay lại bước ② Xem trước & Cắt</button>}
        />
      ) : (
        <ul className="step-merge-job-list">
          {mergeJobs.map((job) => (
            <li key={job.id} className="tm-list-row">
              <div className="step-merge-job-row">
                <div className="min-w-0 flex-1">
                  <b className="truncate block">{inputText(job.input, 'displayName') || inputText(job.input, 'productName') || 'Quy trình ghép'}</b>
                  <div className="progress mt-1"><span style={progressFillStyle(job.progress)}/></div>
                </div>
                <StatusBadge status={job.status}/>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>

    <Card icon={Sparkles} title="Mở Tải & Ghép (đa làn)" subtitle="Chọn chất lượng xuất, theo dõi tiến độ và mở tệp kết quả">
      <div className="step-merge-cta">
        <p>Trang này chỉ tóm tắt; việc ghép và xuất thật diễn ra ở Tải & Ghép (đa làn) trong nhóm CÔNG CỤ NÂNG CAO.</p>
        <button type="button" className="btn btn-primary tm-btn-lg" onClick={() => setPage('download-merge')}>
          <FolderOpen size={16}/>
          Mở Tải & Ghép (đa làn)
        </button>
      </div>
    </Card>
  </div>;
}
