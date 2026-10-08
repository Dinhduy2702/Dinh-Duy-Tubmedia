import { Info } from 'lucide-react';
import { HoverTip } from './HoverTip';

/**
 * Phần A rà soát giao diện (người dùng duyệt 2026-10-06): giải thích dài KHÔNG đứng cố định trên giao diện — chỉ một icon
 * ⓘ nhỏ, câu đầy đủ hiện trong ô chú thích nổi khi rê chuột hoặc focus bằng bàn phím (không chiếm chiều cao, không đẩy bố
 * cục); trình đọc màn hình đọc qua aria-label. Ô chú thích tự chọn phía và nằm gọn trong cửa sổ — xem HoverTip.
 */
export function InfoHint({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  return (
    <HoverTip text={text} className={`info-hint ${className}`.trim()}>
      <Info size={13} aria-hidden="true" />
    </HoverTip>
  );
}
