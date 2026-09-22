import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = readFileSync(join(root, 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');

/** Nội dung hàm/khối JSX (từ dòng đầu khớp `startMarker` tới độ thụt lùi về mức mở đầu). */
function block(marker: string, length = 12_000): string {
  const start = source.indexOf(marker);
  expect(start, `không thấy "${marker}"`).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + length);
}

describe('Kéo-thả sắp lại thứ tự ghép (GĐ 2b) — Ghép theo Timeline', () => {
  it('dùng HTML5 Drag and Drop có sẵn của trình duyệt, KHÔNG thêm thư viện', () => {
    expect(source).not.toMatch(/react-beautiful-dnd|@dnd-kit|react-dnd|sortablejs|react-sortable/i);
    const panel = block('function MergeProductionPanel');
    expect(panel).toContain('draggable={Boolean(onReorder)}');
    expect(panel).toContain('onDragStart=');
    expect(panel).toContain('onDragOver=');
    expect(panel).toContain('onDrop=');
    expect(panel).toContain('onDragEnd=');
    expect(panel).toContain('<GripVertical');
  });

  it('chỉ đổi THỨ TỰ dòng (item.originalText), không đổi nội dung/cú pháp từng dòng hay cách phân tích (parseInputText)', () => {
    const panel = block('function MergeProductionPanel');
    expect(panel).toContain('function reorderTo(sourceIndex: number, targetIndex: number): void {');
    expect(panel).toContain('const next = items.map((item) => item.originalText);');
    expect(panel).toContain('const [moved] = next.splice(sourceIndex, 1);');
    expect(panel).toContain('next.splice(targetIndex, 0, moved);');
    expect(panel).toContain("onReorder(next.join('\\n'));");
    // items vẫn lấy từ parseInputText(form.linksText) y hệt trước đây — không viết lại logic phân tích.
    expect(panel).toContain('const items = parseInputText(form.linksText).filter((item) => item.validity !== \'invalid\');');
  });

  it('lấy vị trí nguồn từ event.dataTransfer khi thả (KHÔNG đọc dragIndex trong React state) — tránh sai do state chưa kịp cập nhật giữa dragstart và drop', () => {
    const panel = block('function MergeProductionPanel');
    expect(panel).toContain("const DRAG_MIME = 'application/x-tubmedia-merge-index';");
    expect(panel).toContain('event.dataTransfer.setData(DRAG_MIME, String(index));');
    expect(panel).toContain('const sourceIndex = Number(event.dataTransfer.getData(DRAG_MIME));');
    expect(panel).toContain('reorderTo(sourceIndex, index);');
  });

  it('chỉ áp dụng khi danh sách CHƯA có timeline thật tính từ job (không đụng timelineRows đã tính)', () => {
    const panel = block('function MergeProductionPanel');
    const reorderRegionStart = panel.indexOf(': items.map((item, index) => (');
    expect(reorderRegionStart).toBeGreaterThan(0);
    const beforeReorder = panel.slice(0, reorderRegionStart);
    expect(beforeReorder).toContain('hasActualTimeline');
    expect(beforeReorder).toContain('? timelineRows.map((row) =>'); // nhánh timeline thật KHÔNG có kéo-thả
  });

  it('khóa kéo-thả khi làn đang chạy/tạm dừng/bận (locked) — giống các nút Dán/TXT hiện có', () => {
    const laneCard = block('function MergeLaneCard', 45_000);
    // Dán/TXT dùng chung điều kiện khóa
    expect(laneCard).toMatch(/disabled=\{locked\}[\s\S]{0,40}onClick=\{\(\) => void paste\(\)\}/);
    expect(laneCard).toMatch(/onReorder: \(text: string\) => update\(\(current\) => \(\{ \.\.\.current, linksText: text \}\)\)/);
    // onReorder chỉ truyền khi KHÔNG locked (spread có điều kiện, không truyền onReorder=undefined).
    expect(laneCard).toContain('{...(locked ? {} : { onReorder:');
  });

  it('gợi ý kéo-thả chỉ hiện khi có onReorder và chưa có timeline thật', () => {
    const panel = block('function MergeProductionPanel');
    expect(panel).toContain("onReorder ? 'Kéo ⠿ để đổi thứ tự ghép'");
  });

  it('motion.css: hiệu ứng kéo chỉ opacity/transform, tay cầm dùng token màu chữ phụ', () => {
    const motion = readFileSync(join(root, 'src/renderer/src/motion.css'), 'utf8');
    expect(motion).toMatch(/\.merge-timeline-row\.is-dragging\s*\{\s*opacity:\s*0\.45;/);
    expect(motion).toMatch(/\.merge-timeline-row\.is-drag-over\s*\{\s*transform:/);
    expect(motion).not.toMatch(/\.merge-timeline-row\.is-(dragging|drag-over|reorderable)[^}]*\b(width|height|top|left|box-shadow|filter):/);
  });
});
