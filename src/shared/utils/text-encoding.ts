export function containsUnicodeReplacement(value: unknown): boolean {
  return typeof value === 'string' && value.includes('\uFFFD');
}

export function cleanExternalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !containsUnicodeReplacement(trimmed) ? trimmed : null;
}
