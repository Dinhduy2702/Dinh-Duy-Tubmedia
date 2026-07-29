import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('FIX6 diagnostics, quiet cookies and compact UI', () => {
  it('keeps a permanent diagnostics dock and exact merge verification reasons', () => {
    expect(read('src/renderer/src/app/App.tsx')).toMatch(/<DiagnosticDock\s*\/>/);
    expect(read('src/main/merge/merge-engine.ts')).toContain(
      'Thành phẩm pending không hợp lệ: ${exactReason}'
    );
    expect(read('src/main/media/file-verifier.ts')).toContain('verifyVideoSample');
  });

  it('keeps tool API fallback informational and app updates manual by default', () => {
    const updater = read('src/main/updates/tool-update-service.ts');
    expect(updater).toContain("'TOOL_RELEASE_API_DIRECT_FALLBACK'");
    expect(updater).toContain('this.logger.info(');
    expect(read('src/main/settings/defaults.ts')).toContain('autoCheckAppUpdates: false');
    expect(read('src/renderer/src/layout/Topbar.tsx')).not.toContain('updateBusy ? <LoaderCircle');
  });

  it('does not spam cookie success notices', () => {
    expect(read('src/renderer/src/components/CookieManagerDialog.tsx')).not.toContain('Cookies đã sẵn sàng');
    expect(read('src/renderer/src/pages/DownloadWorkbenchPage.tsx')).not.toContain(
      'Cookies mới chỉ được áp dụng'
    );
    expect(read('src/renderer/src/pages/DownloadMergePage.tsx')).not.toContain('Cookies mới đã được áp dụng');
  });

  it('uses compact configuration grids and hover-only inner scrollbars', () => {
    expect(read('src/renderer/src/pages/DownloadWorkbenchPage.tsx')).toContain('download-config-grid');
    expect(read('src/renderer/src/pages/DownloadMergePage.tsx')).toContain('merge-config-grid');
    const css = read('src/renderer/src/tubmedia-theme.css');
    expect(css).toMatch(/\.app-main::-webkit-scrollbar\s*\{\s*width:\s*13px/);
    expect(css).toContain('.workflow-tabs:hover::-webkit-scrollbar-thumb');
  });
});
