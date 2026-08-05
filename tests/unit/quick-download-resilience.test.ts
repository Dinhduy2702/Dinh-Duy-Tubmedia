import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';

describe('Quick Download path and unsupported-link resilience', () => {
  const request = validateQuickDownloadRequest({
    url: 'https://example.com/watch/very-long-title',
    outputDirectory: 'C:\\Downloads',
    quality: 'best',
    mode: 'full',
    accurateCut: false
  });

  it('uses a short Windows-safe filename and supports an emergency compact filename', () => {
    const normalArgs = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\TubmediaQD\\abc123',
      runToken: '20260805032000-abc123',
      outputToken: 'abc123'
    });
    const normalTemplate = normalArgs[normalArgs.indexOf('-o') + 1];
    expect(normalArgs[normalArgs.indexOf('--trim-filenames') + 1]).toBe('128');
    expect(normalTemplate).toContain('%(title).80B');
    expect(normalTemplate).toContain('[QD-abc123]');

    const compactArgs = buildQuickDownloadArguments(
      request,
      {
        ffmpegDirectory: 'C:\\tool',
        tempDirectory: 'C:\\Temp\\TubmediaQD\\abc123',
        runToken: '20260805032000-abc123',
        outputToken: 'abc123'
      },
      undefined,
      { compactFilename: true }
    );
    const compactTemplate = compactArgs[compactArgs.indexOf('-o') + 1];
    expect(compactTemplate).not.toContain('%(title)');
    expect(compactTemplate).toContain('Video [%(id)s]');
  });

  it('can retry unsupported pages using only the generic/default extractors', () => {
    const args = buildQuickDownloadArguments(
      request,
      {
        ffmpegDirectory: 'C:\\tool',
        tempDirectory: 'C:\\Temp\\TubmediaQD\\abc123',
        runToken: '20260805032000-abc123',
        outputToken: 'abc123'
      },
      undefined,
      { forceGenericExtractor: true }
    );
    expect(args).toContain('--ies');
    expect(args).toContain('generic,default');
  });

  it('keeps raw yt-dlp details in logs while exposing friendly recovery states to the UI', async () => {
    const [service, panel, contract] = await Promise.all([
      readFile(new URL('../../src/main/download/quick-download-service.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/renderer/src/components/QuickDownloadPanel.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/shared/quick-download.ts', import.meta.url), 'utf8')
    ]);

    expect(service).toContain("join(app.getPath('temp'), 'TubmediaQD')");
    expect(service).toContain('classifyOutputPathFailure');
    expect(service).toContain('classifyUnsupportedUrlFailure');
    expect(service).toContain('prepareAutomaticRetry');
    expect(service).toContain("'OUTPUT_PATH_INVALID'");
    expect(service).toContain("'UNSUPPORTED_URL'");
    expect(contract).toContain("'OUTPUT_PATH_INVALID'");
    expect(contract).toContain("'UNSUPPORTED_URL'");
    expect(panel).toContain('Liên kết chưa được nền tảng tải hỗ trợ');
    expect(panel).toContain('Cập nhật yt-dlp');
    expect(panel).toContain('Chọn thư mục khác');
  });
});
