import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (path: string): string => readFileSync(join(root, path), 'utf8');
const motion = text('src/renderer/src/motion.css');

describe('hệ thống chuyển động — token một chỗ (GĐ 2a, hạng mục B)', () => {
  it('nhanh 120ms, thường 220ms, chậm 360ms; đường cong vào/ra cubic-bezier(0.32, 0.72, 0, 1)', () => {
    expect(motion).toContain('--motion-fast: 120ms;');
    expect(motion).toContain('--motion-normal: 220ms;');
    expect(motion).toContain('--motion-slow: 360ms;');
    expect(motion).toContain('--motion-ease: cubic-bezier(0.32, 0.72, 0, 1);');
    // --ease-out (dùng khắp CSS cũ) trỏ vào token mới để không phải sửa từng chỗ.
    expect(motion).toContain('--ease-out: var(--motion-ease);');
  });

  it('bỏ backdrop-filter/blur nặng ở các lớp phủ chính (hộp thoại, thông báo, thanh trên)', () => {
    expect(motion).toMatch(
      /\.dialog-overlay,\s*\n\.cookie-dialog-overlay,\s*\n\.confirm-overlay,\s*\n\.attention-center,\s*\n\.app-topbar\s*\{\s*\n\s*backdrop-filter:\s*none;/
    );
  });

  it('thanh tiến độ tô bằng transform (compositor-only), không animate width', () => {
    expect(motion).toMatch(/\.progress > span\s*\{[^}]*transform-origin:\s*left center;[^}]*transition:\s*transform var\(--motion-normal\)/s);
    const progressStyle = text('src/renderer/src/utils/progress-style.ts');
    expect(progressStyle).toContain('transform: `scaleX(');
    expect(progressStyle).toMatch(/return \{ transform: `scaleX\([^`]*\)` \};/);
  });

  it('giảm chuyển động: prefers-reduced-motion VÀ lớp :root.reduce-motion (tùy chọn Cài đặt) đều đưa animation/transition về gần như tức thì', () => {
    expect(motion).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\n\s*\*::before,\s*\n\s*\*::after\s*\{\s*\n\s*animation-duration:\s*0\.01ms !important;/);
    expect(motion).toContain(':root.reduce-motion *,');
    expect(motion).toContain('animation-duration: 0.01ms !important;');
  });

  it('mốc responsive hợp nhất cho khung chính: 920 / 1100 / 1440px; nội dung rộng tối đa 1600px và căn giữa', () => {
    expect(motion).toMatch(/\.page-shell\s*\{[^}]*max-width:\s*1600px;[^}]*margin-inline:\s*auto;/s);
    expect(motion).toContain('@media (max-width: 1440px) {');
    expect(motion).toContain('@media (max-width: 1100px) {');
    expect(motion).toContain('@media (max-width: 920px) {');
  });

  it('thanh bên thu gọn ở 1100px đè cả min-width (CSS cũ .editor-sidebar đặt min-width: 248px không kèm media query, luôn bật)', () => {
    expect(motion).toMatch(/@media \(max-width: 1100px\)\s*\{\s*\n\s*\.app-sidebar\s*\{[^}]*width:\s*84px !important;[^}]*min-width:\s*84px !important;/s);
  });

  it('kích thước chuẩn: ô nhập/nút cao 44px bo góc 10px, thẻ bo góc 14px, nút chính lớn 52px — trừ nút nhỏ/nút biểu tượng', () => {
    expect(motion).toMatch(/\.input,\s*\n\.select,\s*\n\.textarea,\s*\n\.btn:not\(\.btn-small\):not\(\.icon-action\)\s*\{\s*\n\s*min-height:\s*44px;\s*\n\s*border-radius:\s*10px;/);
    expect(motion).toMatch(/\.tm-btn-lg\s*\{\s*\n\s*min-height:\s*52px;/);
  });

  it('hộp thoại vào bằng scale 0.96→1 (bản cũ 0.985 quá nhẹ)', () => {
    expect(motion).toMatch(/@keyframes tubmedia-dialog-in \{\s*\n\s*from \{\s*\n\s*opacity:\s*0;\s*\n\s*transform:[^;]*scale\(0\.96\);/);
  });

  it('motion.css không đụng token màu (chỉ tokens.css/brand.css quyết định màu — xem color-tokens.test.ts)', () => {
    expect(motion).not.toMatch(/--(tone|surface|action|sidebar|danger|logo)-[a-z-]*:\s*#/);
  });
});

describe('cỡ chữ và giảm hiệu ứng chuyển động — tùy chọn thật trong Cài đặt (đặc tả GĐ 2a)', () => {
  const domain = text('src/shared/types/domain.ts');
  const schema = text('src/shared/schemas/ipc.ts');
  const defaults = text('src/main/settings/defaults.ts');
  const settingsPage = text('src/renderer/src/pages/SettingsPage.tsx');
  const app = text('src/renderer/src/app/App.tsx');
  const typography = text('src/renderer/src/typography.css');

  it('AppSettings có fontSize (Vừa/Lớn/Rất lớn) và reduceMotion; schema IPC và giá trị mặc định khớp', () => {
    expect(domain).toContain("export type AppFontSize = 'medium' | 'large' | 'xlarge';");
    expect(domain).toMatch(/fontSize:\s*AppFontSize;/);
    expect(domain).toMatch(/reduceMotion:\s*boolean;/);
    expect(schema).toContain("fontSize: z.enum(['medium', 'large', 'xlarge']),");
    expect(schema).toContain('reduceMotion: z.boolean(),');
    expect(defaults).toContain("fontSize: 'medium',");
    expect(defaults).toContain('reduceMotion: false,');
  });

  it('trang Cài đặt có ô chọn cỡ chữ và bật/tắt giảm hiệu ứng chuyển động, nối với patch() thật', () => {
    expect(settingsPage).toContain("label=\"Cỡ chữ\"");
    expect(settingsPage).toContain("patch('fontSize', value as AppSettings['fontSize'])");
    expect(settingsPage).toContain('label="Giảm hiệu ứng chuyển động"');
    expect(settingsPage).toContain("patch('reduceMotion', value)");
  });

  it('App.tsx gắn data-font-size và lớp reduce-motion vào <html> theo cài đặt thật', () => {
    expect(app).toContain("document.documentElement.classList.toggle('reduce-motion', settings?.reduceMotion === true);");
    expect(app).toContain("document.documentElement.setAttribute('data-font-size', settings?.fontSize ?? 'medium');");
  });

  it('cỡ chữ mặc định 15px (Vừa); "Lớn"/"Rất lớn" đổi gốc rem để mọi chữ theo hệ --type-* co giãn theo', () => {
    expect(typography).toContain('--type-body: 0.9375rem'); // 15px
    const motionCss = text('src/renderer/src/motion.css');
    expect(motionCss).toContain("[data-font-size='large']");
    expect(motionCss).toContain("[data-font-size='xlarge']");
  });
});
