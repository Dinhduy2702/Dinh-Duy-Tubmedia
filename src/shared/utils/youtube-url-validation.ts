/* TUBMEDIA_R34_YOUTUBE_VIDEO_ID_VALIDATION */

export interface YouTubeVideoUrlValidation {
  isYouTube: boolean;
  isVideoUrl: boolean;
  videoId: string | null;
  malformed: boolean;
  message: string | null;
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function normalizedHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function isYouTubeHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com') ||
    host === 'youtu.be'
  );
}

function malformedResult(videoId: string): YouTubeVideoUrlValidation {
  return {
    isYouTube: true,
    isVideoUrl: true,
    videoId,
    malformed: true,
    message:
      'Li\u00ean k\u1ebft YouTube kh\u00f4ng h\u1ee3p l\u1ec7: ID video ph\u1ea3i c\u00f3 \u0111\u00fang 11 k\u00fd t\u1ef1. H\u00e3y sao ch\u00e9p l\u1ea1i li\u00ean k\u1ebft \u0111\u1ea7y \u0111\u1ee7 t\u1eeb n\u00fat Chia s\u1ebb c\u1ee7a YouTube.'
  };
}

export function validateYouTubeVideoUrl(value: unknown): YouTubeVideoUrlValidation {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      isYouTube: false,
      isVideoUrl: false,
      videoId: null,
      malformed: false,
      message: null
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return {
      isYouTube: false,
      isVideoUrl: false,
      videoId: null,
      malformed: false,
      message: null
    };
  }

  if (!/^https?:$/.test(parsed.protocol) || !isYouTubeHost(parsed.hostname)) {
    return {
      isYouTube: false,
      isVideoUrl: false,
      videoId: null,
      malformed: false,
      message: null
    };
  }

  const host = normalizedHost(parsed.hostname);
  let candidate: string | null = null;
  let isVideoUrl = false;

  if (host === 'youtu.be') {
    isVideoUrl = true;
    candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
    isVideoUrl = true;
    candidate = parsed.searchParams.get('v');
  } else {
    const match = parsed.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/i);
    if (match) {
      isVideoUrl = true;
      candidate = match[1] ?? null;
    }
  }

  if (!isVideoUrl) {
    return {
      isYouTube: true,
      isVideoUrl: false,
      videoId: null,
      malformed: false,
      message: null
    };
  }

  if (!candidate) {
    return {
      isYouTube: true,
      isVideoUrl: true,
      videoId: null,
      malformed: false,
      message: null
    };
  }

  if (!YOUTUBE_VIDEO_ID.test(candidate)) {
    return malformedResult(candidate);
  }

  return {
    isYouTube: true,
    isVideoUrl: true,
    videoId: candidate,
    malformed: false,
    message: null
  };
}

export function malformedYouTubeVideoUrlMessage(value: unknown): string | null {
  const validation = validateYouTubeVideoUrl(value);
  return validation.malformed ? validation.message : null;
}
