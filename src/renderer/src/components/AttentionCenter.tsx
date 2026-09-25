import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { X, Cookie, Copy, DownloadCloud } from 'lucide-react';
import {
  ACTION_REQUIRED_WARNING_MIN_DURATION_MS,
  isAttentionNoticeResolved,
  noticeDisplayPolicy
} from '@shared/utils/notification-policy';
import { NOTICE_TONE_LABEL, noticeAriaRole, stripTypedMarker } from '@shared/utils/notice-tone';
import { ToneIcon } from './ui/ToneIcon';
import { useAppStore } from '../stores/app-store';
import { friendlyIssue } from '../utils/ui-error';

import { CookieManagerDialog } from './CookieManagerDialog';
type Phase = 'entering' | 'visible' | 'leaving';

const EXIT_DURATION_MS = 280;
const MIN_REMAINING_MS = 180;
/* TUBMEDIA_UPDATE_NOTICE_ACTIONABLE (2026-09-25): id do use-desktop-events.ts đặt cho thông báo phát
 * hiện bản cập nhật ("app-update-available:<version>" / "app-update-downloaded:<version>"). */
const UPDATE_ATTENTION_ID_PREFIX = 'app-update-';

export function AttentionCenter(): React.JSX.Element | null {
  const error = useAppStore((state) => state.error);
  const attention = useAppStore((state) => state.attention);
  const jobs = useAppStore((state) => state.jobs);
  const queued = useAppStore((state) => state.attentionQueue.length);
  const setError = useAppStore((state) => state.setError);
  const dismissAttention = useAppStore((state) => state.dismissAttention);
  const setPage = useAppStore((state) => state.setPage);
  const [phase, setPhase] = useState<Phase>('entering');
  const [paused, setPaused] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const removeTimer = useRef<number | null>(null);
  const remainingMs = useRef(0);

  const issue = useMemo(() => (error ? friendlyIssue(error) : null), [error]);
  const tone = issue?.tone ?? attention?.severity ?? 'info';
  const key = error
    ? `error:${issue?.tone ?? 'error'}:${issue?.title ?? ''}:${issue?.message ?? ''}`
    : attention
      ? `attention:${attention.id}`
      : '';
  const attentionResolved = attention ? isAttentionNoticeResolved(attention, jobs) : false;
  /* TUBMEDIA_R31N_NOTIFICATION_SPAM_COOKIE_ACTION: cookie blocker is directly actionable from the notification */
  const cookieAttention =
    !error &&
    ['AUTHENTICATION_REQUIRED', 'COOKIES_EXPIRED', 'BROWSER_COOKIE_DATABASE_LOCKED'].includes(
      attention?.code ?? ''
    );
  /* TUBMEDIA_UPDATE_NOTICE_ACTIONABLE (2026-09-25): phát hiện đúng bản cập nhật khiến người dùng phải
   * tự vào trang Cập nhật mới biết — thông báo trước đây tự tắt sau 4,8s (info) hoặc 3,6s (success),
   * không có nút bấm nào. Xử lý y hệt "cảnh báo cần hành động" (Vấn đề 1: chặn cookies) — giữ hiện tối
   * thiểu 12 giây và thêm nút đi thẳng tới Trung tâm cập nhật — nhưng GIỮ NGUYÊN màu info/success đúng
   * ngữ nghĩa (không đổi thành warning chỉ để mượn thời lượng hiện lâu hơn). */
  const updateAttention = !error && Boolean(attention?.id?.startsWith(UPDATE_ATTENTION_ID_PREFIX));
  // Quy tắc hiển thị duy nhất (notification-policy.ts): lỗi thật không tự tắt (đóng được, trừ khi nguyên nhân đã
  // được giải quyết); cảnh báo cần hành động hiện tối thiểu 12 giây; mức khác tự tắt nhanh. Trỏ chuột hoặc focus
  // vào thông báo sẽ tạm dừng đồng hồ đếm ngược.
  const display = noticeDisplayPolicy(
    {
      severity: tone,
      code: attention?.code ?? issue?.code,
      sticky: attention?.sticky,
      steps: attention?.steps ?? issue?.steps
    },
    !error && attentionResolved
  );
  const sticky = display.persistent;
  const duration = updateAttention
    ? Math.max(display.durationMs, ACTION_REQUIRED_WARNING_MIN_DURATION_MS)
    : display.durationMs;

  const clearTimers = useCallback((): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (removeTimer.current !== null) window.clearTimeout(removeTimer.current);
    closeTimer.current = null;
    removeTimer.current = null;
  }, []);

  const finishClose = useCallback((): void => {
    if (error) setError(null);
    else if (attention) dismissAttention(attention.id);
  }, [attention, dismissAttention, error, setError]);

  const beginClose = useCallback((): void => {
    if (!key || phase === 'leaving') return;
    clearTimers();
    setPhase('leaving');
    removeTimer.current = window.setTimeout(finishClose, EXIT_DURATION_MS);
  }, [clearTimers, finishClose, key, phase]);

  useEffect(() => {
    if (!attentionResolved || !attention || phase === 'leaving') return;
    beginClose();
  }, [attention, attentionResolved, beginClose, phase]);

  useEffect(() => {
    clearTimers();
    setPaused(false);
    setTechnicalOpen(false);
    remainingMs.current = duration;
    if (!key) return;
    setPhase('entering');
    // Hai frame giúp Chromium nhận trạng thái đầu trước khi chuyển sang visible,
    // tránh thông báo "nhảy" thẳng vào vị trí cuối khi máy đang bận.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPhase('visible'));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [clearTimers, duration, key]);

  useEffect(() => {
    if (!key || sticky || paused || phase !== 'visible') return;
    const startedAt = performance.now();
    const wait = Math.max(MIN_REMAINING_MS, remainingMs.current || duration);
    closeTimer.current = window.setTimeout(beginClose, wait);
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      const elapsed = performance.now() - startedAt;
      remainingMs.current = Math.max(MIN_REMAINING_MS, wait - elapsed);
    };
  }, [beginClose, duration, key, paused, phase, sticky]);

  useEffect(() => clearTimers, [clearTimers]);

  if (!error && !attention) return null;

  const title = issue?.title ?? attention?.title ?? 'Thông báo';
  const message = issue?.message ?? attention?.message ?? '';
  const steps = issue?.steps ?? attention?.steps ?? [];
  const style = { '--attention-duration': `${duration}ms` } as CSSProperties;
  // Giai đoạn 2 (2026-09-25) — Phát hiện kiến trúc số 3: `issue.technical` được tính sẵn nhưng trước
  // đây KHÔNG có nơi nào hiển thị ở khung thông báo chính — người dùng không có cách nào xem/sao chép
  // chi tiết kỹ thuật gốc để gửi hỗ trợ. Bỏ dấu kiểu nội bộ ([[tm:...]]) trước khi hiện; chỉ hiện khi có
  // nội dung và khác nội dung thân thiện đã hiện phía trên (tránh lặp vô ích).
  const technical = issue?.technical ? stripTypedMarker(issue.technical).trim() : '';
  const showTechnical = technical.length > 0 && technical !== message.trim();

  return (
    <>
      <div
        className={`attention-center tone-${tone} attention-${tone} attention-${phase}`}
        style={style}
        data-tone={tone}
        role={noticeAriaRole(tone)}
        aria-live={noticeAriaRole(tone) === 'alert' ? 'assertive' : 'polite'}
        aria-atomic="true"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <div className="attention-accent" aria-hidden="true" />
        <div className="attention-icon">
          <ToneIcon tone={tone} size={23} />
        </div>
        <div className="attention-copy min-w-0 flex-1" key={key}>
          <div className="attention-heading">
            <span className="tone-chip">{NOTICE_TONE_LABEL[tone]}</span>
            <div className="text-sm font-black">{title}</div>
            {sticky && <span className="attention-sticky-label">Cần xử lý</span>}
            {queued > 0 && <span className="attention-queue-label">+{queued}</span>}
          </div>
          <div className="mt-1 text-sm leading-5">{message}</div>
          {cookieAttention && (
            <button className="btn btn-primary mt-3" onClick={() => setCookieOpen(true)}>
              <Cookie size={16} />
              {'Thêm Cookies'}
            </button>
          )}
          {updateAttention && (
            <button
              className="btn btn-primary mt-3"
              onClick={() => {
                setPage('updates');
                beginClose();
              }}
            >
              <DownloadCloud size={16} />
              {'Cập nhật ngay'}
            </button>
          )}
          {steps.length > 0 && (
            <ol className="mt-2 grid gap-1 text-xs">
              {steps.map((step, index) => (
                <li key={`${index}-${step}`}>
                  <b>{index + 1}.</b> {step}
                </li>
              ))}
            </ol>
          )}
          {showTechnical && (
            <div className="mt-2">
              <button
                className="attention-technical-toggle"
                type="button"
                aria-expanded={technicalOpen}
                onClick={() => setTechnicalOpen((current) => !current)}
              >
                {technicalOpen ? 'Ẩn chi tiết kỹ thuật' : 'Xem chi tiết kỹ thuật'}
              </button>
              <div className={`attention-technical-wrap ${technicalOpen ? 'is-open' : ''}`}>
                <div>
                  <pre className="attention-technical">{technical}</pre>
                  <button
                    className="btn btn-small btn-ghost mt-1"
                    type="button"
                    onClick={() => void window.desktop.app.writeClipboard(technical)}
                  >
                    <Copy size={13} />
                    Sao chép
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <button className="attention-close" aria-label="Đóng thông báo" onClick={beginClose}>
          <X size={18} />
        </button>
        {!sticky && <div className={`attention-life ${paused ? 'is-paused' : ''}`} aria-hidden="true" />}
      </div>
      <CookieManagerDialog open={cookieOpen} onClose={() => setCookieOpen(false)} />
    </>
  );
}
