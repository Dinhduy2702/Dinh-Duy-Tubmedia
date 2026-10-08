import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placeTooltip, TOOLTIP_MARGIN, tooltipCandidates, tooltipMaxWidth } from '../../src/shared/utils/tooltip-placement.js';

// Người dùng báo (2026-10-08) sau phần A: ô chú thích ⓘ che nội dung, "đứng" sai, và bị cắt ở cửa sổ nhỏ. Ô chú thích phải
// tự chọn phía (dưới/trên/phải/trái) theo khoảng trống THẬT quanh icon, luôn nằm gọn trong cửa sổ, co theo cửa sổ.

const viewport = { width: 900, height: 620 };
const icon = (left: number, top: number) => ({ left, top, right: left + 16, bottom: top + 16, width: 16, height: 16 });
const inside = (box: { left: number; top: number; width: number; height: number }, view = viewport) =>
  box.left >= TOOLTIP_MARGIN &&
  box.top >= TOOLTIP_MARGIN &&
  box.left + box.width <= view.width - TOOLTIP_MARGIN &&
  box.top + box.height <= view.height - TOOLTIP_MARGIN;

describe('placeTooltip — tự chọn phía và nằm gọn trong cửa sổ', () => {
  it('đủ chỗ phía dưới → đặt dưới icon, không đè lên icon', () => {
    const placed = placeTooltip(icon(100, 100), { width: 300, height: 80 }, viewport);
    expect(placed.placement).toBe('bottom');
    expect(placed.top).toBeGreaterThanOrEqual(116);
    expect(inside(placed)).toBe(true);
  });

  it('sát mép dưới cửa sổ → lật lên trên', () => {
    const placed = placeTooltip(icon(100, 590), { width: 300, height: 80 }, viewport);
    expect(placed.placement).toBe('top');
    expect(placed.top + placed.height).toBeLessThanOrEqual(590);
    expect(inside(placed)).toBe(true);
  });

  it('sát mép phải → dịch sang trái cho vừa cửa sổ (không lọt ra ngoài)', () => {
    const placed = placeTooltip(icon(870, 100), { width: 300, height: 80 }, viewport);
    expect(inside(placed)).toBe(true);
  });

  it('trên và dưới đều chật nhưng bên phải rộng → đặt bên phải', () => {
    const short = { width: 900, height: 140 };
    const placed = placeTooltip(icon(40, 62), { width: 300, height: 110 }, short);
    expect(placed.placement).toBe('right');
    expect(placed.left).toBeGreaterThanOrEqual(56);
    expect(inside(placed, short)).toBe(true);
  });

  it('không phía nào đủ chỗ → chọn phía rộng nhất, giới hạn chiều cao để vẫn nằm trong cửa sổ (cuộn bên trong)', () => {
    const tiny = { width: 360, height: 200 };
    const placed = placeTooltip(icon(170, 60), { width: 330, height: 400 }, tiny);
    expect(placed.maxHeight).toBeDefined();
    expect(inside(placed, tiny)).toBe(true);
  });

  it('liệt kê MỌI phía đủ chỗ (để giao diện chọn phía ít đè lên nút/ô nhất), phía nào cũng nằm gọn trong cửa sổ', () => {
    const all = tooltipCandidates(icon(420, 300), { width: 300, height: 80 }, viewport);
    expect([...new Set(all.map((item) => item.placement))]).toEqual(['bottom', 'top', 'right', 'left']);
    // Mỗi phía 3 cách căn (để tìm chỗ trống) — vẫn không đè lên icon.
    expect(all).toHaveLength(12);
    for (const item of all) {
      const overlapsIcon = item.left < 436 && item.left + item.width > 420 && item.top < 316 && item.top + item.height > 300;
      expect(overlapsIcon).toBe(false);
    }
    for (const item of all) expect(inside(item)).toBe(true);
  });

  it('chiều rộng tối đa co theo cửa sổ (cửa sổ hẹp không bị cắt chữ)', () => {
    expect(tooltipMaxWidth(1920)).toBe(340);
    expect(tooltipMaxWidth(320)).toBe(320 - 2 * TOOLTIP_MARGIN);
  });
});

describe('nối vào giao diện', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('ô chú thích vẽ ở lớp trên cùng (portal), role="tooltip", tính vị trí bằng placeTooltip', () => {
    const tip = read('src/renderer/src/components/HoverTip.tsx');
    expect(tip).toContain('createPortal(');
    expect(tip).toContain('role="tooltip"');
    expect(tip).toContain('tooltipCandidates(');
    // Chọn phía che ít nội dung nhất (nút/ô nhập, chữ, icon) trong các phía đủ chỗ.
    expect(tip).toContain('coveredContent(');
  });

  it('chỉ hiện khi rê vào/focus icon; ẩn khi rê ra, mất focus, Esc; cuộn/đổi kích thước cửa sổ thì tính lại vị trí (không tắt)', () => {
    const tip = read('src/renderer/src/components/HoverTip.tsx');
    for (const handler of ['onPointerEnter', 'onPointerLeave', 'onFocus', 'onBlur', "'Escape'"]) {
      expect(tip).toContain(handler);
    }
    expect(tip).toContain("window.addEventListener('scroll', reposition, true);");
    expect(tip).toContain("window.addEventListener('resize', reposition);");
  });

  it('ô chú thích không nhận chuột (không chặn nút bên dưới, không tự giữ mình mở)', () => {
    expect(read('src/renderer/src/styles.css')).toMatch(/\.hover-tip\{[^}]*pointer-events:none/);
  });

  it('ⓘ và ⚠ thư mục tạm dùng chung cùng dùng HoverTip; không còn ô chú thích CSS kiểu cũ', () => {
    expect(read('src/renderer/src/components/InfoHint.tsx')).toContain('<HoverTip');
    expect(read('src/renderer/src/components/FolderField.tsx')).toContain('<HoverTip');
    const css = read('src/renderer/src/styles.css');
    expect(css).not.toContain('.info-hint-tip{');
    expect(css).not.toContain('.shared-folder-tip{');
  });
});
