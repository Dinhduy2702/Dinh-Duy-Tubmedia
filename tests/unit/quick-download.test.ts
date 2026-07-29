import { describe, expect, it } from 'vitest';
import {
  formatQuickDownloadTime,
  parseQuickDownloadTime,
  validateQuickDownloadRequest
} from '../../src/shared/quick-download.js';
import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';

describe('quick download', () => {
  it('parses common timestamp formats', () => {
    expect(parseQuickDownloadTime('10:00')).toBe(600);
    expect(parseQuickDownloadTime('01:02:03')).toBe(3723);
    expect(parseQuickDownloadTime('90')).toBe(90);
    expect(formatQuickDownloadTime(600)).toBe('10:00');
  });

  it('rejects invalid or reversed ranges', () => {
    expect(() =>
      validateQuickDownloadRequest({
        url: 'https://www.youtube.com/watch?v=test',
        outputDirectory: 'C:\\Downloads',
        quality: 'best',
        mode: 'range',
        startTime: '13:00',
        endTime: '10:00',
        accurateCut: false
      })
    ).toThrow();
  });

  it('builds a fast range download by default', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://www.youtube.com/watch?v=test',
      outputDirectory: 'C:\\Downloads',
      quality: '1080p',
      mode: 'range',
      startTime: '10:00',
      endTime: '13:00',
      accurateCut: false
    });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: '20260729-token'
    });

    expect(args).toContain('--no-playlist');
    expect(args).toContain('--download-sections');
    expect(args).toContain('*600-780');
    expect(args).not.toContain('--force-keyframes-at-cuts');
    expect(args.join(' ')).toContain('%(id)s');
    expect(args.join(' ')).toContain('QD-20260729-token');
    expect(args).toContain('after_move:TUBMEDIA_FILE|%(filepath)s');
  });

  it('adds accurate cut only when explicitly selected', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/video',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'range',
      startTime: '00:10:00',
      endTime: '00:13:00',
      accurateCut: true
    });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'token'
    });

    expect(args).toContain('--force-keyframes-at-cuts');
  });

  it('does not add section arguments for full video', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/video',
      outputDirectory: 'C:\\Downloads',
      quality: '720p',
      mode: 'full',
      accurateCut: false
    });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'token'
    });

    expect(args).not.toContain('--download-sections');
    expect(args).not.toContain('--force-keyframes-at-cuts');
  });
});
