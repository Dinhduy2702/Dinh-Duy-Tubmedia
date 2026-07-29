import { describe, expect, it } from 'vitest';
import {
  hasConfiguredCookies,
  isCookieBlockingCode,
  shouldAttachConfiguredCookies
} from '@shared/utils/cookie-policy.js';

const noCookies = { cookiesFilePath: '', cookiesBrowser: 'none' as const };
const browserCookies = { cookiesFilePath: '', cookiesBrowser: 'firefox' as const };
const fileCookies = { cookiesFilePath: 'C:\\cookies.txt', cookiesBrowser: 'none' as const };

describe('cookies on-demand policy', () => {
  it('does not attach configured browser cookies to a normal first attempt', () => {
    expect(shouldAttachConfiguredCookies({ errorCode: null }, browserCookies)).toBe(false);
  });

  it('attaches cookies only after the current video requests authentication', () => {
    expect(shouldAttachConfiguredCookies({ errorCode: null }, fileCookies, true)).toBe(true);
  });

  it('preserves the cookie-required marker after an app restart or manual resume', () => {
    expect(shouldAttachConfiguredCookies({ errorCode: 'AUTHENTICATION_REQUIRED' }, browserCookies)).toBe(
      true
    );
  });

  it('reattaches cookies after automatic resume even when the visible error is cleared', () => {
    expect(
      shouldAttachConfiguredCookies(
        {
          errorCode: null,
          input: { cookieRetryRequested: true }
        },
        browserCookies
      )
    ).toBe(true);
  });

  it('never attaches cookies when the user has not configured any', () => {
    expect(shouldAttachConfiguredCookies({ errorCode: 'AUTHENTICATION_REQUIRED' }, noCookies, true)).toBe(
      false
    );
  });

  it('recognizes only cookie-related blocking codes', () => {
    expect(isCookieBlockingCode('BROWSER_COOKIE_DATABASE_LOCKED')).toBe(true);
    expect(isCookieBlockingCode('COOKIES_EXPIRED')).toBe(true);
    expect(isCookieBlockingCode('NETWORK_ERROR')).toBe(false);
    expect(hasConfiguredCookies(fileCookies)).toBe(true);
    expect(hasConfiguredCookies(noCookies)).toBe(false);
  });
});
