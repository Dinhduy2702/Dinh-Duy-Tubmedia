import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { friendlyIssue, safeUiText } from '../../src/shared/utils/ui-error.js';

const completedDownloadResult = {
  url: 'https://youtube.com/watch?v=aOxM86XkvK8',
  displayName: 'Incredible BABOON HUNTING day with FEARLESS Hadzabe tribe Hunters',
  workflow: 'download-only',
  progressStage: 'Đã hoàn tất',
  progressPhases: [
    { key: 'analyze', label: 'Phân tích nguồn', percent: 100, state: 'completed' },
    { key: 'download', label: 'Tải video', percent: 100, state: 'completed' },
    { key: 'verify', label: 'Kiểm tra tệp', percent: 100, state: 'completed' },
    { key: 'finalize', label: 'Đã hoàn tất', percent: 100, state: 'completed' }
  ],
  outputPath: 'E:\\DinhDuy\\video.mp4',
  resultMessage: 'Đã tải và kiểm tra hoàn tất: E:\\DinhDuy\\video.mp4',
  reusedExistingFile: false,
  cookieFailureConfirmed: false,
  cookieRetryRequested: false
};

describe('user-facing notification boundary', () => {
  it('classifies a completed structured result as success instead of an error', () => {
    const issue = friendlyIssue(completedDownloadResult);
    expect(issue.tone).toBe('success');
    expect(issue.title).toBe('Đã hoàn tất');
    expect(issue.message).not.toContain('progressPhases');
    expect(issue.message).not.toContain('cookieFailureConfirmed');
    expect(issue.message).not.toContain('{');
  });

  it('also recognizes the same result when an IPC layer serialized it as JSON', () => {
    const issue = friendlyIssue(JSON.stringify(completedDownloadResult, null, 2));
    expect(issue.tone).toBe('success');
    expect(issue.message).toContain('Tệp đã được tải');
  });

  it('classifies electron-updater same-version output as neutral information', () => {
    const raw =
      'Update for version 1.3.0 is not available (latest version: 1.3.0, downgrade is allowed).';
    const issue = friendlyIssue(raw);
    expect(issue.tone).toBe('info');
    expect(issue.title).toBe('Ứng dụng đã được cập nhật');
    expect(issue.message).toBe('Bạn đang sử dụng phiên bản mới nhất.');
    expect(issue.message.toLowerCase()).not.toContain('downgrade');
    expect(safeUiText(raw)).toBe('Bạn đang sử dụng phiên bản mới nhất.');
  });

  it('never exposes stacks, metadata or raw objects in a visible message', () => {
    const stack = friendlyIssue(new Error('TypeError: boom\n at Object.x (a.ts:1:2)'));
    const object = friendlyIssue({ eventCode: 'JOB_FAILED', jobId: 'abc', metadata: { raw: true } });
    expect(stack.message).not.toContain('Object.x');
    expect(object.message).not.toContain('eventCode');
    expect(object.message).not.toContain('jobId');
    expect(safeUiText('[object Object]')).not.toBe('[object Object]');
  });

  it('does not render raw queue input or technical blocks in normal UI', () => {
    const queue = readFileSync('src/renderer/src/pages/QueuePage.tsx', 'utf8');
    const attention = readFileSync('src/renderer/src/components/AttentionCenter.tsx', 'utf8');
    const app = readFileSync('src/renderer/src/app/App.tsx', 'utf8');
    const boundary = readFileSync('src/renderer/src/components/RendererErrorBoundary.tsx', 'utf8');
    const projects = readFileSync('src/renderer/src/pages/ProjectsPage.tsx', 'utf8');
    const tools = readFileSync('src/renderer/src/pages/ToolsPage.tsx', 'utf8');
    expect(queue).not.toContain('JSON.stringify(detailJob.input');
    expect(queue).not.toContain('<pre>{issue.technical}</pre>');
    expect(attention).not.toContain('attention-technical');
    expect(app).not.toContain('{issue.technical}');
    expect(app).toContain('safeUiText(startupToolMessage');
    expect(boundary).not.toContain('error.stack');
    expect(projects).not.toContain('{x.errorMessage??');
    expect(projects).not.toContain('<td>{x.message}</td>');
    expect(tools).not.toContain('<span>{tool.error}</span>');
  });
});
