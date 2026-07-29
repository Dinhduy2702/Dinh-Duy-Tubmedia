import { describe, expect, it } from 'vitest';
import { redactSecrets, redactSecretText } from '../../src/shared/utils/secret-redaction.js';

describe('secret redaction', () => {
  it('removes credentials, headers and sensitive URL query values', () => {
    const text = 'Authorization: Bearer-abc token=secret https://user:pass@example.com/v?id=1&signature=xyz --cookies C:\\secret\\cookies.txt';
    const safe = redactSecretText(text);
    expect(safe).not.toContain('Bearer-abc');
    expect(safe).not.toContain('secret');
    expect(safe).not.toContain('user:pass');
    expect(safe).not.toContain('signature=xyz');
    expect(safe).not.toContain('cookies.txt');
  });

  it('redacts nested values by key', () => {
    expect(redactSecrets({ token: 'abc', nested: { message: 'password=pw' } })).toEqual({
      token: '[REDACTED]', nested: { message: 'password=[REDACTED]' }
    });
  });
});
