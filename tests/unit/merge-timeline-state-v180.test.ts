import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInputText } from '../../src/shared/utils/input-parser.js';

const root = process.cwd();
const mergePage = readFileSync(join(root, 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');

describe('#25: hasActualTimeline khớp lượt ghép mới nhất (.at(-1)), giữ ghi chú khi kéo-thả và tách originalText nhiều URL', () => {
  it('parseInputText tách originalText riêng cho từng URL khi 1 dòng dán nhiều URL', () => {
    const rows = parseInputText('https://youtu.be/aaa https://youtu.be/bbb ghi chú chung');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.originalText).not.toContain('https://youtu.be/bbb');
    expect(rows[1]?.originalText).not.toContain('https://youtu.be/aaa');
    expect(rows[0]?.originalText).toContain('https://youtu.be/aaa');
    expect(rows[1]?.originalText).toContain('https://youtu.be/bbb');
    expect(rows[0]?.note).toBe('ghi chú chung');
    expect(rows[1]?.note).toBe('ghi chú chung');
  });

  it('DownloadMergePage lấy lượt ghép mới nhất (.at(-1)) và kiểm tra khớp danh sách link cho hasActualTimeline', () => {
    expect(mergePage).toContain("jobs.filter((job) => job.type === 'merge').at(-1)");
    expect(mergePage).toContain('doesTimelineMatchCurrentLinks(');
    expect(mergePage).toContain('reorderLinksTextPreservingComments(');
  });

  it('reorderLinksTextPreservingComments giữ nguyên dòng ghi chú (# / //) và đảo đúng thứ tự video', async () => {
    const { reorderLinksTextPreservingComments } = await import('../../src/shared/utils/merge-timeline-preview.js');
    const linksText = '# Phần mở đầu\nhttps://youtu.be/aaa\n// Đoạn 2\nhttps://youtu.be/bbb';
    const items = parseInputText(linksText).filter((item) => item.validity !== 'invalid');
    const next = reorderLinksTextPreservingComments(linksText, items, 0, 1);
    expect(next).toBe('# Phần mở đầu\nhttps://youtu.be/bbb\n// Đoạn 2\nhttps://youtu.be/aaa');
  });

  it('doesTimelineMatchCurrentLinks tắt hasActualTimeline khi link hiện tại đã đổi hoặc đảo thứ tự', async () => {
    const { doesTimelineMatchCurrentLinks, mergeItemMatchKey } = await import(
      '../../src/shared/utils/merge-timeline-preview.js'
    );
    const initial = parseInputText('https://youtu.be/aaa\nhttps://youtu.be/bbb');
    const mergeJob = {
      id: 'm1',
      projectId: 'p1',
      type: 'merge' as const,
      status: 'completed' as const,
      priority: 10,
      sourceId: null,
      itemId: null,
      input: {
        mergedItemKeys: initial.map(mergeItemMatchKey)
      },
      progress: 100,
      speed: null,
      etaSeconds: null,
      attempts: 1,
      maxAttempts: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      startedAt: null,
      finishedAt: null
    };
    const rows = [
      { index: 1, start: 0, end: 10, duration: 10, code: '00:00', label: 'A', note: '', file: 'a.mp4' },
      { index: 2, start: 10, end: 20, duration: 10, code: '00:10', label: 'B', note: '', file: 'b.mp4' }
    ];

    expect(doesTimelineMatchCurrentLinks(initial, mergeJob, [], rows)).toBe(true);
    const reordered = parseInputText('https://youtu.be/bbb\nhttps://youtu.be/aaa');
    expect(doesTimelineMatchCurrentLinks(reordered, mergeJob, [], rows)).toBe(false);
    const appended = parseInputText('https://youtu.be/aaa\nhttps://youtu.be/bbb\nhttps://youtu.be/ccc');
    expect(doesTimelineMatchCurrentLinks(appended, mergeJob, [], rows)).toBe(false);
  });
});
