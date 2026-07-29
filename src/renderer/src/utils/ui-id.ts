let sequence = 0;

export function createUiEventId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function createPersistentUiId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}
