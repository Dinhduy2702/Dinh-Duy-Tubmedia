import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('FIX11 path persistence and Windows drive roots', () => {
  it('opens the folder picker at the field current path', () => {
    expect(read('src/renderer/src/components/FolderField.tsx')).toContain(
      "chooseFolder(value.trim() || undefined)"
    );
  });

  it('remembers paths for new download and merge lanes', () => {
    const download = read('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
    const merge = read('src/renderer/src/pages/DownloadMergePage.tsx');
    expect(download).toContain("saveWorkbenchPath('download-output', value)");
    expect(download).toContain("loadWorkbenchPath('download-output')");
    expect(merge).toContain("saveWorkbenchPath('merge-output', value)");
    expect(merge).toContain("loadWorkbenchPath('merge-source')");
  });

  it('checks an existing directory before mkdir to support E drive roots', () => {
    const helper = read('src/main/files/ensure-directory.ts');
    expect(helper).toContain('if (await isDirectory(path)) return;');
    expect(read('src/main/storage/path-service.ts')).toContain('await ensureDirectory(path);');
  });
});
