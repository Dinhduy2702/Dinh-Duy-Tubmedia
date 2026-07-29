import type { AppSettings, QueueJob } from '../types/domain.js';

export const COOKIE_BLOCKING_CODES = [
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED'
] as const;

export function hasConfiguredCookies(
  settings: Pick<AppSettings, 'cookiesFilePath' | 'cookiesBrowser'>
): boolean {
  return settings.cookiesFilePath.trim().length > 0 || settings.cookiesBrowser !== 'none';
}

export function isCookieBlockingCode(code: string | null | undefined): boolean {
  return COOKIE_BLOCKING_CODES.includes(code as (typeof COOKIE_BLOCKING_CODES)[number]);
}

export function shouldAttachConfiguredCookies(
  job: Pick<QueueJob, 'errorCode'> & {
    input?: Pick<QueueJob, 'input'>['input'];
  },
  settings: Pick<AppSettings, 'cookiesFilePath' | 'cookiesBrowser'>,
  requestedInCurrentSession = false
): boolean {
  const retryRequested = job.input?.cookieRetryRequested === true;
  return (
    hasConfiguredCookies(settings) &&
    (requestedInCurrentSession || retryRequested || isCookieBlockingCode(job.errorCode))
  );
}
