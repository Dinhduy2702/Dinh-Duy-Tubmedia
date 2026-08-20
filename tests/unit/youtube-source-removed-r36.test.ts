import { describe, expect, it } from 'vitest';
import {
  classifyYtDlpFailure,
  isExplicitlyRemovedYoutubeSource
} from '../../src/shared/utils/download-failure.js';

describe('R36 YouTube removed-source classification', () => {
  it('detects video explicitly removed by uploader', () => {
    const text =
      'ERROR: [youtube] abcdefghijk: Video unavailable. This video has been removed by the uploader';
    expect(isExplicitlyRemovedYoutubeSource(text)).toBe(true);
    expect(classifyYtDlpFailure(text)).toEqual({
      category: 'non_retryable',
      subtype: 'removed',
      httpStatus: null,
      retryable: false
    });
  });

  it('detects video removed for a YouTube policy reason', () => {
    const result = classifyYtDlpFailure(
      "ERROR: This video has been removed for violating YouTube's Terms of Service"
    );
    expect(result.subtype).toBe('removed');
    expect(result.retryable).toBe(false);
  });

  it('detects a terminated account removal message', () => {
    const result = classifyYtDlpFailure(
      'This video is no longer available because the YouTube account associated with this video has been terminated.'
    );
    expect(result.subtype).toBe('removed');
  });

  it('does not falsely call generic Video unavailable a deletion', () => {
    const result = classifyYtDlpFailure('ERROR: [youtube] abcdefghijk: Video unavailable');
    expect(result.subtype).toBe('unavailable');
  });

  it('does not call a private video deleted', () => {
    const result = classifyYtDlpFailure('ERROR: Private video. Sign in if you have been granted access.');
    expect(result.subtype).not.toBe('removed');
  });

  it('preserves rate-limit classification', () => {
    const result = classifyYtDlpFailure('ERROR: HTTP Error 429: Too Many Requests');
    expect(result.subtype).toBe('http_429');
    expect(result.category).toBe('rate_limit');
  });
});
