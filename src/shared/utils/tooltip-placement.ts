/**
 * Vị trí ô chú thích (ⓘ, ⚠) — người dùng báo 2026-10-08 sau phần A: ô cũ LUÔN mở xuống dưới-trái icon bằng CSS, bị khung
 * cha cắt, lọt ra ngoài cửa sổ nhỏ và đè lên nội dung. Hàm này chọn phía theo khoảng trống THẬT quanh icon trong cửa sổ:
 * dưới → trên → phải → trái (phía đầu tiên đủ chỗ); không phía nào đủ thì lấy phía trên/dưới rộng hơn và giới hạn chiều cao
 * (cuộn bên trong). Kết quả luôn nằm gọn trong cửa sổ, cách mép TOOLTIP_MARGIN, không đè lên chính icon.
 */
export const TOOLTIP_MARGIN = 8;
export const TOOLTIP_GAP = 6;
export const TOOLTIP_MAX_WIDTH = 340;

export type TooltipPlacement = 'bottom' | 'top' | 'right' | 'left';

export interface TooltipAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PlacedTooltip {
  placement: TooltipPlacement;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Chỉ có khi không phía nào đủ chỗ: ô giới hạn chiều cao này và cuộn bên trong. */
  maxHeight?: number;
}

/** Chiều rộng tối đa của ô theo chiều rộng cửa sổ — cửa sổ hẹp thì ô hẹp lại và xuống dòng, không bị cắt chữ. */
export function tooltipMaxWidth(viewportWidth: number): number {
  return Math.max(0, Math.min(TOOLTIP_MAX_WIDTH, viewportWidth - 2 * TOOLTIP_MARGIN));
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Mọi vị trí đặt được, theo thứ tự ưu tiên dưới → trên → phải → trái, chỉ gồm các phía ĐỦ CHỖ; mỗi phía có 3 cách căn
 * (trên/dưới: theo mép trái icon, mép phải icon, giữa; phải/trái: theo đỉnh icon, đáy icon, giữa) — cách căn mặc định
 * đứng đầu. Không phía nào đủ thì trả về đúng một vị trí: phía trên/dưới rộng hơn, giới hạn chiều cao. Giao diện chọn
 * trong danh sách này vị trí che ít nội dung nhất (HoverTip); placeTooltip lấy vị trí đầu tiên.
 */
export function tooltipCandidates(
  anchor: TooltipAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): PlacedTooltip[] {
  const width = Math.min(size.width, tooltipMaxWidth(viewport.width));
  const height = size.height;
  const usableHeight = viewport.height - 2 * TOOLTIP_MARGIN;
  const space: Record<TooltipPlacement, number> = {
    bottom: viewport.height - TOOLTIP_MARGIN - (anchor.bottom + TOOLTIP_GAP),
    top: anchor.top - TOOLTIP_GAP - TOOLTIP_MARGIN,
    right: viewport.width - TOOLTIP_MARGIN - (anchor.right + TOOLTIP_GAP),
    left: anchor.left - TOOLTIP_GAP - TOOLTIP_MARGIN
  };
  const fits: Record<TooltipPlacement, boolean> = {
    bottom: space.bottom >= height,
    top: space.top >= height,
    right: space.right >= width && usableHeight >= height,
    left: space.left >= width && usableHeight >= height
  };

  type Align = 'start' | 'end' | 'center';
  const build = (placement: TooltipPlacement, maxHeight?: number, align: Align = 'start'): PlacedTooltip => {
    const shownHeight = maxHeight === undefined ? height : Math.min(height, maxHeight);
    const horizontalStart = { start: anchor.left, end: anchor.right - width, center: anchor.left + anchor.width / 2 - width / 2 }[align];
    const horizontal = clamp(horizontalStart, TOOLTIP_MARGIN, viewport.width - TOOLTIP_MARGIN - width);
    const verticalStart = {
      center: anchor.top + anchor.height / 2 - shownHeight / 2,
      start: anchor.top,
      end: anchor.bottom - shownHeight
    }[align];
    const vertical = clamp(verticalStart, TOOLTIP_MARGIN, viewport.height - TOOLTIP_MARGIN - shownHeight);
    const position = {
      bottom: { left: horizontal, top: anchor.bottom + TOOLTIP_GAP },
      top: { left: horizontal, top: anchor.top - TOOLTIP_GAP - shownHeight },
      right: { left: anchor.right + TOOLTIP_GAP, top: vertical },
      left: { left: anchor.left - TOOLTIP_GAP - width, top: vertical }
    }[placement];
    return {
      placement,
      left: Math.round(position.left),
      top: Math.round(position.top),
      width,
      height: shownHeight,
      ...(maxHeight === undefined ? {} : { maxHeight })
    };
  };

  const fitting = (['bottom', 'top', 'right', 'left'] as const).filter((placement) => fits[placement]);
  if (fitting.length > 0) {
    return fitting.flatMap((placement) =>
      placement === 'top' || placement === 'bottom'
        ? [build(placement), build(placement, undefined, 'end'), build(placement, undefined, 'center')]
        : [build(placement, undefined, 'center'), build(placement, undefined, 'start'), build(placement, undefined, 'end')]
    );
  }
  const fallback: TooltipPlacement = space.bottom >= space.top ? 'bottom' : 'top';
  return [build(fallback, Math.max(0, space[fallback]))];
}

export function placeTooltip(
  anchor: TooltipAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): PlacedTooltip {
  return tooltipCandidates(anchor, size, viewport)[0]!;
}
