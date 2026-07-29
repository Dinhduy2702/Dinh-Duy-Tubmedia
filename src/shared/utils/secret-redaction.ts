const SECRET_KEY = /cookie|token|password|authorization|api[-_]?key|client[-_]?secret|signature/i;

export function redactSecretText(value: string): string {
  return value
    .replace(/\b(authorization|cookie|token|password|api[-_]?key|client[-_]?secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/([?&](?:token|access_token|auth|authorization|api_key|key|signature|sig|expires)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s:/@]+:[^\s@]+@/gi, 'https://[REDACTED]@')
    .replace(/(--cookies(?:-from-browser)?\s+)("[^"]+"|'[^']+'|\S+)/gi, '$1[REDACTED]');
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretText(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(item)
      ])
    );
  }
  return value;
}
