import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { SourceCleanupPreview, SourceCleanupResult } from '@shared/types/domain';
import { ConfirmDialog } from './ConfirmDialog';

function formatCleanupBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index >= 2 ? 2 : 0)} ${units[index]}`;
}

export interface SourceCleanupActionProps {
  projectId: string;
  askHint?: boolean;
  disabled?: boolean;
  onCleaned?: (result: SourceCleanupResult) => void;
  onError?: (message: string) => void;
}

export function SourceCleanupAction({
  projectId,
  askHint = false,
  disabled = false,
  onCleaned,
  onError
}: SourceCleanupActionProps): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<SourceCleanupPreview | null>(null);

  const openPreview = async (): Promise<void> => {
    setLoading(true);
    try {
      const next = await window.desktop.workbench.previewSourceCleanup(projectId);
      setPreview(next);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const confirmCleanup = async (): Promise<void> => {
    if (!preview?.canTrash) {
      setPreview(null);
      return;
    }
    setRunning(true);
    try {
      const result = await window.desktop.workbench.runSourceCleanup(projectId);
      setPreview(null);
      onCleaned?.(result);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const keptSummary =
    preview && preview.keptItems.length > 0
      ? `Giữ lại tự động ${preview.keptItems.length} tệp (${preview.keptItems
          .slice(0, 3)
          .map((item) => `${item.name}: ${item.reasonLabel}`)
          .join('; ')}${preview.keptItems.length > 3 ? '…' : ''}).`
      : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {askHint && (
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Thành phẩm đã hậu kiểm đạt — bạn có thể giải phóng dung lượng nguồn:
          </span>
        )}
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled || loading || running}
          onClick={() => void openPreview()}
        >
          {loading ? <LoaderCircle className="animate-spin" size={15} /> : null}
          🧹 Dọn video nguồn của danh sách này
        </button>
      </div>
      <ConfirmDialog
        open={preview !== null}
        title={
          preview?.canTrash
            ? `Chuyển ${preview.eligibleCount} video nguồn vào Thùng rác?`
            : 'Chưa thể dọn video nguồn của danh sách này'
        }
        message={
          preview?.canTrash
            ? `Tubmedia sẽ chuyển ${preview.eligibleCount} video nguồn (tổng ${formatCleanupBytes(preview.eligibleBytes)}) của danh sách này vào Thùng rác và dọn bộ nhớ đệm chuẩn hoá liên quan.`
            : (preview?.blockedReason ?? 'Không có video nguồn nào đủ điều kiện dọn an toàn.')
        }
        details={
          preview?.canTrash
            ? [
                'Video thành phẩm MP4, tệp Timeline TXT và tệp cá nhân của bạn được giữ nguyên 100%.',
                ...(keptSummary ? [keptSummary] : []),
                'Các video nguồn được chuyển vào Thùng rác. Nếu sau này bạn dán lại các liên kết này để ghép mới, Tubmedia sẽ tải lại từ mạng.'
              ]
            : keptSummary
              ? [keptSummary]
              : []
        }
        confirmLabel={preview?.canTrash ? 'Chuyển vào Thùng rác' : 'Đã hiểu'}
        cancelLabel="Quay lại"
        busy={running}
        onCancel={() => setPreview(null)}
        onConfirm={() => void confirmCleanup()}
      />
    </>
  );
}
