import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Khám phá bản cài 1.5.0 (2026-10-05) #11: 4 nút trên thẻ công cụ nằm chung một hàng (~75px mỗi nút) nên chữ
// bị cắt "Mở th…", "Kiểm t…", "Khôi…", "Mới n…", và nút không có tooltip để đọc đủ.
const page = readFileSync('src/renderer/src/pages/ToolsPage.tsx', 'utf8');
const css = readFileSync('src/renderer/src/tubmedia-theme.css', 'utf8');

describe('#11 — nút trên thẻ công cụ đọc được đủ chữ', () => {
  it('mọi nút/ô tool-action-button đều có title (tooltip) nêu đủ nội dung', () => {
    const elements = page.match(/<(?:button|div) className="tool-action-button[^"]*"[^>]*>/g) ?? [];
    expect(elements.length).toBe(5);
    for (const element of elements) expect(element, element).toMatch(/\stitle=\{?["`'a-zA-Z]/);
  });

  it('nhóm nút xếp thành hai hàng (mỗi nhóm một hàng) thay vì dồn 4 nút vào một hàng', () => {
    // styles.css có `.tool-card>footer{display:flex}` (độ ưu tiên 0,1,1) — quy tắc chỉ dùng `.tool-card-actions`
    // (0,1,0) bị lấn át, footer vẫn là flex. Lần sửa đầu chỉ kiểm `.tool-card-actions` nên test xanh mà app thật
    // vẫn cắt chữ; phải kiểm đúng bộ chọn đủ mạnh.
    expect(readFileSync('src/renderer/src/styles.css', 'utf8')).toContain('.tool-card>footer{display:flex');
    const start = css.indexOf('.tool-card > footer.tool-card-actions {');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toMatch(/display:\s*grid;/);
    expect(rule).toMatch(/grid-template-columns:\s*1fr;/);
  });
});
