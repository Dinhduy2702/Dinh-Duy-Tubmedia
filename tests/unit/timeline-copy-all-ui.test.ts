import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueJob, TimelineRow } from '@shared/types/domain.js';
import * as timestampUtils from '@shared/utils/timestamp.js';

async function loadDownloadMergeModule(): Promise<Record<string, unknown>> {
  const dynamicSpecifier = ['..', '..', 'src', 'renderer', 'src', 'pages', 'DownloadMergePage.tsx'].join('/');
  return (await import(dynamicSpecifier)) as Record<string, unknown>;
}

function collectButtons(node: ReactNode): Array<{ text: string; disabled: boolean; onClick?: () => void }> {
  const found: Array<{ text: string; disabled: boolean; onClick?: () => void }> = [];
  const extractText = (child: ReactNode): string => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (Array.isArray(child)) return (child as ReactNode[]).map(extractText).join('');
    if (isValidElement<{ children?: ReactNode }>(child)) return extractText(child.props.children);
    return '';
  };
  const visit = (current: ReactNode): void => {
    if (!current) return;
    if (Array.isArray(current)) {
      for (const item of current as ReactNode[]) visit(item);
      return;
    }
    if (!isValidElement<Record<string, unknown>>(current)) return;
    if (current.type === 'button') {
      const text = extractText(current.props.children as ReactNode).trim();
      const onClick =
        typeof current.props.onClick === 'function' ? (current.props.onClick as () => void) : undefined;
      found.push({
        text,
        disabled: Boolean(current.props.disabled),
        ...(onClick ? { onClick } : {})
      });
      return;
    }
    if (typeof current.type === 'function') {
      const fn = current.type as (props: Record<string, unknown>) => ReactNode;
      // Chỉ gọi trực tiếp các component thuần không dùng hook (như TimelineHeaderActions)
      if (fn.name === 'TimelineHeaderActions') {
        visit(fn(current.props));
        return;
      }
    }
    visit(current.props.children as ReactNode);
  };
  visit(node);
  return found;
}

