import { describe, expect, it } from 'vitest';
import {
  combineVideoFilterLinks,
  directVideoFilterIds,
  extractVideoFilterUrls,
  matchVideoByLinks,
  normalizeVideoFilterTitle,
  videoFilterTitleScore
} from '../../src/shared/utils/video-link-filter.js';

describe('video link filter', () => {
  it('extracts unique URLs and removes trailing punctuation', () => {
    expect(
      extractVideoFilterUrls(
        'https://youtu.be/abcDEF12345?t=1, https://youtu.be/abcDEF12345?t=1\nhttps://www.tiktok.com/@a/video/7391234567890.'
      )
    ).toEqual([
      'https://youtu.be/abcDEF12345?t=1',
      'https://www.tiktok.com/@a/video/7391234567890'
    ]);
  });

  it('extracts direct IDs for major URL shapes', () => {
    expect(directVideoFilterIds('https://youtu.be/abcDEF12345?t=3')).toContain('abcDEF12345');
    expect(directVideoFilterIds('https://www.youtube.com/shorts/zYX98765432')).toContain('zYX98765432');
    expect(directVideoFilterIds('https://www.tiktok.com/@name/video/7391234567890')).toContain('7391234567890');
  });

  it('prefers yt-dlp metadata when the direct ID is the same', () => {
    const links = combineVideoFilterLinks(
      ['https://youtu.be/abcDEF12345'],
      [
        {
          id: 'abcDEF12345',
          title: 'A useful title',
          url: 'https://www.youtube.com/watch?v=abcDEF12345',
          platform: 'Youtube'
        }
      ]
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.title).toBe('A useful title');
  });

  it('matches filename by an exact delimited ID before title fallback', () => {
    const match = matchVideoByLinks(
      {
        fullPath: 'E:/video/My clip [abcDEF12345].mp4',
        relativePath: 'My clip [abcDEF12345].mp4',
        name: 'My clip [abcDEF12345].mp4',
        stem: 'My clip [abcDEF12345]'
      },
      [
        {
          id: 'abcDEF12345',
          title: '',
          url: 'https://youtu.be/abcDEF12345',
          platform: 'YouTube'
        }
      ],
      false
    );
    expect(match?.reason).toBe('ID');
  });

  it('uses conservative normalized-title matching only at a high score', () => {
    const left = normalizeVideoFilterTitle('Hadzabe Hunting Buffalo 1080p');
    const right = normalizeVideoFilterTitle('Hadzabe Hunting Buffalo');
    expect(videoFilterTitleScore(left, right)).toBeGreaterThanOrEqual(0.92);

    const match = matchVideoByLinks(
      {
        fullPath: 'E:/video/Hadzabe Hunting Buffalo.mp4',
        relativePath: 'Hadzabe Hunting Buffalo.mp4',
        name: 'Hadzabe Hunting Buffalo.mp4',
        stem: 'Hadzabe Hunting Buffalo'
      },
      [
        {
          id: 'not-present-id',
          title: 'Hadzabe Hunting Buffalo',
          url: 'https://example.com/video/not-present-id',
          platform: 'example.com'
        }
      ],
      true
    );
    expect(match?.reason).toBe('TITLE');
  });
});
