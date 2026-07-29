import { describe, expect, it } from 'vitest';
import { verifiedCapabilities } from '../../src/main/tools/tool-manager.js';

describe('tool capability labels', () => {
  it('recognizes the yt-dlp functions used by Tubmedia', () => {
    const capabilities = verifiedCapabilities(
      'yt-dlp',
      '--dump-json --progress-template --ffmpeg-location'
    );
    expect(capabilities).toEqual([
      'ytdlp_download',
      'ytdlp_metadata',
      'ytdlp_progress',
      'ytdlp_ffmpeg_bridge'
    ]);
  });

  it('keeps a verified base capability when optional help output is unavailable', () => {
    expect(verifiedCapabilities('ffprobe')).toEqual(['ffprobe_analysis']);
    expect(verifiedCapabilities('ffplay')).toEqual(['ffplay_preview']);
    expect(verifiedCapabilities('aria2c')).toEqual(['aria2_download']);
  });

  it('recognizes ffprobe, ffplay and aria2c details from safe help commands', () => {
    expect(verifiedCapabilities('ffprobe', '-show_streams -print_format')).toEqual([
      'ffprobe_analysis',
      'ffprobe_streams',
      'ffprobe_json'
    ]);
    expect(verifiedCapabilities('ffplay', '-autoexit')).toContain('ffplay_autoexit');
    expect(
      verifiedCapabilities('aria2c', '--max-connection-per-server')
    ).toContain('aria2_multiconnection');
  });
});
