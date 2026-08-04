import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { isAttentionNoticeResolved, notificationDuration } from '@shared/utils/notification-policy';
import { useAppStore } from '../stores/app-store';
import { friendlyIssue } from '../utils/ui-error';

type Phase = 'entering' | 'visible' | 'leaving';

const EXIT_DURATION_MS = 280;
const MIN_REMAINING_MS = 180;

export function AttentionCenter(): React.JSX.Element | null {
  const error = useAppStore((state) => state.error);
  const attention = useAppStore((state) => state.attention);
  const jobs = useAppStore((state) => state.jobs);
  const queued = useAppStore((state) => state.attentionQueue.length);
  const setError = useAppStore((state) => state.setError);
  const dismissAttention = useAppStore((state) => state.dismissAttention);
  const [phase, setPhase] = useState<Phase>('entering');
  const [paused, setPaused] = useState(false);
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
  // Chỉ giữ cố định khi nguyên nhân vẫn đang chặn tác vụ.
  const sticky = Boolean(error || (attention?.sticky && !attentionResolved));
  const duration = notificationDuration(tone);

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
  const Icon =
    tone === 'error'
      ? XCircle
      : tone === 'warning'
        ? AlertTriangle
        : tone === 'success'
          ? CheckCircle2
          : Info;
  const style = { '--attention-duration': `${duration}ms` } as CSSProperties;

  return (
    <div
      className={`attention-center attention-${tone} attention-${phase}`}
      style={style}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      aria-live={tone === 'error' || tone === 'warning' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="attention-accent" aria-hidden="true" />
      <div className="attention-icon">
        <Icon size={23} />
      </div>
      <div className="attention-copy min-w-0 flex-1" key={key}>
        <div className="attention-heading">
          <div className="text-sm font-black">{title}</div>
          {sticky && <span className="attention-sticky-label">Cần xử lý</span>}
          {queued > 0 && <span className="attention-queue-label">+{queued}</span>}
        </div>
        <div className="mt-1 text-sm leading-5">{message}</div>
        {steps.length > 0 && (
          <ol className="mt-2 grid gap-1 text-xs">
            {steps.map((step, index) => (
              <li key={`${index}-${step}`}>
                <b>{index + 1}.</b> {step}
              </li>
            ))}
          </ol>
        )}
      </div>
      <button className="attention-close" aria-label="Đóng thông báo" onClick={beginClose}>
        <X size={18} />
      </button>
      {!sticky && <div className={`attention-life ${paused ? 'is-paused' : ''}`} aria-hidden="true" />}
    </div>
  );
}
