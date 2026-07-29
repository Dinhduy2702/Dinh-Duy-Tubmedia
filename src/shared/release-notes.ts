function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  return value
    .replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, token: string) => {
      const normalized = token.toLowerCase();

      if (normalized.startsWith('#x')) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }

      if (normalized.startsWith('#')) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }

      return named[normalized] ?? entity;
    })
    .replace(/\u00a0/g, ' ');
}

export function formatReleaseNotesForDisplay(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';

  if (!raw) {
    return 'Không có thông tin thay đổi cho phiên bản này.';
  }

  const text = decodeHtmlEntities(
    raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/?(?:h[1-6]|p|div|section|article|ul|ol|pre|blockquote|table|thead|tbody|tr|td|th)\b[^>]*>/gi,
        '\n'
      )
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const visibleLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (/^download video tubmedia\s+v?\d/i.test(line) || /^nội dung chính$/i.test(line)) {
      continue;
    }

    if (/^(xác minh bản phát hành|cài đặt)$/i.test(line)) {
      break;
    }

    visibleLines.push(line);
  }

  return visibleLines.join('\n').trim() || 'Không có thông tin thay đổi cho phiên bản này.';
}
