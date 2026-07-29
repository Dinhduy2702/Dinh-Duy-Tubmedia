import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function projectFile(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

function compactMarkup(value: string): string {
  return value.replace(/\s+/g, '');
}

describe('giao diện tiến trình và nhật ký gọn RC7', () => {
  it('opens long details by hover, focus or click without expanding the table row', async () => {
    const component = await projectFile('src/renderer/src/components/CompactDetail.tsx');

    expect(component).toContain('onMouseEnter={openFromHover}');
    expect(component).toContain('onClick={() =>');
    expect(component).toContain('aria-expanded={open}');
    expect(component).toContain('createPortal(');
    expect(component).toContain("event.key !== 'Escape'");
  });

  it('keeps queue status and messages compact while exposing full result details', async () => {
    const queue = await projectFile('src/renderer/src/pages/QueuePage.tsx');
    const markup = compactMarkup(queue);

    expect(markup).toContain('<StatusBadgestatus={job.status}fixed/>');
    expect(queue).toContain('className="queue-message-compact"');
    expect(queue).toContain(
      'const discloseMessage = Boolean(issue || (messageDetail && messageDetail.length > 72))'
    );
    expect(markup).toContain(
      "label={issue?'Thôngtinsựcố':'Thôngtinkếtquảtácvụ'}"
    );
    expect(queue).not.toContain(
      'className="mt-1 text-xs" style={{ color: \'var(--muted)\' }}'
    );
  });

  it('uses fixed-layout operational tables and one-line ellipsis for long text', async () => {
    const css = await projectFile('src/renderer/src/tubmedia-theme.css');

    expect(css).toContain('/* v1.0.0 RC7 — tiến trình và nhật ký gọn');
    expect(css).toContain('.queue-data-table');
    expect(css).toContain('table-layout: fixed');
    expect(css).toContain('.status-badge-fixed');
    expect(css).toContain('.logs-message-compact > span');
    expect(css).toContain('text-overflow: ellipsis');
  });

  it('keeps the full logs page responsive and moves complete messages to the detail control', async () => {
    const logs = await projectFile('src/renderer/src/pages/LogsPage.tsx');
    const markup = compactMarkup(logs);

    expect(logs).toContain('className="table logs-data-table"');
    expect(logs).toContain('className="logs-message-compact"');
    expect(logs).toContain('label="Nội dung đầy đủ của nhật ký"');
    expect(markup).toContain('<StatusBadgestatus={entry.level}fixed/>');
  });

  it('uses the same compact log row inside download and merge workspaces', async () => {
    const [row, download, merge] = await Promise.all([
      projectFile('src/renderer/src/components/CompactLogRow.tsx'),
      projectFile('src/renderer/src/pages/DownloadWorkbenchPage.tsx'),
      projectFile('src/renderer/src/pages/DownloadMergePage.tsx')
    ]);

    expect(row).toContain('className="log-row-message"');
    expect(row).toContain('<CompactDetail');
    expect(compactMarkup(download)).toContain('<CompactLogRowkey={entry.id}entry={entry}/>');
    expect(compactMarkup(merge)).toContain('<CompactLogRowkey={entry.id}entry={entry}/>');
  });
});
