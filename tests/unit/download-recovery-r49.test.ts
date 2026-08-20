import { describe, expect, it } from 'vitest';
import { classifyYtDlpFailure, sanitizeYtDlpDiagnostic } from '../../src/shared/utils/download-failure.js';

describe('download recovery R49', () => {
  it('classifies 429 as an immediate source rate limit blocker', () => {
    expect(classifyYtDlpFailure('ERROR: HTTP Error 429: Too Many Requests')).toEqual({
      category: 'rate_limit',
      subtype: 'http_429',
      httpStatus: 429,
      retryable: false
    });
  });

  it('classifies authentication before generic retry handling', () => {
    const result = classifyYtDlpFailure("Sign in to confirm you're not a bot. Use --cookies.");
    expect(result.category).toBe('authentication');
    expect(result.retryable).toBe(false);
  });

  it('keeps plain 403 retryable so yt-dlp can refresh/resume', () => {
    expect(classifyYtDlpFailure('ERROR: HTTP Error 403: Forbidden')).toMatchObject({
      category: 'retryable',
      subtype: 'http_403',
      httpStatus: 403,
      retryable: true
    });
  });

  it('classifies fragment/network failures as retryable', () => {
    expect(
      classifyYtDlpFailure(
        'ERROR: Did not get any data blocks | ERROR: fragment 27 not found, unable to continue'
      )
    ).toMatchObject({
      category: 'retryable',
      subtype: 'fragment',
      retryable: true
    });
  });

  it('keeps explicitly removed video failures non-retryable', () => {
    expect(classifyYtDlpFailure('ERROR: Video unavailable. This video has been removed')).toMatchObject({
      category: 'non_retryable',
      subtype: 'removed',
      retryable: false
    });
  });

  it('redacts URL query strings and sensitive assignments from diagnostics', () => {
    const safe = sanitizeYtDlpDiagnostic(
      'ERROR https://example.com/v?id=123&sig=SECRET token=ABC cookie=SID123 Authorization=BearerSecret'
    );
    expect(safe).toContain('?[REDACTED]');
    expect(safe).not.toContain('SECRET');
    expect(safe).not.toContain('ABC');
    expect(safe).not.toContain('SID123');
    expect(safe).not.toContain('BearerSecret');
  });

  it('removes ANSI color sequences without a control-character regex literal', () => {
    const escape = String.fromCharCode(27);
    const colored = escape + '[31mERROR: HTTP Error 403: Forbidden' + escape + '[0m';
    expect(sanitizeYtDlpDiagnostic(colored)).toBe('ERROR: HTTP Error 403: Forbidden');
  });
});
