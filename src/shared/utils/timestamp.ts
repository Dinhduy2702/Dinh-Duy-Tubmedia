export function parseTimestampValue(value: string): number | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  if (/^\d+(?:\.\d+)?$/.test(input)) return Number(input);
  const colon = input.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (colon) return Number(colon[1] ?? 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
  const units = input.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return null;
}

export function parseTimestampRange(text: string): { start: number | null; end: number | null } {
  const normalized = text.trim();
  const named = normalized.match(/start\s*=\s*([^\s]+)\s+end\s*=\s*([^\s]+)/i);
  if (named) return { start: parseTimestampValue(named[1]!), end: parseTimestampValue(named[2]!) };
  const range = normalized.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?|\d+(?:\.\d+)?)(?:\s*)-(?:\s*)(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?|\d+(?:\.\d+)?)(?:\s|$)/);
  if (range) return { start: parseTimestampValue(range[1]!), end: parseTimestampValue(range[2]!) };
  return { start: null, end: null };
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimelineLine(startSeconds: number, index: number): string {
  const safeIndex = Math.max(1, Math.floor(index));
  return `${formatTimestamp(startSeconds)} Ph Video_${String(safeIndex).padStart(3, '0')}`;
}

export function formatTimelineCopyText(startSeconds: number): string {
  return `${formatTimestamp(startSeconds)} Ph`;
}
