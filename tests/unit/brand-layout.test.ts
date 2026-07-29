import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bottom-left Tubmedia brand', () => {
  it('keeps the larger logo and readable, balanced copy in the sidebar footer', async () => {
    const [component, css] = await Promise.all([
      readFile(
        join(process.cwd(), 'src/renderer/src/components/TubmediaBrand.tsx'),
        'utf8'
      ),
      readFile(
        join(process.cwd(), 'src/renderer/src/tubmedia-theme.css'),
        'utf8'
      )
    ]);

    expect(component).toContain(
      '<TubmediaMark className="developer-signature-logo" size={58}/>'
    );
    expect(component).toContain('<span className="developer-signature-eyebrow">PHÁT TRIỂN BỞI</span>');
    expect(component).toContain('<b className="developer-signature-name">Đình Duy</b>');
    expect(component).toContain('<strong className="developer-signature-product">TUBMEDIA</strong>');
    expect(component).toContain('<small className="developer-signature-tagline">TẢI · XỬ LÝ · GHÉP VIDEO</small>');

    expect(css).toContain('.sidebar-footer .developer-signature-logo');
    expect(css).toContain('flex-basis: 58px');
    expect(css).toContain(
      '.sidebar-footer .developer-signature-card .developer-signature-copy span'
    );
    expect(css).toContain('@media (max-width: 1020px)');
  });
});

