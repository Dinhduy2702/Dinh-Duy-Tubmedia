import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Vấn đề 3 (GĐ 2b, 2026-09-22) — chế độ sáng nhất quán theo token', () => {
  it('quick-download.css: khối phục hồi (.quick-download-recovery-block) không còn dùng --warning/--danger/--surface/--text-muted (KHÔNG tồn tại trong hệ token, luôn rơi về giá trị dự phòng cố định bất kể chế độ sáng/tối)', () => {
    const css = readFileSync(join(root, 'src/renderer/src/quick-download.css'), 'utf8');
    expect(css).not.toMatch(/var\(--warning(?=[,)\s])/);
    expect(css).not.toMatch(/var\(--danger(?=[,)\s])/);
    expect(css).not.toMatch(/var\(--surface(?=[,)\s])/);
    expect(css).not.toMatch(/var\(--text-muted(?=[,)\s])/);
    // Đổi đúng sang token thật đã có sẵn trong tokens.css (--warn/--bad/--panel2/--muted), khớp khối
    // cảnh báo liền kề .quick-download-ready-progress đã dùng đúng từ trước. Có 2 khối trùng lặp lịch sử
    // (R25 + R26, cùng nội dung) — cả hai phải được sửa, nên đếm số lần token thật xuất hiện phải ≥ 2.
    const warnMixCount = [...css.matchAll(/color-mix\(in srgb, var\(--warn\) \d+%, transparent\)/g)].length;
    const panel2InRecoveryCount = [...css.matchAll(/color-mix\(in srgb, var\(--warn\) \d+%, var\(--panel2\)\)/g)].length;
    const badMixCount = [...css.matchAll(/color-mix\(in srgb, var\(--bad\) \d+%, transparent\)/g)].length;
    expect(warnMixCount).toBeGreaterThanOrEqual(2);
    expect(panel2InRecoveryCount).toBeGreaterThanOrEqual(2);
    expect(badMixCount).toBeGreaterThanOrEqual(2);
  });

  it('không còn token undefined nào (--warning/--danger/--surface/--text-muted) trong bất kỳ tệp CSS nào của renderer', () => {
    const cssFiles = [
      'styles.css',
      'tubmedia-theme.css',
      'system-cleanup.css',
      'quick-download.css',
      'video-link-filter.css',
      'typography.css',
      'brand.css',
      'tokens.css',
      'motion.css',
      'logs-responsive-r35.css'
    ];
    for (const file of cssFiles) {
      const css = readFileSync(join(root, 'src/renderer/src', file), 'utf8');
      // (?=[,)\s]) tách khỏi các token THẬT có cùng tiền tố (--danger-solid, --warn...) — chỉ bắt đúng
      // tên biến "--warning"/"--danger"/"--surface"/"--text-muted" đứng riêng, không tồn tại trong tokens.css.
      expect(css, `${file} không được dùng var(--warning...)`).not.toMatch(/var\(--warning(?=[,)\s])/);
      expect(css, `${file} không được dùng var(--danger...)`).not.toMatch(/var\(--danger(?=[,)\s])/);
      expect(css, `${file} không được dùng var(--surface,`).not.toMatch(/var\(--surface(?=[,)\s])/);
      expect(css, `${file} không được dùng var(--text-muted...)`).not.toMatch(/var\(--text-muted(?=[,)\s])/);
    }
  });

  it('nhãn điều hướng của hành trình "Tải 1 video" (bước ②③) trỏ đúng tên trang/nhóm hiện tại (đã đổi ở lần điều chỉnh thanh bên 2026-09-22) — không còn nhắc "Tải & Ghép (đa làn)" hay "CÔNG CỤ NÂNG CAO" đã bị xoá', () => {
    const stepPreviewCut = readFileSync(join(root, 'src/renderer/src/pages/StepPreviewCutPage.tsx'), 'utf8');
    const stepMergeExport = readFileSync(join(root, 'src/renderer/src/pages/StepMergeExportPage.tsx'), 'utf8');
    for (const source of [stepPreviewCut, stepMergeExport]) {
      expect(source).not.toContain('Tải & Ghép (đa làn)');
      expect(source).not.toContain('CÔNG CỤ NÂNG CAO');
      expect(source).toContain('Ghép theo Timeline');
    }
  });
});
