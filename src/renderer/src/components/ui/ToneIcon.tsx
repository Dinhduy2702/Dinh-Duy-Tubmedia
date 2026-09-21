import { AlertTriangle, CheckCircle2, CircleMinus, Info, XCircle } from 'lucide-react';
import type { NoticeTone } from '@shared/utils/notice-tone';

/**
 * Biểu tượng của từng mức. Hình dạng KHÁC NHAU theo mức (X, tam giác, i, dấu tích, dấu trừ)
 * để người dùng không phải phân biệt chỉ bằng màu.
 */
export function ToneIcon({ tone, size = 20 }: { tone: NoticeTone; size?: number }): React.JSX.Element {
  if (tone === 'error') return <XCircle size={size} aria-hidden="true" />;
  if (tone === 'warning') return <AlertTriangle size={size} aria-hidden="true" />;
  if (tone === 'success') return <CheckCircle2 size={size} aria-hidden="true" />;
  if (tone === 'neutral') return <CircleMinus size={size} aria-hidden="true" />;
  return <Info size={size} aria-hidden="true" />;
}
