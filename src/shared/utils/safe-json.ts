export function parseJsonOr<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = parseJsonOr<unknown>(value, null);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : { dataCorrupted: true };
}

export function parseJsonStringArray(value: string): string[] {
  const parsed = parseJsonOr<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
