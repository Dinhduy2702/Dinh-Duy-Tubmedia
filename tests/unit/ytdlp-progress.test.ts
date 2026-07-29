import { describe, expect, it } from 'vitest';
import {
  parseYtDlpProgress,
  YTDLP_PROGRESS_FLAGS,
  YTDLP_UTF8_FLAGS
} from '../../src/main/downloader/ytdlp-progress.js';

describe('yt-dlp progress parser', () => {
  it('forces a real download and progress output even when metadata print hooks are active', () => {
    expect(YTDLP_PROGRESS_FLAGS).toEqual(['--newline', '--no-simulate', '--progress']);
  });

  it('forces yt-dlp text output to UTF-8 for Vietnamese titles on Windows', () => {
    expect(YTDLP_UTF8_FLAGS).toEqual(['--encoding', 'utf-8']);
  });

  it('parses percent, speed and eta from a normal progress line', () => {
    expect(
      parseYtDlpProgress('__VDMSP_PROGRESS__| 42.5%| 3.19MiB/s|00:01:15|4456448|10485760')
    ).toEqual({
      percent: 42.5,
      speed: '3.19MiB/s',
      etaSeconds: 75
    });
  });

  it('finds the marker after a tool prefix and falls back to byte counts', () => {
    expect(
      parseYtDlpProgress('[download] __VDMSP_PROGRESS__|NA|NA|NA|50|200')
    ).toEqual({
      percent: 25,
      speed: null,
      etaSeconds: null
    });
  });

  it('ignores unrelated output', () => {
    expect(parseYtDlpProgress('[download] Destination: sample.mp4')).toBeNull();
  });
});
