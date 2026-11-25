import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const downloadPage = readFileSync(join(root, 'src/renderer/src/pages/DownloadWorkbenchPage.tsx'), 'utf8');
const mergePage = readFileSync(join(root, 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');

function extractAutosaveEffect(source: string): string {
  const idx = source.indexOf('window.setTimeout(');
  expect(idx).toBeGreaterThan(-1);
  const start = source.lastIndexOf('useEffect(', idx);
  const end = source.indexOf(');', source.indexOf('}, [', idx));
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

describe('#23: tự lưu nháp 800ms tách khỏi jobs/states, flush khi unmount, giữ làn đang dirty lúc mới nạp', () => {
  it('DownloadWorkbenchPage: timer 800ms chỉ phụ thuộc [forms, flushDirtyDrafts] (không reset khi jobs/states đổi)', () => {
    const effect = extractAutosaveEffect(downloadPage);
    expect(effect).toContain('800');
    expect(effect).toMatch(/\},\s*\[forms,\s*flushDirtyDrafts\]\s*\)/);
  });

  it('DownloadMergePage: timer 800ms chỉ phụ thuộc [forms, flushDirtyDrafts] (không reset khi jobs/states đổi)', () => {
    const effect = extractAutosaveEffect(mergePage);
    expect(effect).toContain('800');
    expect(effect).toMatch(/\},\s*\[forms,\s*flushDirtyDrafts\]\s*\)/);
  });

  it('cả 2 trang đều flush nháp đang dirty ngay khi unmount (cleanup của useEffect)', () => {
    for (const [name, source] of [
      ['DownloadWorkbenchPage', downloadPage],
      ['DownloadMergePage', mergePage]
    ] as const) {
      expect(source, name).toMatch(/useEffect\(\(\) => \{\s*mountedRef\.current = true;\s*return \(\) => \{\s*mountedRef\.current = false;\s*void flushDirtyDrafts\(\);\s*\};\s*\},\s*\[flushDirtyDrafts\]\)/);
    }
  });

  it('lúc nạp workbench.state() không ghi đè làn đã được đánh dấu dirty hoặc đã xóa', async () => {
    for (const [name, source] of [
      ['DownloadWorkbenchPage', downloadPage],
      ['DownloadMergePage', mergePage]
    ] as const) {
      expect(source, name).toContain('mergeLoadedLaneForms(');
    }
    const { mergeLoadedLaneForms } = await import('../../src/shared/utils/workbench-draft.js');
    const current = {
      'download-1': { name: 'Đang sửa', linksText: 'https://youtu.be/new' },
      'download-2': { name: 'Cũ', linksText: '' }
    };
    const loaded = {
      'download-1': { name: 'Từ DB', linksText: 'https://youtu.be/old' },
      'download-2': { name: 'Từ DB 2', linksText: 'https://youtu.be/db2' }
    };
    const merged = mergeLoadedLaneForms(
      ['download-1', 'download-2'],
      current,
      loaded,
      new Set(['download-1']),
      new Set()
    );
    expect(merged['download-1']).toEqual(current['download-1']);
    expect(merged['download-2']).toEqual(loaded['download-2']);
  });
});
