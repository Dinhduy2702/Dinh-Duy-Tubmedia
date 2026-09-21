import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('kịch bản chụp ảnh giao diện (so sánh trước/sau)', () => {
  const script = read('scripts/capture-ui-screenshots.mjs');

  it('mọi trang trong kịch bản đều là PageId có thật và có nút điều hướng ổn định', () => {
    const store = read('src/renderer/src/stores/app-store.ts');
    const sidebar = read('src/renderer/src/layout/Sidebar.tsx');
    const pageBlock = /export type PageId =([\s\S]*?);/.exec(store)?.[1] ?? '';
    const known = new Set([...pageBlock.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]));
    const scripted = [...script.matchAll(/\['([a-z-]+)', '[a-z-]+'\]/g)].map((match) => match[1]);

    expect(scripted.length).toBeGreaterThanOrEqual(13);
    for (const id of scripted) expect(known.has(id)).toBe(true);
    expect(sidebar).toContain('data-page-id={id}');
  });

  it('chỉ dùng dữ liệu tách biệt và chặn mọi tác động ra ngoài', () => {
    expect(script).toContain("TUBMEDIA_E2E: '1'");
    expect(script).toContain('TUBMEDIA_E2E_USER_DATA: userData');
    for (const blocked of [
      'dialog.showOpenDialog',
      'dialog.showSaveDialog',
      'dialog.showMessageBox',
      'shell.openPath',
      'shell.showItemInFolder',
      'shell.openExternal',
      'clipboard.writeText',
      'app.setLoginItemSettings'
    ]) {
      expect(script).toContain(blocked);
    }
    expect(script).toContain('autoCheckAppUpdates: false');
    expect(script).toContain('autoCheckToolUpdates: false');
  });

  it('từ chối chạy nếu thiếu công cụ để app không tự tải về', () => {
    expect(script).toContain('Kịch bản từ chối chạy để app KHÔNG tự tải công cụ');
  });

  it('chỉ xóa đúng thư mục tạm do chính nó tạo và không dùng cookie hay đăng nhập', () => {
    expect(script).toContain("sandbox.includes('tubmedia-shot-')");
    expect(script).toContain('sandbox.startsWith(tmpdir())');
    expect(script.toLowerCase()).not.toContain('cookiesbrowser:');
    expect(script).not.toContain('cookiesFilePath:');
  });

  it('dữ liệu giả chỉ dùng trạng thái không tự chạy (không có pending/downloading)', () => {
    const seed = /const jobs = \[([\s\S]*?)\];\s*const insert/.exec(script)?.[1] ?? '';
    expect(seed).not.toMatch(/\['(?:pending|downloading|analyzing|verifying|normalizing|processing|merging|retrying)'/);
    expect(seed).toContain("['paused'");
  });
});
