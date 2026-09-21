import type { ReactNode } from 'react';
import { NOTICE_TONE_LABEL, noticeAriaRole, type NoticeTone } from '@shared/utils/notice-tone';
import { ToneIcon } from './ToneIcon';

export interface NoticeProps {
  tone: NoticeTone;
  /** Tiêu đề ngắn (in đậm). */
  title?: string;
  /** Các bước người dùng nên làm tiếp. */
  steps?: readonly string[];
  /** Nút hoặc liên kết hành động (hiện bên dưới nội dung). */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * Khung thông báo trong trang. Luôn có BIỂU TƯỢNG + NHÃN CHỮ của mức ("Lỗi", "Cảnh báo", "Thông tin",
 * "Thành công", "Đã ghi nhận") nên không phụ thuộc vào màu. Màu do lớp tone-* (tokens.css) cấp.
 */
export function Notice({ tone, title, steps = [], action, className = '', children }: NoticeProps): React.JSX.Element {
  return (
    <div className={`notice tone-${tone} ${className}`.trim()} role={noticeAriaRole(tone)} data-tone={tone}>
      <span className="notice-icon">
        <ToneIcon tone={tone} />
      </span>
      <div className="notice-body">
        <div className="notice-head">
          <span className="tone-chip">{NOTICE_TONE_LABEL[tone]}</span>
          {title && <b className="notice-title">{title}</b>}
        </div>
        {children && <div>{children}</div>}
        {steps.length > 0 && (
          <ol className="notice-steps">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        {action && <div className="notice-action">{action}</div>}
      </div>
    </div>
  );
}
