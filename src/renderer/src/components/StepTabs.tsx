import { Download, Scissors, Sparkles } from 'lucide-react';
import { useAppStore, type PageId } from '../stores/app-store';

const STEPS: Array<{ id: PageId; step: number; label: string; icon: typeof Download }> = [
  { id: 'step-download', step: 1, label: 'Tải', icon: Download },
  { id: 'step-preview-cut', step: 2, label: 'Xem trước & Cắt', icon: Scissors },
  { id: 'step-merge-export', step: 3, label: 'Ghép & Xuất', icon: Sparkles }
];

/**
 * Thanh 3 bước ở góc phải tiêu đề trang (đặc tả GĐ 2a): Tải → Xem trước & Cắt → Ghép & Xuất. Mỗi vòng
 * tròn hiện đúng icon chức năng của bước đó (B4, 2026-09-24 — trước đây là số trần 1/2/3).
 */
export function StepTabs({ current }: { current: PageId }): React.JSX.Element {
  const setPage = useAppStore((state) => state.setPage);
  return <nav className="tm-step-tabs" aria-label="3 bước làm video">
    {STEPS.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        type="button"
        className={`tm-step-tab ${current === id ? 'is-active' : ''}`}
        aria-current={current === id ? 'step' : undefined}
        onClick={() => setPage(id)}
      >
        <span className="sidebar-step-badge" aria-hidden="true"><Icon size={12} /></span>
        <span className="tm-step-tab-label">{label}</span>
      </button>
    ))}
  </nav>;
}
