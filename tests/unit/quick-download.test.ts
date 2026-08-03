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
    expect(parseQuickDownloadTime('00:10:00')).toBe(600);
    expect(parseQuickDownloadTime('01:02:03')).toBe(3723);
    expect(parseQuickDownloadTime('90')).toBe(90);
    expect(formatQuickDownloadTime(600)).toBe('10:00');
    expect(parseQuickDownloadTime('25:10:30')).toBe(90_630);
    expect(formatQuickDownloadTime(90_630)).toBe('25:10:30');
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
    expect(args).toContain('--no-overwrites');
    expect(args).toContain('--no-post-overwrites');
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

  it('serializes ranges longer than 24 hours without treating them as clock time', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/long-video',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'range',
      startTime: '25:10:30',
      endTime: '25:15:30',
      accurateCut: false
    });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'long-duration'
    });

    expect(request.startSeconds).toBe(90_630);
    expect(request.endSeconds).toBe(90_930);
    expect(args).toContain('*90630-90930');
  });

  it('rejects duration values above the supported 9999-hour boundary', () => {
    expect(() => parseQuickDownloadTime('10000:00:00')).toThrow(/9999:59:59/);
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
  it('builds audio-only with M4A extraction and sidecars', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/audio',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mediaMode: 'audio-only',
      mode: 'full',
      accurateCut: false,
      downloadSubtitles: true,
      subtitleLanguage: 'vi,en',
      downloadThumbnail: true,
      writeMetadata: true
    });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'audio-only'
    });

    expect(args).toContain('--extract-audio');
    expect(args).toContain('m4a');
    expect(args).toContain('--write-subs');
    expect(args).toContain('--convert-subs');
    expect(args).toContain('--write-thumbnail');
    expect(args).toContain('--write-info-json');
    expect(args).not.toContain('--merge-output-format');
  });

  it('builds video-only without requesting an audio merge', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/video-only',
      outputDirectory: 'C:\\Downloads',
      quality: '1080p',
      mediaMode: 'video-only',
      mode: 'full',
      accurateCut: false
    });

    const args = buildQuickDownloadArguments(request, {
      ffmpegDirectory: 'C:\\tool',
      tempDirectory: 'C:\\Temp\\quick',
      runToken: 'video-only'
    });

    expect(request.mediaMode).toBe('video-only');
    expect(args.join(' ')).toContain('bv*');
    expect(args).not.toContain('--extract-audio');
    expect(args).not.toContain('--merge-output-format');
  });

  it('attaches a configured cookies file only when authentication is requested', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://www.youtube.com/watch?v=test',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'full',
      accurateCut: false
    });

    const args = buildQuickDownloadArguments(
      request,
      {
        ffmpegDirectory: 'C:\\tool',
        tempDirectory: 'C:\\Temp\\quick',
        runToken: 'cookies-file'
      },
      {
        cookiesFilePath: 'C:\\security\\cookies-managed.txt',
        cookiesBrowser: 'none',
        cookiesBrowserProfile: ''
      }
    );

    expect(args).toContain('--cookies');
    expect(args).toContain('C:\\security\\cookies-managed.txt');
    expect(args).not.toContain('--cookies-from-browser');
  });

  it('attaches a configured browser profile after authentication is requested', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://www.youtube.com/watch?v=test',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'full',
      accurateCut: false
    });

    const args = buildQuickDownloadArguments(
      request,
      {
        ffmpegDirectory: 'C:\\tool',
        tempDirectory: 'C:\\Temp\\quick',
        runToken: 'cookies-browser'
      },
      {
        cookiesFilePath: '',
        cookiesBrowser: 'firefox',
        cookiesBrowserProfile: 'default-release'
      }
    );

    expect(args).toContain('--cookies-from-browser');
    expect(args).toContain('firefox:default-release');
    expect(args).not.toContain('--cookies');
  });
});
