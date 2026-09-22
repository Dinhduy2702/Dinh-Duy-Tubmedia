import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): Promise<string> => readFile(join(process.cwd(), path), 'utf8');

/** Lấy nội dung của khối `@keyframes <tên> { ... }` (có lồng dấu ngoặc). */
function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  expect(start, `thiếu @keyframes ${name}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  throw new Error(`@keyframes ${name} không đóng`);
}

/** Toàn bộ phần CSS của thẻ "Phát triển bởi" trong brand.css. */
function cardCss(css: string): string {
  const start = css.indexOf('/* ---- Thẻ "Phát triển bởi"');
  const end = css.indexOf('/* ---- Mục "Bộ nhận diện"');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('thẻ "Phát triển bởi" ở cuối thanh bên', () => {
  it('biểu tượng to, đứng riêng bên trái; chữ sắp thành 3 dòng: nhãn nhỏ, tên đậm, dòng phụ', async () => {
    const component = await read('src/renderer/src/components/TubmediaBrand.tsx');
    expect(component).toContain('<span className="dev-card-mark" aria-hidden="true"><TubmediaMark size={60}/></span>');
    const order = ['dev-card-eyebrow">PHÁT TRIỂN BỞI', 'dev-card-name">Đình Duy', 'dev-card-product">TUBMEDIA'].map((piece) => component.indexOf(piece));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // đã bỏ dòng khẩu hiệu và đường kẻ làm thẻ chật
    expect(component).not.toContain('TẢI · XỬ LÝ · GHÉP VIDEO');
    expect(component).not.toContain('developer-signature');
    expect(component).toContain('aria-label="Tubmedia phát triển bởi Đình Duy"');
  });

  it('biểu tượng lớn hơn hẳn bản cũ (44–58 px) và có khoảng đệm quanh', async () => {
    const [component, css] = await Promise.all([read('src/renderer/src/components/TubmediaBrand.tsx'), read('src/renderer/src/brand.css')]);
    expect(Number(/<TubmediaMark size=\{(\d+)\}\/><\/span>/.exec(component)?.[1])).toBeGreaterThanOrEqual(60);
    expect(cardCss(css)).toMatch(/\.dev-card-mark\s*\{[^}]*padding:\s*0\.3rem 0\.2rem/);
    expect(cardCss(css)).toMatch(/\.dev-card\s*\{[^}]*padding:\s*0\.85rem 0\.9rem 0\.85rem 0\.75rem/);
  });

  it('chữ theo thứ bậc: nhãn hoa nhỏ xám, tên trắng đậm cỡ lớn hơn, dòng phụ nhỏ xám', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).toMatch(/\.dev-card-eyebrow\s*\{[^}]*color:\s*var\(--sidebar-muted\)/);
    expect(css).toMatch(/\.dev-card-name\s*\{[^}]*color:\s*var\(--sidebar-text\)[^}]*font-size:\s*1\.15rem[^}]*font-weight:\s*800/);
    expect(css).toMatch(/\.dev-card-eyebrow,\s*\.dev-card-product\s*\{[^}]*font-size:\s*0\.62rem/);
    expect(css).toMatch(/\.dev-card-product\s*\{[^}]*var\(--sidebar-muted\)/);
  });

  it('nền đen than, KHÔNG dùng màu đỏ hay gradient đỏ: chỉ token thanh bên, không mã màu viết cứng', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).toMatch(/\.dev-card\s*\{[^}]*background:[^;]*linear-gradient\([^;]*var\(--sidebar-bg\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/--logo-red|--tone-error|--danger|--bad|\bred\b|rgba?\(/i);
    for (const bad of ['#ff3143', '#d8071c', '#a90013']) expect(css.toLowerCase()).not.toContain(bad);
  });

  it('viền sáng nhẹ dùng token trung tính; viền khi trỏ chuột chỉ đổi opacity', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).toMatch(/\.dev-card\s*\{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--sidebar-text\)/);
    expect(css).toMatch(/\.dev-card::after\s*\{[^}]*opacity:\s*0[^}]*transition:\s*opacity/);
    expect(css).toMatch(/\.dev-card:hover::after\s*\{\s*opacity:\s*1/);
  });
});

describe('vệt sáng của thẻ: nhẹ, có giới hạn, tôn trọng giảm chuyển động', () => {
  it('chỉ animate transform và opacity (không box-shadow, filter, blur, màu, kích thước)', async () => {
    const css = await read('src/renderer/src/brand.css');
    for (const name of ['dev-card-glint-intro', 'dev-card-glint-hover']) {
      const block = keyframes(css, name);
      const properties = new Set([...block.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]));
      expect([...properties].sort(), name).toEqual(['opacity', 'transform']);
    }
    const card = cardCss(css);
    expect(card).not.toMatch(/box-shadow|filter|backdrop|blur|drop-shadow/);
  });

  it('chỉ chạy 1 lần (intro khi mở app hoặc mỗi lần trỏ chuột), KHÔNG lặp vô hạn', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).not.toContain('infinite');
    expect(css).toMatch(/\.dev-card--intro \.dev-card-glint\s*\{\s*animation:\s*dev-card-glint-intro 1400ms [^;]* 1200ms 1;/);
    expect(css).toMatch(/\.dev-card:hover \.dev-card-glint\s*\{\s*animation:\s*dev-card-glint-hover 1100ms [^;]* 1;/);
    // không giữ hiệu ứng sau khi chạy xong (không fill-mode forwards/both)
    expect(css).not.toMatch(/animation:[^;]*\b(both|forwards)\b/);
    // khi đứng yên (nền) thẻ không có animation nào: quy tắc animation chỉ nằm dưới intro/hover
    const outsideRules = css.replace(/\.dev-card--intro \.dev-card-glint\s*\{[^}]*\}/, '').replace(/\.dev-card:hover \.dev-card-glint\s*\{[^}]*\}/, '');
    expect(outsideRules.replace(/@keyframes[\s\S]*?\n\}\n\n/g, '')).not.toMatch(/animation:/);
  });

  it('không giữ lớp GPU khi đứng yên: không will-change (trình duyệt tự nâng lớp khi transform/opacity đang chạy)', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).not.toContain('will-change');
  });

  it('tôn trọng prefers-reduced-motion và móc :root.reduce-motion (tùy chọn Cài đặt sẽ thêm ở GĐ 2a)', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.dev-card-glint\s*\{\s*display:\s*none/);
    expect(css).toMatch(/:root\.reduce-motion \.dev-card-glint\s*\{\s*display:\s*none/);
  });

  it('intro chỉ ở thẻ thanh bên (không chạy lại mỗi lần mở trang Thông tin)', async () => {
    const [sidebar, about] = await Promise.all([read('src/renderer/src/layout/Sidebar.tsx'), read('src/renderer/src/pages/AboutPage.tsx')]);
    expect(sidebar).toContain('<DeveloperSignature intro />');
    expect(about).toContain('<DeveloperSignature/>');
    expect(about).not.toContain('<DeveloperSignature intro');
  });

  it('thanh bên thu hẹp thì thẻ chỉ còn biểu tượng (theo bề rộng thật của chân thanh bên)', async () => {
    const css = cardCss(await read('src/renderer/src/brand.css'));
    expect(css).toMatch(/\.sidebar-footer\s*\{\s*container:\s*sidebar-footer \/ inline-size/);
    expect(css).toMatch(/@container sidebar-footer \(max-width: 150px\)[\s\S]*\.dev-card-copy\s*\{\s*display:\s*none/);
  });
});
