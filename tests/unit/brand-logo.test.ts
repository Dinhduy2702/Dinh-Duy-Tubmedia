import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (path: string): string => readFileSync(join(root, path), 'utf8');
const svgFolder = 'docs/brand/svg';
const svg = (name: string): string => text(`${svgFolder}/${name}.svg`);
const pathData = (source: string): string[] => [...source.matchAll(/ d="([^"]+)"/g)].map((match) => match[1] ?? '');

const logoData = text('src/renderer/src/brand/logo-data.ts');
const brandCss = text('src/renderer/src/brand.css');
const tokensCss = text('src/renderer/src/tokens.css');

const RED = '#DB2B23';
const PLAY = '#F9F9F9';
const PAPER = '#FAFAF9';
const INK = '#262626';

describe('logo chuẩn: dữ liệu trong ứng dụng khớp các SVG đã duyệt', () => {
  const horizontal = svg('ngang-mau-nen-toi');

  it('mọi đường vẽ (huy hiệu, nút play, 8 chữ) trong logo-data.ts có trong SVG bản ngang đã duyệt', () => {
    const paths = pathData(horizontal);
    expect(paths).toHaveLength(10);
    for (const d of paths) expect(logoData, `thiếu đường vẽ ${d.slice(0, 40)}…`).toContain(d);
  });

  it('bản dọc dùng cùng huy hiệu, nút play và 8 chữ; chỉ khác bố cục', () => {
    const vertical = svg('doc-mau-nen-toi');
    expect(pathData(vertical)).toEqual(pathData(horizontal));
    expect(vertical).toContain('translate(394.97 -321.52)');
    expect(logoData).toContain('badgeShift: [394.97, -321.52]');
  });

  it('bố cục (viewBox, thanh bo tròn) trong logo-data.ts trùng SVG đã duyệt', () => {
    for (const [name, key] of [['mark-mau', 'mark'], ['ngang-mau-nen-toi', 'horizontal'], ['doc-mau-nen-toi', 'vertical']] as const) {
      const box = (svg(name).match(/viewBox="([^"]+)"/)?.[1] ?? '').split(' ').join(', ');
      expect(logoData, `viewBox của ${key}`).toContain(`[${box}]`);
    }
    expect(logoData).toContain('rx: 10.52');
  });

  it('bản một màu = huy hiệu và nút play trong MỘT đường vẽ (nút play là lỗ trống)', () => {
    const mark = svg('mark-mau');
    const [badge, play] = pathData(mark);
    for (const name of ['mark-mot-mau-trang', 'mark-mot-mau-den-than']) {
      expect(pathData(svg(name))).toEqual([`${badge}${play}`]);
    }
  });

  it('logo-data.ts do máy sinh và ghi rõ nguồn, không chứa màu', () => {
    expect(logoData).toContain('SINH TỰ ĐỘNG');
    expect(logoData).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('logo chuẩn: SVG thuần, đúng màu đo từ ảnh gốc', () => {
  const names = readdirSync(join(root, svgFolder)).filter((name) => name.endsWith('.svg'));

  it('có đủ 11 bản: biểu tượng, ngang, dọc, một màu trắng/đen than, chữ đen cho nền sáng', () => {
    expect(names.sort()).toEqual([
      'doc-mau-nen-sang.svg', 'doc-mau-nen-toi.svg', 'doc-mot-mau-den-than.svg', 'doc-mot-mau-trang.svg',
      'mark-mau.svg', 'mark-mot-mau-den-than.svg', 'mark-mot-mau-trang.svg',
      'ngang-mau-nen-sang.svg', 'ngang-mau-nen-toi.svg', 'ngang-mot-mau-den-than.svg', 'ngang-mot-mau-trang.svg'
    ]);
  });

  it.each(names)('%s không phụ thuộc ảnh, phông hay tài nguyên ngoài (chữ là đường vẽ)', (name) => {
    const source = text(`${svgFolder}/${name}`);
    expect(source).not.toMatch(/<image|<text|<style|<script|href=|@import|url\(|font-family/);
    expect(source).toContain('<title>');
  });

  it('màu của các bản màu đúng mã đã đo', () => {
    expect(svg('mark-mau')).toContain(`fill="${RED}"`);
    expect(svg('mark-mau')).toContain(`fill="${PLAY}"`);
    // nền tối: chữ và thanh trắng ngà
    const dark = svg('ngang-mau-nen-toi');
    expect(dark.match(new RegExp(`fill="${PAPER}"`, 'g'))?.length).toBe(9);
    // nền sáng: chữ và thanh đen của chính logo (chữ trắng KHÔNG đặt lên nền sáng)
    const light = svg('ngang-mau-nen-sang');
    expect(light.match(new RegExp(`fill="${INK}"`, 'g'))?.length).toBe(9);
    expect(light).not.toContain(`fill="${PAPER}"`);
    for (const name of ['ngang-mau-nen-sang', 'doc-mau-nen-sang']) expect(svg(name)).toContain(`fill="${RED}"`);
  });

  it('bản một màu chỉ có đúng một màu', () => {
    for (const [name, color] of [['ngang-mot-mau-trang', '#FFFFFF'], ['ngang-mot-mau-den-than', INK], ['doc-mot-mau-trang', '#FFFFFF'], ['mark-mot-mau-den-than', INK]] as const) {
      const colors = new Set([...svg(name).matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((match) => match[1]));
      expect([...colors]).toEqual([color]);
    }
  });
});

describe('logo chuẩn: màu trong CSS và quy tắc dùng', () => {
  it('brand.css giữ đúng mã màu logo và đổi chữ theo giao diện (nền tối trắng, nền sáng đen)', () => {
    const css = brandCss.toLowerCase();
    for (const hex of [RED, PLAY, PAPER, INK, '#1C1C1E']) expect(css).toContain(hex.toLowerCase());
    expect(brandCss).toMatch(/:root\s*\{[^}]*--logo-text:\s*var\(--logo-paper\)/);
    expect(brandCss).toMatch(/:root\.light\s*\{[^}]*--logo-text:\s*var\(--logo-ink\)/);
    expect(brandCss).toMatch(/\.tm-logo--on-dark\s*\{[^}]*--logo-text:\s*var\(--logo-paper\)/);
    expect(brandCss).toMatch(/\.tm-logo--on-light\s*\{[^}]*--logo-text:\s*var\(--logo-ink\)/);
  });

  it('đỏ logo chỉ được dùng cho huy hiệu: không là token giao diện, không nằm trong tokens.css', () => {
    expect(tokensCss.toLowerCase()).not.toContain('db2b23');
    const uses = [...brandCss.matchAll(/var\(--logo-red\)/g)].length;
    expect(uses).toBe(1);
    expect(brandCss).toMatch(/\.tm-logo-badge\s*\{\s*fill:\s*var\(--logo-red\)/);
    // đỏ lỗi vẫn là #B3261E, khác đỏ logo
    expect(tokensCss.toLowerCase()).toContain('#b3261e');
  });

  it('brand.css nạp trước tokens.css (tokens.css vẫn có tiếng nói cuối cùng)', () => {
    const main = text('src/renderer/src/main.tsx');
    const order = [...main.matchAll(/import '\.\/([a-z0-9.-]+\.css)';/g)].map((match) => match[1]);
    expect(order.indexOf('brand.css')).toBeGreaterThan(order.indexOf('tubmedia-theme.css'));
    expect(order.indexOf('brand.css')).toBeLessThan(order.indexOf('tokens.css'));
  });

  it('chỉ animate/hiệu ứng nhẹ: logo không dùng bóng đổ, lọc mờ hay animation', () => {
    const logoRules = brandCss.slice(0, brandCss.indexOf('/* ---- Thanh bên'));
    expect(logoRules).not.toMatch(/filter|backdrop|animation|box-shadow/);
  });
});

describe('logo chuẩn được tích hợp vào ứng dụng', () => {
  it('thanh bên dùng logo bản ngang chữ trắng trên nền đen than; chỉ còn biểu tượng khi thanh bên thật sự hẹp', () => {
    const brand = text('src/renderer/src/components/TubmediaBrand.tsx');
    expect(text('src/renderer/src/layout/Sidebar.tsx')).toContain('<TubmediaWordmark />');
    expect(brand).toContain('variant="horizontal" tone="on-dark"');
    expect(brand).toContain('variant="mark" tone="on-dark"');
    expect(brandCss).toMatch(/\.sidebar-brand\s*\{\s*container:\s*sidebar-brand \/ inline-size/);
    expect(brandCss).toMatch(/@container sidebar-brand \(max-width: 150px\)[\s\S]*\.tm-brand-full\s*\{\s*display:\s*none/);
  });

  it('không còn logo cũ (ô vuông đỏ bo góc có bóng) trong mã giao diện', () => {
    const brand = text('src/renderer/src/components/TubmediaBrand.tsx');
    expect(brand).not.toContain('tubmedia-mark-surface');
    expect(brand).not.toContain('viewBox="0 0 120 120"');
  });

  it('màn hình khởi động và trang Thông tin dùng logo chuẩn', () => {
    expect(text('src/renderer/src/app/App.tsx')).toContain('<TubmediaLogo variant="horizontal"');
    const about = text('src/renderer/src/pages/AboutPage.tsx');
    expect(about).toContain('<TubmediaLogo variant="horizontal"');
    expect(about).toContain('<BrandKit/>');
  });

  it('mục Bộ nhận diện có logo, đủ mã màu và cách dùng đúng/sai (kèm chữ, không chỉ màu)', () => {
    const kit = text('src/renderer/src/components/BrandKit.tsx');
    const colors = text('src/renderer/src/brand/brand-colors.ts');
    for (const hex of [RED, PLAY, PAPER, INK, '#1C1C1E', '#B3261E']) expect(colors).toContain(`'${hex.slice(1)}'`);
    // mã màu chỉ để hiển thị; màu thật đi qua biến CSS (không hex viết cứng trong TSX)
    expect(colors).not.toMatch(/['"]#[0-9a-fA-F]{6}['"]/);
    expect(kit).toContain('var(${color.cssVar})');
    expect(kit).toContain("'ĐÚNG' : 'SAI'");
    expect(kit).toContain('Không đặt chữ trắng lên nền sáng');
    expect(kit).toContain('Chữ trắng chỉ trên nền tối');
    expect(kit).toContain('Không đổi màu logo');
    expect(kit).toContain('đỏ báo lỗi');
    for (const tone of ['on-dark', 'on-light', 'mono-charcoal', 'mono-white']) expect(kit).toContain(`tone="${tone}"`);
    for (const variant of ['horizontal', 'vertical', 'mark']) expect(kit).toContain(`variant="${variant}"`);
  });

  it('favicon là SVG thuần 128×128 dùng đúng màu logo', () => {
    const favicon = text('src/renderer/public/tubmedia-icon.svg');
    expect(favicon).toContain('viewBox="0 0 128 128"');
    expect(favicon).toContain(RED);
    expect(favicon).toContain(PLAY);
    expect(favicon).not.toMatch(/<image|<text|href=|url\(|filter/);
    expect(text('src/renderer/index.html')).toContain('href="./tubmedia-icon.svg"');
  });
});

describe('.ico của bộ nhận diện: tên riêng, không đụng icon bộ cài/.exe', () => {
  const ico = readFileSync(join(root, 'docs/brand/tubmedia-logo.ico'));

  it('có đủ các kích thước 16/24/32/48/64/128/256, mỗi ảnh là PNG hợp lệ', () => {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16;
      const size = ico[entry] === 0 ? 256 : (ico[entry] ?? 0);
      sizes.push(size);
      const offset = ico.readUInt32LE(entry + 12);
      const length = ico.readUInt32LE(entry + 8);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect([...ico.subarray(offset, offset + 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(ico.readUInt32BE(offset + 16)).toBe(size);
    }
    for (const size of [16, 24, 32, 48, 64, 128, 256]) expect(sizes).toContain(size);
  });

  it('khác tệp resources/icon.ico (icon taskbar/khay dùng cách dựng khác — xem taskbar-tray-icon.test.ts); package.json không nhắc tên riêng này', () => {
    expect(ico.equals(readFileSync(join(root, 'resources/icon.ico')))).toBe(false);
    const pkg = text('package.json');
    expect(pkg.match(/"resources\/icon\.ico"/g)).toHaveLength(3);
    expect(pkg).toContain('"from": "resources/icon.png"');
    expect(pkg).not.toContain('tubmedia-logo.ico');
  });
});
