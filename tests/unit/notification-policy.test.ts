import { describe, expect, it } from 'vitest';
import {
  isAttentionNoticeResolved,
  notificationDuration,
  shouldShowInlineBlockingIssue,
  SUCCESS_NOTIFICATION_DURATION_MS,
  TRANSIENT_NOTIFICATION_DURATION_MS,
  WARNING_NOTIFICATION_DURATION_MS
} from '@shared/utils/notification-policy.js';

const COOKIE_CODES = [
  'AUTHENTICATION_REQUIRED',
  'COOKIES_EXPIRED',
  'BROWSER_COOKIE_DATABASE_LOCKED'
] as const;

describe('notification policy', () => {
  it('uses readable, severity-aware auto-dismiss durations', () => {
    expect(TRANSIENT_NOTIFICATION_DURATION_MS).toBe(4_800);
    expect(SUCCESS_NOTIFICATION_DURATION_MS).toBe(3_600);
    expect(WARNING_NOTIFICATION_DURATION_MS).toBe(6_500);
    expect(notificationDuration('info')).toBe(4_800);
    expect(notificationDuration('success')).toBe(3_600);
    expect(notificationDuration('warning')).toBe(6_500);
  });

  it('shows cookie guidance while the related job is still blocked', () => {
    expect(
      shouldShowInlineBlockingIssue(
        {
          status: 'paused',
          errorCode: 'AUTHENTICATION_REQUIRED'
        },
        COOKIE_CODES
      )
    ).toBe(true);
  });

  it('hides stale cookie guidance immediately after the job is resumed', () => {
    expect(
      shouldShowInlineBlockingIssue(
        {
          status: 'pending',
          errorCode: 'AUTHENTICATION_REQUIRED'
        },
        COOKIE_CODES
      )
    ).toBe(false);
  });

  it('does not show an unrelated error as a cookie blocking issue', () => {
    expect(
      shouldShowInlineBlockingIssue(
        {
          status: 'failed',
          errorCode: 'NETWORK_ERROR'
        },
        COOKIE_CODES
      )
    ).toBe(false);
  });

  it('auto-resolves a sticky cookie notice after the blocked job returns to the queue', () => {
    const notice = {
      sticky: true,
      jobId: 'job-1',
      projectId: 'project-1',
      code: 'COOKIES_EXPIRED'
    };
    expect(
      isAttentionNoticeResolved(notice, [
        {
          id: 'job-1',
          projectId: 'project-1',
          status: 'paused',
          errorCode: 'COOKIES_EXPIRED'
        }
      ])
    ).toBe(false);
    expect(
      isAttentionNoticeResolved(notice, [
        {
          id: 'job-1',
          projectId: 'project-1',
          status: 'pending',
          errorCode: 'COOKIES_EXPIRED'
        }
      ])
    ).toBe(true);
  });

  it('keeps unrelated manually paused work separate from a resolved cookie notice', () => {
    expect(
      isAttentionNoticeResolved(
        {
          sticky: true,
          projectId: 'project-1',
          code: 'COOKIES_EXPIRED'
        },
        [
          {
            id: 'job-2',
            projectId: 'project-1',
            status: 'paused',
            errorCode: null
          }
        ]
      )
    ).toBe(true);
  });
});
