import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE_TONES, type NoticeTone } from '../../src/shared/utils/notice-tone.js';

const root = process.cwd();
const tokensCss = readFileSync(join(root, 'src/renderer/src/tokens.css'), 'utf8');

type TokenMap = Record<string, string>;

/** Gộp mọi khối `:root { ... }` (tối) hoặc `:root.light { ... }` (sáng) của tokens.css. */
function blocks(selector: ':root' | ':root.light'): TokenMap {
  const map: TokenMap = {};
  const escaped = selector.replace('.', '\\.');
  const pattern = new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)^\\}`, 'gm');
  for (const match of tokensCss.matchAll(pattern)) {
    for (const declaration of (match[1] ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      map[declaration[1] ?? ''] = (declaration[2] ?? '').trim();
    }
  }
  return map;
}

const dark = blocks(':root');
const light = { ...dark, ...blocks(':root.light') };
const themes: Array<[string, TokenMap]> = [
  ['tối', dark],
  ['sáng', light]
];

function resolve(map: TokenMap, name: string): string {
  const raw = map[name];
  if (raw === undefined) throw new Error(`Thiếu token ${name}`);
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  return reference?.[1] ? resolve(map, reference[1]) : raw;
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Không phải mã màu 6 số: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** Độ sặc sỡ (chroma, 0–1) — không bị đẩy lên bởi độ sáng như độ bão hòa HSL. */
function chroma(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Độ bão hòa HSL (0–1) và màu chủ đạo (độ). */
function hsl(hex: string): { saturation: number; hue: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { saturation: 0, hue: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { saturation, hue: (hue * 60 + 360) % 360 };
}

describe('bảng màu ngữ nghĩa (phương án C)', () => {
  it('giao diện sáng đúng từng mã màu người dùng đã duyệt', () => {
    const expected: Record<string, string> = {
      '--text-primary': '#1c1c1e',
      '--action-bg': '#1c1c1e',
      '--sidebar-bg': '#1c1c1e',
      '--surface-app': '#eeebe7',
      '--surface-card': '#ffffff',
      '--border-subtle': '#d9d5cf',
      '--text-secondary': '#55524d',
      '--tone-info-bg': '#e6eef9',
      '--tone-info-border': '#9db8e3',
      '--tone-info-text': '#16407f',
      '--tone-info-icon': '#1f5fbf',
      '--tone-success-bg': '#e4f2e7',
      '--tone-success-border': '#9bcba6',
      '--tone-success-text': '#14532d',
      '--tone-success-icon': '#1f7a3d',
      '--tone-warning-bg': '#fbf0d6',
      '--tone-warning-border': '#e3be6a',
      '--tone-warning-text': '#6b4300',
      '--tone-warning-icon': '#b26a00',
      '--tone-error-bg': '#fbe5e3',
      '--tone-error-border': '#e0928c',
      '--tone-error-text': '#8a1c14',
      '--tone-error-icon': '#b3261e',
      '--tone-neutral-bg': '#f3f1ee',
      '--tone-neutral-border': '#c9c4bc',
      '--tone-neutral-text': '#3a3835'
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(resolve(light, name).toLowerCase(), name).toBe(value);
    }
  });

  for (const [themeName, map] of themes) {
    describe(`giao diện ${themeName}`, () => {
      for (const tone of NOTICE_TONES) {
        it(`mức ${tone}: chữ ≥ 4,5:1 và biểu tượng ≥ 3:1 trên nền của mức đó`, () => {
          const bg = resolve(map, `--tone-${tone}-bg`);
          expect(contrast(resolve(map, `--tone-${tone}-text`), bg), 'chữ').toBeGreaterThanOrEqual(4.5);
          expect(contrast(resolve(map, `--tone-${tone}-icon`), bg), 'biểu tượng').toBeGreaterThanOrEqual(3);
        });

        it(`mức ${tone}: biểu tượng ≥ 3:1 cả trên thẻ và nền ứng dụng`, () => {
          const icon = resolve(map, `--tone-${tone}-icon`);
          expect(contrast(icon, resolve(map, '--surface-card'))).toBeGreaterThanOrEqual(3);
          expect(contrast(icon, resolve(map, '--surface-app'))).toBeGreaterThanOrEqual(3);
        });

        it(`mức ${tone}: viền có độ tương phản tối thiểu 1,4:1 (viền chỉ trang trí vì luôn có biểu tượng + chữ)`, () => {
          const border = resolve(map, `--tone-${tone}-border`);
          expect(contrast(border, resolve(map, `--tone-${tone}-bg`))).toBeGreaterThanOrEqual(1.4);
        });
      }

      it('chữ chính và chữ phụ ≥ 4,5:1 trên nền ứng dụng, thẻ và ô chìm', () => {
        for (const surface of ['--surface-app', '--surface-card', '--surface-sunken']) {
          for (const text of ['--text-primary', '--text-secondary']) {
            expect(contrast(resolve(map, text), resolve(map, surface)), `${text} trên ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('nút chính đủ tương phản và đổi chiều theo giao diện', () => {
        expect(contrast(resolve(map, '--action-text'), resolve(map, '--action-bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(resolve(map, '--action-text'), resolve(map, '--action-bg-hover'))).toBeGreaterThanOrEqual(4.5);
      });

      it('nút nguy hiểm: chữ trắng trên nền đỏ ≥ 4,5:1', () => {
        expect(contrast(resolve(map, '--danger-solid-text'), resolve(map, '--danger-solid'))).toBeGreaterThanOrEqual(4.5);
      });

      it('viền ô nhập/nút ≥ 3:1 trên thẻ và ô chìm để nhìn thấy được', () => {
        expect(contrast(resolve(map, '--border-control'), resolve(map, '--surface-card'))).toBeGreaterThanOrEqual(3);
        expect(contrast(resolve(map, '--border-control'), resolve(map, '--surface-sunken'))).toBeGreaterThanOrEqual(3);
      });

      it('liên kết ≥ 4,5:1 trên thẻ; thanh tiến độ ≥ 3:1 trên rãnh của nó', () => {
        expect(contrast(resolve(map, '--link'), resolve(map, '--surface-card'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(resolve(map, '--progress-fill'), resolve(map, '--progress-track'))).toBeGreaterThanOrEqual(3);
      });

      it('thanh bên LUÔN đen than: chữ, chữ phụ và mục đang chọn đều đủ tương phản', () => {
        expect(resolve(map, '--sidebar-bg')).toBe('#1c1c1e');
        expect(contrast(resolve(map, '--sidebar-text'), resolve(map, '--sidebar-bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(resolve(map, '--sidebar-muted'), resolve(map, '--sidebar-bg'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast('#ffffff', resolve(map, '--sidebar-active-bg'))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it('giao diện sáng không định nghĩa lại các biến của thanh bên (nên thanh bên luôn tối)', () => {
    const lightOnly = blocks(':root.light');
    expect(Object.keys(lightOnly).filter((name) => name.startsWith('--sidebar-'))).toEqual([]);
  });

  it('màu nhấn chính KHÔNG phải đỏ hay xanh dương: là đen than (sáng) và trắng ngà (tối)', () => {
    for (const [, map] of themes) {
      for (const name of ['--accent', '--accent2', '--accent3', '--action-bg']) {
        expect(chroma(resolve(map, name)), name).toBeLessThan(0.08);
      }
    }
    expect(resolve(light, '--action-bg')).toBe('#1c1c1e');
    expect(luminance(resolve(dark, '--action-bg'))).toBeGreaterThan(0.7);
  });

  it('đỏ CHỈ thuộc về lỗi: mọi token đỏ đều nằm trong mức lỗi hoặc nút nguy hiểm', () => {
    for (const [, map] of themes) {
      const reds = Object.keys(map).filter((name) => {
        const value = map[name] ?? '';
        if (!/^#[0-9a-f]{6}$/i.test(value)) return false;
        const { hue, saturation } = hsl(value);
        return saturation > 0.45 && (hue >= 350 || hue <= 15);
      });
      for (const name of reds) {
        expect(/--tone-error-|--danger-solid|--bad$/.test(name), `${name} là màu đỏ ngoài mức lỗi`).toBe(true);
      }
    }
  });

  it('xanh dương chỉ dùng cho thông tin, thanh tiến độ và liên kết', () => {
    for (const [, map] of themes) {
      const blues = Object.keys(map).filter((name) => {
        const value = map[name] ?? '';
        if (!/^#[0-9a-f]{6}$/i.test(value)) return false;
        const { hue, saturation } = hsl(value);
        return saturation > 0.35 && hue >= 200 && hue <= 245;
      });
      for (const name of blues) {
        expect(/--tone-info-|--link|--progress-fill|--info$/.test(name), `${name} là màu xanh dương ngoài vai trò cho phép`).toBe(true);
      }
    }
  });

  it('đỏ của logo (#D92B20) không xuất hiện trong bảng màu giao diện', () => {
    expect(tokensCss.toLowerCase()).not.toContain('d92b20');
    const errorRed = resolve(light, '--tone-error-icon');
    expect(errorRed.toLowerCase()).toBe('#b3261e');
  });

  it('tokens.css được nạp sau mọi tệp CSS khác để ghi đè bảng màu cũ', () => {
    const main = readFileSync(join(root, 'src/renderer/src/main.tsx'), 'utf8');
    const order = [...main.matchAll(/import '\.\/([a-z0-9.-]+\.css)';/g)].map((match) => match[1]);
    expect(order.at(-1)).toBe('tokens.css');
    expect(order).toContain('typography.css');
  });
});

describe('tokens.css không dùng lại màu đỏ cũ', () => {
  it('không dùng lại màu đỏ cố định hay màu nhấn đỏ cũ trong tokens.css', () => {
    for (const bad of ['#e5091d', '#df071b', '#ff3345', '#ef4444', '#dc2626']) {
      expect(tokensCss.toLowerCase()).not.toContain(bad);
    }
  });
});

const _toneListCheck: readonly NoticeTone[] = NOTICE_TONES;
void _toneListCheck;
