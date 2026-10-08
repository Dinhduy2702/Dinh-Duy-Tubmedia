import { Info } from 'lucide-react';

/**
 * Phần A rà soát giao diện (người dùng duyệt 2026-10-06): giải thích dài KHÔNG đứng cố định trên giao diện — chỉ một icon
 * ⓘ nhỏ, câu đầy đủ hiện trong ô chú thích nổi khi rê chuột hoặc focus bằng bàn phím (không chiếm chiều cao, không đẩy bố
 * cục); trình đọc màn hình đọc qua aria-label.
 */
export function InfoHint({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  return (
    <span className={`info-hint ${className}`.trim()} role="img" tabIndex={0} aria-label={text}>
      <Info size={13} aria-hidden="true" />
      <span className="info-hint-tip" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