describe('T2 — Nút "Sao chép tất cả" và nhãn chữ rõ trên nút "Lưu TXT" ở khung Timeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sampleRows: TimelineRow[] = [
    {
      index: 1,
      start: 0,
      end: 65,
      duration: 65,
      code: timestampUtils.formatTimelineLine(0, 1),
      label: 'Video mở đầu',
      note: '',
      file: 'E:\\v1.mp4'
    },
    {
      index: 2,
      start: 65,
      end: 3735,
      duration: 3670,
      code: timestampUtils.formatTimelineLine(65, 2),
      label: 'Video giữa',
      note: '',
      file: 'E:\\v2.mp4'
    },
    {
      index: 3,
      start: 3735,
      end: 4000,
      duration: 265,
      code: timestampUtils.formatTimelineLine(3735, 3),
      label: 'Video kết',
      note: '',
      file: 'E:\\v3.mp4'
    }
  ];

  it('bấm "Sao chép tất cả" ghi đủ N dòng định dạng MM:SS Ph Video_00x nối bằng CRLF vào bộ nhớ tạm (khớp hệt .timeline.txt)', async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());
    vi.stubGlobal('window', {
      desktop: {
        app: { writeClipboard },
        dialogs: { saveTextFile: vi.fn(() => Promise.resolve(null)) }
      }
    });

    const formatAll = (
      timestampUtils as unknown as {
        formatAllTimelineText?: (rows: readonly Pick<TimelineRow, 'code'>[]) => string;
      }
    ).formatAllTimelineText;
    expect(typeof formatAll).toBe('function');
    expect(formatAll!(sampleRows)).toBe(
      ['00:00 Ph Video_001', '01:05 Ph Video_002', '01:02:15 Ph Video_003'].join('\r\n')
    );

    const downloadMergeModule = await loadDownloadMergeModule();
    const TimelineHeaderActions = (
      downloadMergeModule as {
        TimelineHeaderActions?: (props: {
          hasActualTimeline: boolean;
          onCopyAll: () => void;
          onExportTxt: () => void;
        }) => ReactNode;
      }
    ).TimelineHeaderActions;
    expect(typeof TimelineHeaderActions).toBe('function');

    const notices: Array<{ title: string; message: string }> = [];
    const copyAllHelper = (
      timestampUtils as unknown as {
        copyAllTimelineRowsToClipboard?: (
          rows: readonly TimelineRow[],
          writeClipboard: (text: string) => Promise<unknown>,
          onNotice: (title: string, message: string) => void
        ) => Promise<void>;
      }
    ).copyAllTimelineRowsToClipboard;
    expect(typeof copyAllHelper).toBe('function');

    const tree = TimelineHeaderActions!({
      hasActualTimeline: true,
      onCopyAll: () =>
        void copyAllHelper!(sampleRows, writeClipboard, (title, message) =>
          notices.push({ title, message })
        ),
      onExportTxt: () => undefined
    });
    const buttons = collectButtons(tree);
    const copyAllBtn = buttons.find((btn) => btn.text.includes('Sao chép tất cả'));
    const saveTxtBtn = buttons.find((btn) => btn.text.includes('Lưu TXT'));

    expect(copyAllBtn).toBeDefined();
    expect(copyAllBtn!.disabled).toBe(false);
    expect(saveTxtBtn).toBeDefined();
    expect(saveTxtBtn!.disabled).toBe(false);

    copyAllBtn!.onClick!();
    await Promise.resolve();

    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard).toHaveBeenCalledWith(
      ['00:00 Ph Video_001', '01:05 Ph Video_002', '01:02:15 Ph Video_003'].join('\r\n')
    );
    expect(notices).toHaveLength(1);
  });

  it('MergeProductionPanel hiển thị rõ chữ "Sao chép tất cả" và "Lưu TXT" (không còn nút chỉ có biểu tượng)', async () => {
    const downloadMergeModule = await loadDownloadMergeModule();
    const MergeProductionPanel = (
      downloadMergeModule as {
        MergeProductionPanel?: (props: Record<string, unknown>) => ReactNode;
      }
    ).MergeProductionPanel;
    expect(typeof MergeProductionPanel).toBe('function');

    const mergeJob = {
      id: 'merge-ui-1',
      projectId: 'proj-ui-1',
      type: 'merge',
      status: 'completed',
      progress: 100,
      attempts: 0,
      maxAttempts: 1,
      priority: 10,
      sourceId: null,
      itemId: null,
      errorCode: null,
      errorMessage: null,
      speed: null,
      etaSeconds: null,
      startedAt: '2026-11-18T00:00:00.000Z',
      finishedAt: '2026-11-18T00:01:00.000Z',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:01:00.000Z',
      input: {
        timelineOnly: true,
        timelineTxt: 'E:\\Out\\Duy_18.11\\Duy_18.11.timeline.txt',
        timelineRows: sampleRows
      }
    } as QueueJob;

    const html = renderToStaticMarkup(
      createElement(MergeProductionPanel as never, {
        form: {
          name: 'Quy trình 1',
          linksText: 'https://drive.google.com/file/d/1ABC/view\nhttps://drive.google.com/file/d/2DEF/view',
          sourceFolder: 'E:\\Src',
          tempFolder: 'E:\\Tmp',
          outputFolder: 'E:\\Out',
          finalFileName: 'Duy_18.11',
          qualityProfileId: 'quality-source-size',
          resourceProfileId: 'resource-balanced',
          exportTimelineTxt: true,
          timelineOnly: true,
          aspectRatio: 'original'
        },
        jobs: [mergeJob],
        storage: null,
        onNotice: () => undefined,
        setError: () => undefined
      })
    );

    expect(html).toContain('Sao chép tất cả');
    expect(html).toContain('Lưu TXT');
    expect(html).toContain('E:\\Out\\Duy_18.11\\Duy_18.11.timeline.txt');

    const rawPage = readFileSync(join(process.cwd(), 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');
    expect(rawPage).toContain('<TimelineHeaderActions');
  });
});
