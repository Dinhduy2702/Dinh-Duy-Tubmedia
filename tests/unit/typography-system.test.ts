import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('Tubmedia unified typography system', () => {
  it('loads the typography layer after every legacy and feature stylesheet', async () => {
    const main = await source('src/renderer/src/main.tsx');
    const themeIndex = main.indexOf("import './tubmedia-theme.css';");
    const cleanupIndex = main.indexOf("import './system-cleanup.css';");
    const quickIndex = main.indexOf("import './quick-download.css';");
    const typographyIndex = main.indexOf("import './typography.css';");

    expect(themeIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeGreaterThan(themeIndex);
    expect(quickIndex).toBeGreaterThan(cleanupIndex);
    expect(typographyIndex).toBeGreaterThan(quickIndex);
    expect(main).toContain("fontFamily: 'var(--font-ui)'");
    expect(main).not.toContain("fontFamily: 'Segoe UI, sans-serif'");
  });

  it('uses one font stack, a finite readable scale and real supported font weights', async () => {
    const typography = await source('src/renderer/src/typography.css');

    expect(typography).toContain('--font-ui:');
    expect(typography).toContain('--font-mono:');
    expect(typography).toContain('--type-2xs: 0.625rem');
    expect(typography).toContain('--type-body: 0.875rem');
    expect(typography).toContain('--type-3xl: 1.75rem');
    expect(typography).toContain('--weight-semibold: 600');
    expect(typography).toContain('--weight-bold: 700');
    expect(typography).toContain('font-synthesis: none');
    expect(typography).not.toMatch(/--weight-[\w-]+:\s*(?:850|880|900|950)\b/);
  });

  it('normalizes all major application surfaces instead of styling only one page', async () => {
    const typography = await source('src/renderer/src/typography.css');
    const requiredSelectors = [
      '.page-heading h1',
      '.sidebar-item-copy b',
      '.topbar-title h1',
      '.btn,',
      '.input,',
      '.table th,',
      '.quick-download-heading h2',
      '.system-cleanup-heading h2',
      '.notification-center-heading h2',
      '.queue-detail-drawer h2',
      '.diagnostic-dock-technical',
      '.text-xs',
      '.font-black',
      '.font-mono'
    ];

    for (const selector of requiredSelectors) {
      expect(typography).toContain(selector);
    }
  });

  it('keeps body copy readable while preserving compact metadata and aligned numbers', async () => {
    const typography = await source('src/renderer/src/typography.css');

    expect(typography).toContain('line-height: var(--line-body)');
    expect(typography).toContain('font-variant-numeric: tabular-nums');
    expect(typography).toContain('font-family: var(--font-mono) !important');
    expect(typography).toContain('@media (max-width: 760px)');
  });
});
