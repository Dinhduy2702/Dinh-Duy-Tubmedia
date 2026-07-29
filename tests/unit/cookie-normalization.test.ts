import { describe, expect, it } from 'vitest';
import { normalizeCookieText } from '../../src/main/cookies/cookie-service.js';

describe('cookie input normalization', () => {
  it('accepts a normal Cookie header', () => {
    const normalized = normalizeCookieText('Cookie: SID=abc; PREF=xyz');
    expect(normalized).toContain('# Netscape HTTP Cookie File');
    expect(normalized).toContain('.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc');
    expect(normalized).toContain('.youtube.com\tTRUE\t/\tTRUE\t0\tPREF\txyz');
  });

  it('accepts browser JSON exports', () => {
    const normalized = normalizeCookieText(JSON.stringify([
      {
        domain: '.youtube.com',
        path: '/',
        secure: true,
        expirationDate: 2_000_000_000,
        name: 'LOGIN_INFO',
        value: 'secret'
      }
    ]));
    expect(normalized).toContain('.youtube.com\tTRUE\t/\tTRUE\t2000000000\tLOGIN_INFO\tsecret');
  });

  it('keeps HttpOnly Netscape cookie rows as data', () => {
    const normalized = normalizeCookieText(
      '# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc'
    );
    expect(normalized).toContain('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc');
  });
});
