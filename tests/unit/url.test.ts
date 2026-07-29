import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  downloadLinkTag,
  normalizeUrl,
  scopedSourceIdentity,
  sourceIdentity,
  sourceIdentityScope,
  temporaryUrlIdentity
} from '@shared/utils/url.js';

describe('url normalize', () => {
  it('normalizes YouTube links', () => {
    expect(normalizeUrl('"https://youtu.be/abc123?t=83')).toBe('https://youtube.com/watch?v=abc123&t=83');
    expect(detectPlatform('https://youtube.com/watch?v=abc123')).toEqual({ platform: 'youtube', extractorKey: 'youtube', mediaId: 'abc123' });
  });

  it('uses real media identity', () => {
    expect(sourceIdentity('youtube', 'youtube', 'abc', 'x')).toBe('youtube:youtube:abc');
  });

  it('ignores clip timestamp in temporary source identity', () => {
    expect(temporaryUrlIdentity('https://example.com/video?t=20')).toBe(temporaryUrlIdentity('https://example.com/video?t=90'));
  });

  it('isolates one source identity for each download or merge project', () => {
    const base = sourceIdentity('youtube', 'youtube', 'abc', 'x');
    expect(scopedSourceIdentity(base, 'download-1')).toBe('youtube:youtube:abc::project:download-1');
    expect(scopedSourceIdentity(base, 'merge-1')).toBe('youtube:youtube:abc::project:merge-1');
    expect(scopedSourceIdentity(scopedSourceIdentity(base, 'download-1'), 'merge-2')).toBe(
      'youtube:youtube:abc::project:merge-2'
    );
    expect(sourceIdentityScope('youtube:youtube:abc::project:merge-1')).toBe('::project:merge-1');
  });
  it('detects common yt-dlp platforms and creates a stable per-link tag', () => {
    expect(detectPlatform('https://youtube.com/shorts/abc123')).toMatchObject({ platform: 'youtube', mediaId: 'abc123' });
    expect(detectPlatform('https://x.com/user/status/123456')).toMatchObject({ platform: 'x-twitter', mediaId: '123456' });
    expect(detectPlatform('https://drive.google.com/file/d/DRIVE_ID/view')).toMatchObject({ platform: 'google-drive', mediaId: 'DRIVE_ID' });
    expect(detectPlatform('https://www.reddit.com/r/test/comments/ab12cd/title/')).toMatchObject({ platform: 'reddit', mediaId: 'ab12cd' });
    expect(downloadLinkTag('https://youtube.com/watch?v=abc123&t=83')).toBe(downloadLinkTag('https://youtube.com/watch?v=abc123&t=120'));
    expect(downloadLinkTag('https://youtube.com/watch?v=abc123')).toMatch(/^LINK_[A-F0-9]{12}$/);
  });

});
