import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tooltipCandidates, tooltipMaxWidth, type PlacedTooltip } from '@shared/utils/tooltip-placement';

const CONTROLS = 'button, input, select, textarea, a[href], [role="checkbox"], [role="switch"], [role="button"], [role="tab"]';

/** Phần tử "có nội dung nhìn thấy" tại một điểm: có chữ trực tiếp, hoặc là hình/icon. Nền trống của thẻ/khung thì không. */
function visibleContent(element: Element): Element | null {
  const graphic = element.closest('svg, img, video, canvas');
  if (graphic) return graphic;
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return element;
  }
  return null;
}

const overlaps = (rect: DOMRect, box: PlacedTooltip): boolean =>
  rect.width > 0 &&
  rect.height > 0 &&
  rect.left < box.left + box.width &&
  rect.right > box.left &&
  rect.top < box.top + box.height &&
  rect.bottom > box.top;

/**
 * Mức ô chú thích sẽ che nội dung nếu đặt ở `box`:
 * - Chữ/ô tích thuộc CHÍNH khối chứa icon (dòng chữ đang được giải thích): 3 điểm mỗi phần tử, tính bằng giao nhau hình chữ
 *   nhật thật — chồm lên nửa dòng chữ cũng tính.
 * - Nội dung khác (lấy mẫu lưới 7×5 điểm, mỗi phần tử một lần): nút/ô nhập 2 điểm, chữ hoặc icon 1 điểm, nền trống 0.
 */
function coveredContent(box: PlacedTooltip, trigger: HTMLElement): number {
  const context = trigger.closest('label') ?? trigger.parentElement;
  let score = 0;
  if (context) {
    for (const element of context.querySelectorAll('*')) {
      if (trigger.contains(element)) continue;
      const counts = element.matches(CONTROLS) || visibleContent(element) === element;
      if (counts && overlaps(element.getBoundingClientRect(), box)) score += 3;
    }
  }
  const seen = new Set<Element>();
  for (const fx of [0.04, 0.2, 0.36, 0.5, 0.64, 0.8, 0.96]) {
    for (const fy of [0.08, 0.3, 0.5, 0.7, 0.92]) {
      const element = document
        .elementsFromPoint(box.left + box.width * fx, box.top + box.height * fy)
        .find((candidate) => !candidate.closest('.hover-tip'));
      if (!element || trigger.contains(element) || context?.contains(element)) continue;
      const control = element.closest(CONTROLS);
      const target = control && !control.contains(trigger) ? control : visibleContent(element);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      score += target === control ? 2 : 1;
    }
  }
  return score;
}

/**
 * Ô chú thích dùng chung cho icon ⓘ (InfoHint) và ⚠ thư mục tạm dùng chung (FolderField) — người dùng báo 2026-10-08 sau
 * phần A: ô CSS cũ là con của icon, luôn mở xuống dưới-trái, bị khung cha cắt, lọt ra ngoài cửa sổ nhỏ, đè lên nội dung và
 * "đứng" lại khi rê chuột sang chính ô.
 *
 * - Vẽ ở lớp trên cùng (portal vào body, position:fixed) → không khung cha nào cắt được.
 * - Đo khoảng trống thật quanh icon (tooltipCandidates): chỉ xét các phía đủ chỗ trong cửa sổ, chiều rộng co theo cửa sổ;
 *   trong các phía đó chọn phía CHE ÍT nội dung nhất — nút/ô nhập, chữ (kể cả chính dòng chữ đang được giải thích), icon
 *   (bằng nhau thì theo thứ tự dưới → trên → phải → trái).
 * - Không nhận chuột (CSS pointer-events:none): không chặn nút bên dưới, không tự giữ mình mở.
 * - Chỉ hiện khi rê vào hoặc focus icon; ẩn khi rê ra, mất focus hoặc bấm Esc. Cuộn trang/đổi kích thước cửa sổ thì TÍNH
 *   LẠI vị trí (không tắt) — trang còn trôi sau khi con trỏ dừng trên icon không được làm ô biến mất.
 */
export function HoverTip({
  text,
  className,
  tone = 'info',
  children
}: {
  text: string;
  className: string;
  tone?: 'info' | 'warning';
  children: ReactNode;
}): React.JSX.Element {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<PlacedTooltip | null>(null);
  const id = useId();

  const show = (): void => setOpen(true);
  const hide = (): void => {
    setOpen(false);
    setPlaced(null);
  };

  // Lần vẽ đầu ô ẩn (visibility:hidden) ở góc cửa sổ với chiều rộng tối đa theo cửa sổ → đo kích thước thật → đặt vị trí.
  useLayoutEffect(() => {
    if (!open || placed || !triggerRef.current || !tipRef.current) return;
    const trigger = triggerRef.current;
    const tip = tipRef.current.getBoundingClientRect();
    const candidates = tooltipCandidates(trigger.getBoundingClientRect(), { width: Math.ceil(tip.width), height: Math.ceil(tip.height) }, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    let best = candidates[0]!;
    let bestScore = candidates.length > 1 ? coveredContent(best, trigger) : 0;
    for (const candidate of candidates.slice(1)) {
      if (bestScore === 0) break;
      const score = coveredContent(candidate, trigger);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    setPlaced(best);
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    const reposition = (): void => setPlaced(null);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Escape') hide();
  };

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        role="img"
        tabIndex={0}
        aria-label={text}
        aria-describedby={open ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={onKeyDown}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`hover-tip hover-tip-${tone}`}
            data-placement={placed?.placement}
            style={
              placed
                ? {
                    left: placed.left,
                    top: placed.top,
                    width: placed.width,
                    ...(placed.maxHeight === undefined ? {} : { maxHeight: placed.maxHeight })
                  }
                : { left: 0, top: 0, maxWidth: tooltipMaxWidth(window.innerWidth), visibility: 'hidden' }
            }
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
