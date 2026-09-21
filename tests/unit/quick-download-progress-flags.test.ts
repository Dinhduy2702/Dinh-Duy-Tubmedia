import { describe, expect, it } from 'vitest';
import { buildQuickDownloadArguments } from '../../src/main/download/quick-download-command.js';
import { YTDLP_PROGRESS_FLAGS } from '../../src/main/downloader/ytdlp-progress.js';
import { validateQuickDownloadRequest } from '../../src/shared/quick-download.js';

describe('Tải nhanh: yt-dlp phải in dòng tiến độ dù dùng --print', () => {
  const paths = { ffmpegDirectory: 'C:\\tool', tempDirectory: 'C:\\Temp\\quick', runToken: 'tok' };

  it.each(['video-audio', 'audio-only', 'video-only'] as const)('có đủ cờ tiến độ ở chế độ %s', (mediaMode) => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/video',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mediaMode,
      mode: 'full',
      accurateCut: false
    });
    const args = buildQuickDownloadArguments(request, paths);

    // Bản yt-dlp 2026.08.19: --print ngầm bật --quiet nên --progress-template im lặng nếu thiếu --progress.
    for (const flag of YTDLP_PROGRESS_FLAGS) expect(args).toContain(flag);
    expect(args).toContain('--progress');
    expect(args).toContain('--progress-template');
    expect(args).toContain('--print');
  });

  it('cờ tiến độ đứng trước URL và không lọt qua dấu "--"', () => {
    const request = validateQuickDownloadRequest({
      url: 'https://example.com/video',
      outputDirectory: 'C:\\Downloads',
      quality: 'best',
      mode: 'full',
      accurateCut: false
    });
    const args = buildQuickDownloadArguments(request, paths);
    const separator = args.lastIndexOf('--');
    expect(args.indexOf('--progress')).toBeLessThan(separator);
    expect(args.slice(separator)).toEqual(['--', 'https://example.com/video']);
  });
});

