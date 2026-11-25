import { useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Check,
  ChevronDown,
  Cookie,
  Copy,
  FolderOpen,
  RotateCcw,
  ShieldAlert,
  X
} from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import type { FriendlyIssue } from '../utils/ui-error';
import { ToneIcon } from './ui/ToneIcon';

export interface FriendlyIssueCardProps {
  issue: FriendlyIssue;
  /** Nút "Thử lại" khi thao tác cho phép thử lại. */
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
  /** Nút mở khung Cookies khi lỗi liên quan đăng nhập/cookies. */
  onCookies?: () => void;
  /** Nút đóng cho thông báo dạng banner. */
  onDismiss?: () => void;
  /** Nút bổ sung tuỳ ngữ cảnh (vd. Xuất báo cáo lỗi, Mở nhật ký...). */
  extraActions?: React.ReactNode;
  className?: string;
}

/**
 * 1.8.0: thẻ lỗi dùng chung toàn ứng dụng (QueuePage, Tải danh sách, Tải nhanh, Cắt/Ghép, Cập nhật, ErrorBanner).
 * Phân biệt rõ lỗi người dùng tự xử lý được (biểu tượng + màu cảnh báo, các bước đánh số, nút đường tắt) với lỗi
 * của chính ứng dụng (biểu tượng lỗi app + nút Mở thư mục báo cáo). Chi tiết kỹ thuật luôn thu gọn mặc định.
 */
export function FriendlyIssueCard({
  issue,
  onRetry,
  retryLabel,
  retryDisabled,
  onCookies,
  onDismiss,
  extraActions,
  className
}: FriendlyIssueCardProps): React.JSX.Element {
  const setPage = useAppStore((state) => state.setPage);
  const [copied, setCopied] = useState(false);

  const isAppFault = issue.kind === 'app-fault';
  const isUserAction = issue.kind === 'user-action';
  const tone = isAppFault ? 'error' : issue.tone;
  const technical = issue.technical.trim();
  const showDetails = Boolean(technical && (isAppFault || technical !== issue.message.trim()));
  const hasActions = Boolean(onRetry || onCookies || issue.action || isAppFault || extraActions);

  const copyTechnical = (): void => {
    void window.desktop?.app?.writeClipboard?.(technical).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div
      className={`friendly-issue-card blocking-card blocking-${tone}${isAppFault ? ' is-app-fault' : isUserAction ? ' is-user-action' : ''}${className ? ` ${className}` : ''}`}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      data-issue-kind={issue.kind ?? 'general'}
    >
      <span className="friendly-issue-icon" aria-hidden="true">
        {isAppFault ? (
          <Bug size={20} />
        ) : isUserAction && tone === 'error' ? (
          <ShieldAlert size={20} />
        ) : isUserAction ? (
          <AlertTriangle size={20} />
        ) : (
          <ToneIcon tone={tone} size={20} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="friendly-issue-head">
          <b>{issue.title}</b>
          {isAppFault && (
            <span className="friendly-issue-badge is-app-fault">Lỗi ứng dụng · Đã lưu báo cáo</span>
          )}
          {isUserAction && (
            <span className="friendly-issue-badge is-user-action">Cần bạn xử lý</span>
          )}
          {onDismiss && (
            <button
              type="button"
              className="btn btn-ghost friendly-issue-dismiss"
              onClick={onDismiss}
              aria-label="Đóng thông báo"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <p>{issue.message}</p>

        {issue.steps.length > 0 && (
          <ol className="friendly-issue-steps">
            {issue.steps.map((step, index) => (
              <li key={step}>
                {index + 1}. {step}
              </li>
            ))}
          </ol>
        )}

        {hasActions && (
          <div className="friendly-issue-actions">
            {onRetry && (
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={retryDisabled}
                onClick={onRetry}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {retryLabel ?? 'Thử lại'}
              </button>
            )}
            {onCookies && (
              <button type="button" className="btn btn-primary btn-small" onClick={onCookies}>
                <Cookie size={14} aria-hidden="true" />
                Mở 3 cách thêm cookies
              </button>
            )}
            {issue.action && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setPage(issue.action!.page)}
              >
                {issue.action.label}
              </button>
            )}
            {isAppFault && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => void window.desktop?.errorReport?.openAutoFolder?.()}
              >
                <FolderOpen size={14} aria-hidden="true" />
                Mở thư mục báo cáo
              </button>
            )}
            {extraActions}
          </div>
        )}

        {showDetails && (
          <details className="friendly-issue-details">
            <summary>
              <ChevronDown size={14} aria-hidden="true" />
              Chi tiết
            </summary>
            <div className="friendly-issue-technical">
              <pre>{technical}</pre>
              <button type="button" className="btn btn-small btn-ghost" onClick={copyTechnical}>
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied ? 'Đã sao chép' : 'Sao chép chi tiết'}
              </button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
