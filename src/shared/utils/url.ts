const trackingParams = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'feature', 'fbclid', 'gclid']);

export function normalizeUrl(raw: string): string | null {
  try {
    const value = raw.trim().replace(/^["'“”]+|["'“”,;]+$/g, '');
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (trackingParams.has(key)) url.searchParams.delete(key);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hostname = host;
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id) return `https://youtube.com/watch?v=${id}${url.searchParams.has('t') ? `&t=${url.searchParams.get('t')}` : ''}`;
    }
    if (host.endsWith('youtube.com')) {
      const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
      const live = url.pathname.match(/^\/live\/([^/]+)/);
      const id = url.searchParams.get('v') ?? shorts?.[1] ?? live?.[1];
      if (id) {
        const t = url.searchParams.get('t') ?? url.searchParams.get('start');
        return `https://youtube.com/watch?v=${id}${t ? `&t=${t}` : ''}`;
      }
    }
    url.protocol = 'https:';
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function detectPlatform(normalizedUrl: string): { platform: string; extractorKey: string; mediaId: string | null } {
  const url = new URL(normalizedUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname;

  if (host.endsWith('youtube.com')) {
    const mediaId = url.searchParams.get('v')
      ?? path.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]+)/)?.[1]
      ?? null;
    return { platform: 'youtube', extractorKey: 'youtube', mediaId };
  }
  if (host === 'youtu.be') return { platform: 'youtube', extractorKey: 'youtube', mediaId: path.split('/').filter(Boolean)[0] ?? null };
  if (host.includes('tiktok.com')) return { platform: 'tiktok', extractorKey: 'tiktok', mediaId: path.match(/\/video\/(\d+)/)?.[1] ?? null };
  if (host.includes('instagram.com')) return { platform: 'instagram', extractorKey: 'instagram', mediaId: path.match(/\/(?:reel|p|tv)\/([^/]+)/)?.[1] ?? null };
  if (host.includes('facebook.com') || host === 'fb.watch') {
    const mediaId =
      url.searchParams.get('v') ??
      url.searchParams.get('video_id') ??
      path.match(/\/videos\/(\d+)/)?.[1] ??
      path.match(/\/reel\/(\d+)/)?.[1] ??
      path.match(/\/share\/v\/([^/]+)/)?.[1] ??
      null;
    return { platform: 'facebook', extractorKey: 'facebook', mediaId };
  }
  if (host === 'x.com' || host.endsWith('twitter.com')) return { platform: 'x-twitter', extractorKey: 'twitter', mediaId: path.match(/\/status\/(\d+)/)?.[1] ?? null };
  if (host.includes('drive.google.com')) return { platform: 'google-drive', extractorKey: 'google-drive', mediaId: path.match(/\/d\/([^/]+)/)?.[1] ?? url.searchParams.get('id') };
  if (host.includes('vimeo.com')) return { platform: 'vimeo', extractorKey: 'vimeo', mediaId: path.match(/\/(\d+)/)?.[1] ?? null };
  if (host.includes('reddit.com')) return { platform: 'reddit', extractorKey: 'reddit', mediaId: path.match(/\/comments\/([A-Za-z0-9]+)/)?.[1] ?? null };
  if (host.includes('dailymotion.com') || host === 'dai.ly') return { platform: 'dailymotion', extractorKey: 'dailymotion', mediaId: path.match(/\/video\/([^_/?#]+)/)?.[1] ?? path.split('/').filter(Boolean).at(-1) ?? null };
  if (host.includes('twitch.tv')) return { platform: 'twitch', extractorKey: 'twitch', mediaId: path.match(/\/videos\/(\d+)/)?.[1] ?? path.split('/').filter(Boolean).at(-1) ?? null };
  if (host.includes('soundcloud.com')) return { platform: 'soundcloud', extractorKey: 'soundcloud', mediaId: null };
  return { platform: host, extractorKey: 'generic', mediaId: null };
}

export function stableHash(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}


export function downloadLinkTag(normalizedUrl: string): string {
  const sourceUrl = new URL(normalizedUrl);
  for (const key of ['t', 'start', 'end']) sourceUrl.searchParams.delete(key);
  sourceUrl.searchParams.sort();
  return `LINK_${stableHash(sourceUrl.toString()).slice(0, 12).toUpperCase()}`;
}

export function temporaryUrlIdentity(normalizedUrl: string): string {
  const sourceUrl = new URL(normalizedUrl);
  for (const key of ['t', 'start', 'end']) sourceUrl.searchParams.delete(key);
  sourceUrl.searchParams.sort();
  return `url:${stableHash(sourceUrl.toString())}`;
}

export function sourceIdentity(platform: string, extractorKey: string, mediaId: string | null, normalizedUrl: string): string {
  return mediaId ? `${platform}:${extractorKey}:${mediaId}` : temporaryUrlIdentity(normalizedUrl);
}

const PROJECT_SOURCE_SCOPE_MARKER = '::project:';

export function scopedSourceIdentity(identity: string, projectId: string): string {
  const existingScope = identity.lastIndexOf(PROJECT_SOURCE_SCOPE_MARKER);
  const baseIdentity = existingScope >= 0 ? identity.slice(0, existingScope) : identity;
  return `${baseIdentity}${PROJECT_SOURCE_SCOPE_MARKER}${projectId}`;
}

export function sourceIdentityScope(identity: string): string {
  const scopeIndex = identity.lastIndexOf(PROJECT_SOURCE_SCOPE_MARKER);
  return scopeIndex >= 0 ? identity.slice(scopeIndex) : '';
}
