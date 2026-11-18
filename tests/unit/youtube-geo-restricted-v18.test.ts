import { describe, expect, it } from 'vitest';
import {
  classifyYtDlpFailure,
  finalDownloadFailureMessage,
  isGeoRestrictedText,
  ytDlpFailureLogMessage
} from '../../src/shared/utils/download-failure.js';
import { failureReasonLabel } from '../../src/shared/utils/failure-reason.js';

const REAL_QY8_STDERR =
  'ERROR: [youtube] qY8GrVdQsoY: The uploader has not made this video available in your country';

const REAL_COPYRIGHT_GEO_STDERR =
  'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. This video contains content from SME, who has blocked it in your country on copyright grounds';

describe('V18 — nhận diện lỗi video bị chặn theo quốc gia / vùng lãnh thổ (qY8GrVdQsoY)', () => {
  it('phân loại đúng câu "The uploader has not made this video available in your country" vào unavailable thay vì unknown', () => {
    const classified = classifyYtDlpFailure(REAL_QY8_STDERR);
    expect(classified).toEqual({
      category: 'non_retryable',
      subtype: 'unavailable',
      httpStatus: null,
      retryable: false
    });
    expect(isGeoRestrictedText(REAL_QY8_STDERR)).toBe(true);
    expect(isGeoRestrictedText(REAL_COPYRIGHT_GEO_STDERR)).toBe(true);
  });

  it('báo rõ tiếng Việt "chặn theo vùng / quốc gia" ở cả thông báo tác vụ, nhãn tóm tắt và dòng nhật ký Chẩn đoán', () => {
    const classified = classifyYtDlpFailure(REAL_QY8_STDERR);
    expect(
      failureReasonLabel({
        code: 'DOWNLOAD_FAILED',
        subtype: classified.subtype,
        platformLabel: 'YouTube',
        technicalSummary: REAL_QY8_STDERR
      })
    ).toBe('Video bị YouTube chặn theo vùng');

    const finalMsg = finalDownloadFailureMessage(classified.subtype, 'YouTube', REAL_QY8_STDERR);
    expect(finalMsg).toContain('bị chặn tại quốc gia');
    expect(finalMsg).toContain('VPN');
    expect(finalMsg).not.toContain('lỗi không xác định');

    const logMsg = ytDlpFailureLogMessage(classified.subtype, REAL_QY8_STDERR);
    expect(logMsg).toContain('chặn theo quốc gia');
    expect(logMsg).not.toContain('chưa xác định');
  });
});
