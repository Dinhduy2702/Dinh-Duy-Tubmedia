import { describe, expect, it } from 'vitest';
import {
  malformedYouTubeVideoUrlMessage,
  validateYouTubeVideoUrl
} from '../../src/shared/utils/youtube-url-validation.js';

describe('R34 malformed YouTube video URL validation', () => {
  it.each([
    'https://www.youtube.com/watch?v=mkCvpCgkQ-w',
    'https://youtu.be/X2sTE3ZkJ5c',
    'https://www.youtube.com/shorts/OX_aH81Hsvc',
    'https://www.youtube.com/live/cs8VcUylf84',
    'https://www.youtube.com/embed/O1TVKg2lt9c'
  ])('accepts a valid 11-character video id: %s', (url) => {
    const result = validateYouTubeVideoUrl(url);
    expect(result.isYouTube).toBe(true);
    expect(result.isVideoUrl).toBe(true);
    expect(result.videoId).toHaveLength(11);
    expect(result.malformed).toBe(false);
    expect(result.message).toBeNull();
  });

  it('rejects the exact 10-character URL from the production failure', () => {
    const url = 'https://youtube.com/watch?v=dhMfDxCfCo';
    const result = validateYouTubeVideoUrl(url);
    expect(result.videoId).toBe('dhMfDxCfCo');
    expect(result.videoId).toHaveLength(10);
    expect(result.malformed).toBe(true);
    expect(result.message).toContain('11');
  });

  it('rejects twelve-character video ids instead of truncating them', () => {
    const result = validateYouTubeVideoUrl('https://youtu.be/abcdefghijkL');
    expect(result.videoId).toBe('abcdefghijkL');
    expect(result.malformed).toBe(true);
  });

  it('preserves valid ids that contain dash and underscore characters', () => {
    for (const id of ['abc-def_ghi', '_bcdefghij-']) {
      expect(id).toHaveLength(11);
      const result = validateYouTubeVideoUrl('https://youtu.be/' + id);
      expect(result.videoId).toBe(id);
      expect(result.malformed).toBe(false);
    }
  });

  it('does not block non-video YouTube pages', () => {
    const result = validateYouTubeVideoUrl('https://www.youtube.com/@creator/videos');
    expect(result.isYouTube).toBe(true);
    expect(result.isVideoUrl).toBe(false);
    expect(result.malformed).toBe(false);
  });

  it('does not change non-YouTube URLs', () => {
    const result = validateYouTubeVideoUrl('https://vimeo.com/123456789');
    expect(result.isYouTube).toBe(false);
    expect(result.malformed).toBe(false);
    expect(malformedYouTubeVideoUrlMessage('https://vimeo.com/123456789')).toBeNull();
  });

  it('leaves a YouTube watch page without an explicit v id to existing handling', () => {
    const result = validateYouTubeVideoUrl('https://www.youtube.com/watch?list=PL123');
    expect(result.isYouTube).toBe(true);
    expect(result.isVideoUrl).toBe(true);
    expect(result.videoId).toBeNull();
    expect(result.malformed).toBe(false);
  });
});
