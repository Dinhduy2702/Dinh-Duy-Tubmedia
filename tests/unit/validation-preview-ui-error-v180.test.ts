import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { MAX_QUICK_DOWNLOAD_SECONDS } from '../../src/shared/quick-download.js';
import {
  localCutPreviewFrameRequestSchema,
  previewFrameRequestSchema
} from '../../src/shared/schemas/ipc.js';
import { friendlyIssue, safeUiText } from '../../src/shared/utils/ui-error.js';
import { encodeTypedMessage } from '../../src/shared/utils/notice-tone.js';

const root = process.cwd();
const stepPreviewCut = readFileSync(join(root, 'src/renderer/src/pages/StepPreviewCutPage.tsx'), 'utf8');
const quickDownloadPanel = readFileSync(join(root, 'src/renderer/src/components/QuickDownloadPanel.tsx'), 'utf8');
const downloadWorkbench = readFileSync(join(root, 'src/renderer/src/pages/DownloadWorkbenchPage.tsx'), 'utf8');

describe('#28: trần timestampSeconds, hộp báo lỗi StepPreviewCutPage, describeValidationIssues trong safeUiText & giữ nhãn [[tm:...]]', () => {
  it('previewFrameRequestSchema và localCutPreviewFrameRequestSchema cho phép mốc > 24h tới MAX_QUICK_DOWNLOAD_SECONDS', () => {
    const over24h = 25 * 3600 + 10 * 60 + 30; // 25:10:30 như ví dụ trên giao diện
    expect(() =>
      previewFrameRequestSchema.parse({ url: 'https://youtu.be/abc', timestampSeconds: over24h })
    ).not.toThrow();
    expect(() =>
      localCutPreviewFrameRequestSchema.parse({ filePath: 'D:\\v.mp4', timestampSeconds: over24h })
    ).not.toThrow();
    expect(() =>
      previewFrameRequestSchema.parse({
        url: 'https://youtu.be/abc',
        timestampSeconds: MAX_QUICK_DOWNLOAD_SECONDS + 1
      })
    ).toThrow(ZodError);
  });

  it('safeUiText gọi describeValidationIssues cho ZodError thay vì nuốt thành fallback chung', () => {
    let raw = '';
    try {
      previewFrameRequestSchema.parse({
        url: 'https://youtu.be/abc',
        timestampSeconds: MAX_QUICK_DOWNLOAD_SECONDS + 1
      });
    } catch (error) {
      if (error instanceof ZodError) {
        raw = `Error invoking remote method 'quick-download:preview-frame': ZodError: ${error.message}`;
      }
    }
    const text = safeUiText(raw, 'Không lấy được khung hình.');
    expect(text).toContain('Mốc thời gian');
    expect(text).toContain('giá trị lớn nhất');
    expect(text).not.toBe('Không lấy được khung hình.');
  });

  it('StepPreviewCutPage dùng FriendlyIssueCard và truyền nguyên error vào setError(error)', () => {
    expect(stepPreviewCut).toContain('<FriendlyIssueCard');
    expect(stepPreviewCut).toContain('friendlyIssue(error)');
    expect(stepPreviewCut).toContain("status?.phase === 'failed'");
    expect(stepPreviewCut).not.toMatch(/setError\(safeUiText\(/);
  });

  it('QuickDownloadPanel và DownloadWorkbenchPage truyền nguyên error vào setError để giữ dấu [[tm:...]]', () => {
    expect(quickDownloadPanel).not.toMatch(/setError\(readableError\(/);
    expect(downloadWorkbench).not.toMatch(/setError\(messageOf\(/);
    const tagged = new Error(encodeTypedMessage('warning', 'INVALID_INPUT', 'Cảnh báo test'));
    expect(friendlyIssue(tagged).tone).toBe('warning');
  });
});
