import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function projectFile(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('giao diện tập trung v0.9.2', () => {
  it('uses one reusable disclosure for non-blocking fixed information', async () => {
    const [component, workbench, merge, tools] = await Promise.all([
      projectFile('src/renderer/src/components/InfoDisclosure.tsx'),
      projectFile('src/renderer/src/pages/DownloadWorkbenchPage.tsx'),
      projectFile('src/renderer/src/pages/DownloadMergePage.tsx'),
      projectFile('src/renderer/src/components/ToolReadinessPanel.tsx')
    ]);

    expect(component).toContain('aria-expanded={open}');
    expect(component).toContain('info-disclosure-actions');
    expect(component).toContain('if (autoOpen) setOpen(true)');
    expect(workbench).toContain('className="preflight-disclosure"');
    expect(merge).toContain('className="merge-recommend-disclosure"');
    expect(merge).toContain('className="merge-quality-disclosure"');
    expect(tools).toContain('autoOpen={!connecting && !ready}');
  });

  it('keeps actions visible while descriptions stay in the disclosure body', async () => {
    const component = await projectFile('src/renderer/src/components/InfoDisclosure.tsx');
    const actionsIndex = component.indexOf('info-disclosure-actions');
    const collapseIndex = component.indexOf('info-disclosure-collapse');

    expect(actionsIndex).toBeGreaterThan(-1);
    expect(collapseIndex).toBeGreaterThan(actionsIndex);
    expect(component).toContain('aria-hidden={!open}');
  });

  it('removes repeated fixed copy from the sidebar and topbar', async () => {
    const [sidebar, topbar] = await Promise.all([
      projectFile('src/renderer/src/layout/Sidebar.tsx'),
      projectFile('src/renderer/src/layout/Topbar.tsx')
    ]);

    expect(sidebar).not.toContain('<small>{hint}</small>');
    expect(sidebar).not.toContain('Dùng công tắc trên thanh trên');
    expect(topbar).not.toContain('const titles =');
    expect(topbar).not.toContain('<p>{subtitle}</p>');
  });

  it('includes responsive rules for compact information bars', async () => {
    const css = await projectFile('src/renderer/src/tubmedia-theme.css');

    expect(css).toContain('/* v0.9.2 — giao diện tập trung');
    expect(css).toContain('.info-disclosure-actions');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('.merge-quality-detail-grid');
  });
});
