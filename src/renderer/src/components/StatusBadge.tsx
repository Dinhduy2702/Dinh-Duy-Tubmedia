import { CheckCircle2, CircleMinus, Clock3, Loader, Pause, SkipForward, TriangleAlert, XCircle } from 'lucide-react';
import { toneForStatus, type NoticeTone } from '@shared/utils/notice-tone';
import { statusLabel } from '../utils/vi-labels';

const SIZE = 13;

/** Biểu tượng riêng cho vài trạng thái quen thuộc; còn lại theo biểu tượng của mức. */
function statusIcon(status: string, tone: NoticeTone): React.JSX.Element {
  if (status.includes('pause')) return <Pause size={SIZE} aria-hidden="true" />;
  if (status.includes('skip')) return <SkipForward size={SIZE} aria-hidden="true" />;
  if (status.includes('pending') || status === 'draft' || status === 'ready' || status === 'idle') {
    return <Clock3 size={SIZE} aria-hidden="true" />;
  }
  if (tone === 'success') return <CheckCircle2 size={SIZE} aria-hidden="true" />;
  if (tone === 'error') return <XCircle size={SIZE} aria-hidden="true" />;
  if (tone === 'warning') return <TriangleAlert size={SIZE} aria-hidden="true" />;
  // Sửa lỗi (2026-09-23): icon "đang chạy" (downloading/processing/verifying/...) chưa từng có lớp
  // xoay từ khi StatusBadge được tạo — không phải hồi quy của hệ chuyển động Giai đoạn 2a, mà là một
  // thiếu sót có sẵn từ đầu (đã đối chiếu lịch sử git: file chỉ có đúng một lượt commit).
  if (tone === 'info') return <Loader className="animate-spin" size={SIZE} aria-hidden="true" />;
  return <CircleMinus size={SIZE} aria-hidden="true" />;
}

/**
 * Nhãn trạng thái: luôn có BIỂU TƯỢNG + CHỮ, màu theo mức (không dùng mỗi trạng thái một màu).
 * Trạng thái "đang chạy" dùng xanh dương; tạm dừng/đã hủy/bỏ qua là trung tính, không bao giờ đỏ.
 */
export function StatusBadge({ status, fixed = false }: { status: string; fixed?: boolean }): React.JSX.Element {
  const lower = status.toLowerCase();
  const tone = toneForStatus(lower);
  const label = statusLabel(status);

  return (
    <span
      className={`badge status-badge tone-${tone} status-badge-${lower.replace(/[^a-z0-9_-]/g, '-')} ${fixed ? 'status-badge-fixed' : ''}`.trim()}
      data-status={lower}
      data-tone={tone}
      title={label}
    >
      {statusIcon(lower, tone)}
      <span>{label}</span>
    </span>
  );
}
