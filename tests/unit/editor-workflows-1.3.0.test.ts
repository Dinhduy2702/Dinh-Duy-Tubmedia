import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

describe('Tubmedia 1.3.0 editor workflows', () => {
  it('mở Editor Studio làm trang mặc định và có điều hướng mới', () => {
    const store = read('src/renderer/src/stores/app-store.ts');
    const sidebar = read('src/renderer/src/layout/Sidebar.tsx');
    expect(store).toContain("page: 'editor-home'");
    expect(sidebar).toContain("id: 'history'");
    expect(sidebar).toContain("id: 'diagnostics'");
  });

  it('điều khiển hàng đợi thật và dùng virtualization', () => {
    const queue = read('src/renderer/src/pages/QueuePage.tsx');
    expect(queue).toContain('window.desktop.queue[kind]');
    expect(queue).toContain('window.desktop.queue.pauseAll()');
    expect(queue).toContain('window.desktop.queue.resumeAll()');
    expect(queue).toContain('useVirtualTableWindow');
  });

  it('nhập TXT/CSV, kéo thả và loại trùng trước khi import', () => {
    const importer = read('src/renderer/src/features/projects/ImportLinksDialog.tsx');
    expect(importer).toContain("endsWith('.csv')");
    expect(importer).toContain('onDrop');
    expect(importer).toContain('duplicateKey');
    expect(importer).toContain('removeDuplicates');
  });

  it('có preset CFR cho ba phần mềm dựng và proxy', () => {
    const defaults = read('src/main/settings/defaults.ts');
    for (const id of [
      'quality-premiere-cfr',
      'quality-davinci-cfr',
      'quality-capcut-cfr',
      'quality-editor-proxy'
    ]) {
      expect(defaults).toContain(id);
    }
  });
});
