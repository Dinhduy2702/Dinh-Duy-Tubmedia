import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, X } from 'lucide-react';

type CompactDetailTone = 'neutral' | 'good' | 'warning' | 'danger' | 'info';

interface CompactDetailProps {
  label?: string;
  summary?: string;
  tone?: CompactDetailTone;
  children: ReactNode;
  className?: string;
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
}

const VIEWPORT_GAP = 12;
const POPOVER_MAX_WIDTH = 480;
const POPOVER_GAP = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function CompactDetail({
  label = 'Thông tin chi tiết',
  summary,
  tone = 'neutral',
  children,
  className = ''
}: CompactDetailProps): React.JSX.Element {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const open = hoverOpen || focusOpen || pinned;

  const clearCloseTimer = (): void => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openFromHover = (): void => {
    clearCloseTimer();
    setHoverOpen(true);
  };

  const closeFromHover = (): void => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setHoverOpen(false);
      closeTimerRef.current = null;
    }, 120);
  };

  const updatePosition = (): void => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;

    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(POPOVER_MAX_WIDTH, Math.max(260, window.innerWidth - VIEWPORT_GAP * 2));
    const measuredHeight = popoverRef.current?.getBoundingClientRect().height ?? 220;
    const roomBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_GAP;
    const top = roomBelow >= measuredHeight + POPOVER_GAP
      ? triggerRect.bottom + POPOVER_GAP
      : Math.max(VIEWPORT_GAP, triggerRect.top - measuredHeight - POPOVER_GAP);
    const preferredLeft = triggerRect.right - width;
    const left = clamp(preferredLeft, VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP);

    setPosition({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(frame);
  }, [open, children]);

  useEffect(() => {
    if (!open) return;

    const handleViewportChange = (): void => updatePosition();
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      setPinned(false);
      setHoverOpen(false);
      setFocusOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setPinned(false);
      setHoverOpen(false);
      setFocusOpen(false);
      triggerRef.current?.focus();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => () => clearCloseTimer(), []);

  const popoverStyle: CSSProperties = position
    ? { top: position.top, left: position.left, width: position.width }
    : { top: 0, left: 0, width: Math.min(POPOVER_MAX_WIDTH, 360), visibility: 'hidden' };

  return <span className={`compact-detail compact-detail-${tone} ${className}`.trim()}>
    {summary && <span className="compact-detail-summary">{summary}</span>}
    <button
      ref={triggerRef}
      type="button"
      className="compact-detail-trigger"
      aria-label={label}
      aria-expanded={open}
      aria-controls={id}
      title={`${label} · rê chuột hoặc bấm để xem`}
      onMouseEnter={openFromHover}
      onMouseLeave={closeFromHover}
      onFocus={() => setFocusOpen(true)}
      onBlur={() => setFocusOpen(false)}
      onClick={() => {
        clearCloseTimer();
        if (pinned) {
          setPinned(false);
          setHoverOpen(false);
          setFocusOpen(false);
          triggerRef.current?.blur();
          return;
        }
        setPinned(true);
      }}
    >
      <CircleAlert size={15}/>
    </button>
    {open && createPortal(
      <div
        ref={popoverRef}
        id={id}
        role="dialog"
        aria-label={label}
        className={`compact-detail-popover compact-detail-popover-${tone} ${pinned ? 'is-pinned' : ''}`}
        style={popoverStyle}
        onMouseEnter={openFromHover}
        onMouseLeave={closeFromHover}
      >
        <div className="compact-detail-popover-head">
          <b>{label}</b>
          <button
            type="button"
            className="compact-detail-close"
            aria-label="Đóng thông tin chi tiết"
            onClick={() => {
              setPinned(false);
              setHoverOpen(false);
              setFocusOpen(false);
            }}
          >
            <X size={14}/>
          </button>
        </div>
        <div className="compact-detail-popover-body">{children}</div>
      </div>,
      document.body
    )}
  </span>;
}
