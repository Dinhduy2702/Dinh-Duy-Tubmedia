import type { VideoLinkFilterLink } from '../video-link-filter.js';

export interface VideoCandidate {
  fullPath: string;
  relativePath: string;
  name: string;
  stem: string;
}

export interface VideoLinkMatch {
  link: VideoLinkFilterLink;
  reason: 'ID' | 'TITLE';
}

export const VIDEO_LINK_FILTER_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.avi',
  '.m4v',
  '.flv',
  '.wmv',
  '.mpg',
  '.mpeg',
  '.ts',
  '.mts',
  '.m2ts',
  '.3gp'
]);

export function extractVideoFilterUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/giu) ?? [];
  const unique = new Set<string>();

  for (let raw of matches) {
    raw = raw.replace(/[),.;!?}\]]+$/g, '').replaceAll('&amp;', '&');
    try {
      new URL(raw);
      unique.add(raw);
    } catch {
      // Ignore malformed URLs.
    }
  }

  return [...unique];
}

export function videoFilterPlatformOf(urlString: string): string {
  try {
    const host = new URL(urlString).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be' || host.includes('youtube.com')) return 'YouTube';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('facebook.com') || host === 'fb.watch') return 'Facebook';
    if (host.includes('instagram.com')) return 'Instagram';
    if (host === 'x.com' || host.includes('twitter.com')) return 'X/Twitter';
    if (host.includes('vimeo.com')) return 'Vimeo';
    if (host.includes('dailymotion.com') || host === 'dai.ly') return 'Dailymotion';
    if (host.includes('twitch.tv')) return 'Twitch';
    if (host.includes('bilibili.com') || host === 'b23.tv') return 'Bilibili';
    return host;
  } catch {
    return 'unknown';
  }
}

function validVideoFilterId(value: string | null | undefined): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original value when percent decoding fails.
  }

  const id = decoded
    .trim()
    .replace(/[?&#/].*$/g, '')
    .replace(/[^A-Za-z0-9_-]+$/g, '');

  if (id.length < 4 || id.length > 160) return null;
  if (/^(watch|video|videos|shorts|live|embed|reel|status)$/i.test(id)) return null;
  return id;
}

export function directVideoFilterIds(urlString: string): string[] {
  const ids = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const id = validVideoFilterId(value);
    if (id) ids.add(id);
  };

  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);

    for (const key of ['v', 'id', 'video_id', 'videoId', 'fbid', 'story_fbid']) {
      add(url.searchParams.get(key));
    }

    if (host === 'youtu.be') add(parts[0]);
    if (host.includes('youtube.com')) {
      const index = parts.findIndex((part) => ['shorts', 'live', 'embed', 'v'].includes(part));
      if (index >= 0) add(parts[index + 1]);
    }

    if (host.includes('tiktok.com')) {
      const index = parts.indexOf('video');
      if (index >= 0) add(parts[index + 1]);
    }

    if (host.includes('facebook.com')) {
      for (const marker of ['videos', 'reel']) {
        const index = parts.indexOf(marker);
        if (index >= 0) add(parts[index + 1]);
      }
    }
    if (host === 'fb.watch') add(parts[0]);

    if (host.includes('instagram.com')) {
      for (const marker of ['reel', 'reels', 'p', 'tv']) {
        const index = parts.indexOf(marker);
        if (index >= 0) add(parts[index + 1]);
      }
    }

    if (host === 'x.com' || host.includes('twitter.com')) {
      const index = parts.indexOf('status');
      if (index >= 0) add(parts[index + 1]);
    }

    if (host.includes('vimeo.com')) {
      for (const part of parts) {
        if (/^\d{5,}$/.test(part)) add(part);
      }
    }

    if (host.includes('dailymotion.com')) {
      const index = parts.indexOf('video');
      if (index >= 0) add(parts[index + 1]?.split('_')[0]);
    }
    if (host === 'dai.ly') add(parts[0]);

    if (host.includes('twitch.tv')) {
      const index = parts.findIndex((part) => ['videos', 'clip'].includes(part));
      if (index >= 0) add(parts[index + 1]);
    }

    if (host.includes('bilibili.com')) {
      for (const part of parts) {
        if (/^(BV[0-9A-Za-z]+|av\d+)$/i.test(part)) add(part);
      }
    }

    const last = parts.at(-1)?.replace(/\.[A-Za-z0-9]{2,5}$/i, '');
    if (last && /\d/.test(last) && /^[A-Za-z0-9_-]{6,}$/.test(last)) add(last);
  } catch {
    // URL validity is checked before this helper is called.
  }

  return [...ids];
}

export function combineVideoFilterLinks(
  urls: string[],
  resolved: VideoLinkFilterLink[]
): VideoLinkFilterLink[] {
  const combined = [...resolved];

  for (const url of urls) {
    for (const id of directVideoFilterIds(url)) {
      combined.push({
        id,
        title: '',
        url,
        platform: videoFilterPlatformOf(url)
      });
    }
  }

  const unique = new Map<string, VideoLinkFilterLink>();
  for (const item of combined) {
    const key = item.id.toLowerCase();
    const current = unique.get(key);
    if (!current || (!current.title && item.title)) unique.set(key, item);
  }
  return [...unique.values()];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function videoFilenameContainsId(filename: string, id: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(id)}([^A-Za-z0-9]|$)`, 'i').test(filename);
}

export function normalizeVideoFilterTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[[^\]]{4,160}\]\s*$/g, ' ')
    .replace(/\b(?:2160p|1440p|1080p|720p|480p|4k|8k|uhd|fhd|hd)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function videoFilterTitleScore(leftValue: string, rightValue: string): number {
  if (leftValue === rightValue) return 1;
  if (leftValue.includes(rightValue) || rightValue.includes(leftValue)) {
    const ratio = Math.min(leftValue.length, rightValue.length) / Math.max(leftValue.length, rightValue.length);
    return ratio >= 0.72 ? 0.96 : ratio;
  }

  const left = new Set(leftValue.split(' ').filter((token) => token.length > 1));
  const right = new Set(rightValue.split(' ').filter((token) => token.length > 1));
  if (!left.size || !right.size) return 0;

  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  const coverage = common / Math.min(left.size, right.size);
  const union = new Set([...left, ...right]).size;
  return coverage * 0.65 + (common / union) * 0.35;
}

export function matchVideoByLinks(
  video: VideoCandidate,
  links: VideoLinkFilterLink[],
  allowTitle: boolean
): VideoLinkMatch | null {
  for (const link of links) {
    if (videoFilenameContainsId(video.stem, link.id)) return { link, reason: 'ID' };
  }

  if (!allowTitle) return null;
  const videoTitle = normalizeVideoFilterTitle(video.stem);
  if (videoTitle.length < 10) return null;

  let best: { link: VideoLinkFilterLink; score: number } | null = null;
  for (const link of links) {
    const linkTitle = normalizeVideoFilterTitle(link.title);
    if (linkTitle.length < 10) continue;
    const score = videoFilterTitleScore(videoTitle, linkTitle);
    if (score >= 0.92 && (!best || score > best.score)) best = { link, score };
  }

  return best ? { link: best.link, reason: 'TITLE' } : null;
}
