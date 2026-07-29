import { describe, expect, it } from 'vitest';
import {
  isActionableDiagnostic,
  shouldDisplayDiagnostic,
  TRANSIENT_DIAGNOSTIC_DURATION_MS
} from '../../src/shared/utils/diagnostic-policy.js';

const cookieLog = {
  id: 'log-1',
  timestamp: '2026-07-28T03:00:00.000Z',
  level: 'error' as const,
  module: 'download',
  eventCode: 'COOKIES_EXPIRED',
  message: 'Cookies hết hạn.',
  projectId: 'project-1',
  jobId: 'job-1'
};

describe('diagnostic policy', () => {
  it('does not surface an API fallback that already recovered', () => {
    expect(isActionableDiagnostic({ level: 'info', eventCode: 'TOOL_RELEASE_API_DIRECT_FALLBACK' })).toBe(
      false
    );
  });
  it('does not surface automatic recovery or estimate-only events as fixed errors', () => {
    expect(isActionableDiagnostic({ level: 'warn', eventCode: 'JOB_RETRY_SCHEDULED' })).toBe(false);
    expect(isActionableDiagnostic({ level: 'warn', eventCode: 'COOKIE_RETRY_SCHEDULED' })).toBe(false);
    expect(isActionableDiagnostic({ level: 'info', eventCode: 'COOKIE_BLOCKS_AUTO_RESUMED' })).toBe(false);
    expect(
      isActionableDiagnostic({ level: 'info', eventCode: 'LEGACY_SIZE_ESTIMATE_FAILURES_RECOVERED' })
    ).toBe(false);
    expect(isActionableDiagnostic({ level: 'info', eventCode: 'DOWNLOAD_SIZE_ESTIMATE_MISMATCH' })).toBe(
      false
    );
  });
  it('surfaces real errors and actionable warnings', () => {
    expect(isActionableDiagnostic({ level: 'error', eventCode: 'MERGE_FAILED' })).toBe(true);
    expect(isActionableDiagnostic({ level: 'warn', eventCode: 'DISK_FULL' })).toBe(true);
  });
  it('keeps a cookie diagnostic only while its job is still blocked', () => {
    expect(
      shouldDisplayDiagnostic(
        cookieLog,
        [
          {
            id: 'job-1',
            projectId: 'project-1',
            status: 'paused',
            errorCode: 'COOKIES_EXPIRED'
          }
        ],
        Date.parse(cookieLog.timestamp) + 30_000
      )
    ).toBe(true);
    expect(
      shouldDisplayDiagnostic(
        cookieLog,
        [
          {
            id: 'job-1',
            projectId: 'project-1',
            status: 'pending',
            errorCode: 'COOKIES_EXPIRED'
          }
        ],
        Date.parse(cookieLog.timestamp) + 100
      )
    ).toBe(false);
  });
  it('expires a global diagnostic instead of pinning it forever', () => {
    const globalLog = {
      id: cookieLog.id,
      timestamp: cookieLog.timestamp,
      level: cookieLog.level,
      module: cookieLog.module,
      eventCode: cookieLog.eventCode,
      message: cookieLog.message
    };
    expect(
      shouldDisplayDiagnostic(
        globalLog,
        [],
        Date.parse(globalLog.timestamp) + TRANSIENT_DIAGNOSTIC_DURATION_MS - 1
      )
    ).toBe(true);
    expect(
      shouldDisplayDiagnostic(
        globalLog,
        [],
        Date.parse(globalLog.timestamp) + TRANSIENT_DIAGNOSTIC_DURATION_MS + 1
      )
    ).toBe(false);
  });
});
