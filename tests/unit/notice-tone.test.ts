import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOTICE_TONES,
  NOTICE_TONE_LABEL,
  detailToneFor,
  encodeTypedMessage,
  isKnownErrorCode,
  noticeAriaRole,
  readTypedMessage,
  stripTypedMarker,
  toneForErrorCode,
  toneForStatus
} from '../../src/shared/utils/notice-tone.js';
import { isPersistentNoticeTone, notificationDuration } from '../../src/shared/utils/notification-policy.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('mức thông báo có kiểu', () => {
  it('có đúng năm mức, mỗi mức có nhãn chữ riêng', () => {
    expect([...NOTICE_TONES].sort()).toEqual(['error', 'info', 'neutral', 'success', 'warning']);
    const labels = NOTICE_TONES.map((tone) => NOTICE_TONE_LABEL[tone]);
    expect(new Set(labels).size).toBe(5);
    expect(labels).toContain('Lỗi');
    expect(labels).toContain('Cảnh báo');
  });

  it('mọi mã lỗi của AppError đều được phân loại rõ ràng, không rơi vào mặc định', () => {
    const codes = [...source('src/shared/errors/app-errors.ts').matchAll(/super\(\s*'([A-Z0-9_]+)'/g)].map(
      (match) => match[1] ?? ''
    );
    expect(codes.length).toBeGreaterThan(15);
    for (const code of codes) expect(isKnownErrorCode(code), code).toBe(true);
  });

  it('phân loại đúng: hủy/bỏ qua là trung tính, thiếu điều kiện là cảnh báo, hỏng thật là lỗi', () => {
    expect(toneForErrorCode('PROCESS_CANCELLED')).toBe('neutral');
    expect(toneForErrorCode('SOURCE_REMOVED')).toBe('neutral');
    expect(toneForErrorCode('UPDATE_NOT_NEWER')).toBe('info');
    for (const code of [
      'AUTHENTICATION_REQUIRED',
      'COOKIES_EXPIRED',
      'SOURCE_RATE_LIMITED',
      'NETWORK_ERROR',
      'INVALID_INPUT',
      'UPDATE_BLOCKED_ACTIVE_WORK'
    ]) {
      expect(toneForErrorCode(code), code).toBe('warning');
    }
    for (const code of ['DOWNLOAD_FAILED', 'MERGE_FAILED', 'DISK_FULL', 'TOOL_NOT_FOUND', 'VERIFICATION_FAILED']) {
      expect(toneForErrorCode(code), code).toBe('error');
    }
    expect(toneForErrorCode('MA_LA_CHUA_BIET')).toBe('error');
    expect(toneForErrorCode(null)).toBe('error');
  });

  it('trạng thái: tạm dừng, đã hủy, bỏ qua, chờ KHÔNG BAO GIỜ là lỗi; trạng thái lạ là trung tính', () => {
    for (const status of [
      'paused',
      'cancelled',
      'canceled',
      'skipped',
      'pending',
      'ready',
      'idle',
      'draft',
      'archived',
      'debug',
      'trang-thai-la'
    ]) {
      expect(toneForStatus(status), status).toBe('neutral');
    }
    for (const status of ['failed', 'error', 'broken', 'fatal']) expect(toneForStatus(status), status).toBe('error');
    for (const status of ['interrupted', 'warning', 'warn', 'blocked']) {
      expect(toneForStatus(status), status).toBe('warning');
    }
    for (const status of ['completed', 'success', 'healthy', 'valid']) {
      expect(toneForStatus(status), status).toBe('success');
    }
    for (const status of [
      'downloading',
      'analyzing',
      'verifying',
      'normalizing',
      'processing',
      'merging',
      'retrying',
      'info'
    ]) {
      expect(toneForStatus(status), status).toBe('info');
    }
    expect(toneForStatus('  CANCELLED ')).toBe('neutral');
  });

  it('chỉ lỗi thật mới nằm lại trên màn hình; mức khác tự tắt với thời gian riêng', () => {
    expect(isPersistentNoticeTone('error')).toBe(true);
    for (const tone of ['warning', 'info', 'success', 'neutral'] as const) {
      expect(isPersistentNoticeTone(tone)).toBe(false);
    }
    for (const tone of NOTICE_TONES) expect(notificationDuration(tone)).toBeGreaterThan(2_000);
    expect(notificationDuration('success')).toBeLessThan(notificationDuration('warning'));
  });

  it('chỉ lỗi và cảnh báo mới dùng role=alert; các mức khác dùng role=status', () => {
    expect(noticeAriaRole('error')).toBe('alert');
    expect(noticeAriaRole('warning')).toBe('alert');
    for (const tone of ['info', 'success', 'neutral'] as const) expect(noticeAriaRole(tone)).toBe('status');
  });

  it('biến thể chi tiết ứng với từng mức', () => {
    expect(detailToneFor('error')).toBe('danger');
    expect(detailToneFor('success')).toBe('good');
    expect(detailToneFor('warning')).toBe('warning');
    expect(detailToneFor('neutral')).toBe('neutral');
  });
});

describe('dấu kiểu trên lỗi đi qua IPC', () => {
  it('mã hóa rồi đọc lại đúng mức, mã và nội dung', () => {
    const wire = encodeTypedMessage('warning', 'UPDATE_BLOCKED_ACTIVE_WORK', 'Hãy tạm dừng tác vụ.');
    expect(readTypedMessage(wire)).toEqual({
      tone: 'warning',
      code: 'UPDATE_BLOCKED_ACTIVE_WORK',
      message: 'Hãy tạm dừng tác vụ.'
    });
    expect(stripTypedMarker(wire).trim()).toBe('Hãy tạm dừng tác vụ.');
    expect(readTypedMessage('Không có dấu')).toBeNull();
    expect(readTypedMessage('[[tm:khac:ABC]] x')).toBeNull();
  });

  it('làm sạch mã lạ khi mã hóa', () => {
    expect(encodeTypedMessage('error', 'mã lạ!', 'x')).toContain('[[tm:error:M__L_');
  });

  it('friendlyIssue ưu tiên mức trong dấu kiểu, kể cả khi lỗi bọc thêm tiền tố của Electron', () => {
    const wire = encodeTypedMessage(
      'warning',
      'UPDATE_BLOCKED_ACTIVE_WORK',
      'Hãy tạm dừng hoặc hoàn tất mọi tác vụ tải, cắt, ghép và Tải nhanh trước khi cập nhật.'
    );
    const issue = friendlyIssue(new Error(`Error invoking remote method 'updates:install': Error: ${wire}`));
    expect(issue.tone).toBe('warning');
    expect(issue.message).not.toContain('[[tm:');
    expect(issue.message).toContain('Hãy tạm dừng hoặc hoàn tất');
    expect(issue.title).toBe('Cần chú ý');
  });

  it('dấu kiểu thắng cách đoán theo chữ (chữ nghe như hủy nhưng thực ra là lỗi)', () => {
    const asError = friendlyIssue(encodeTypedMessage('error', 'DOWNLOAD_FAILED', 'Đã hủy vì máy chủ ngắt kết nối.'));
    expect(asError.tone).toBe('error');
    const asNeutral = friendlyIssue(encodeTypedMessage('neutral', 'PROCESS_CANCELLED', 'Tác vụ đã bị hủy.'));
    expect(asNeutral.tone).toBe('neutral');
  });

  it('lỗi có kiểu không để lộ dấu kiểu ra chữ hiển thị', () => {
    const issue = friendlyIssue(encodeTypedMessage('error', 'DISK_FULL', 'Ổ đĩa không đủ dung lượng: D:'));
    expect(issue.message).not.toMatch(/\[\[tm:|\]\]/);
    expect(issue.title).not.toMatch(/\[\[tm:/);
  });
});

describe('quy tắc: hủy / tạm dừng / bỏ qua / không có gì để dọn không bao giờ ra mức lỗi', () => {
  const outcomes = [
    'Đã hủy thao tác tắt chế độ ngủ đông.',
    'Đã hủy.',
    'Tác vụ đã bị hủy.',
    'Thao tác đã hủy.',
    'Không có gì để dọn.',
    'Không có gì để làm.'
  ];
  for (const text of outcomes) {
    it(`"${text}" không phải lỗi mà là trung tính`, () => {
      expect(friendlyIssue(text).tone).toBe('neutral');
    });
  }

  it('tác vụ bị hủy đi qua IPC (mã PROCESS_CANCELLED) là trung tính', () => {
    const wire = encodeTypedMessage(toneForErrorCode('PROCESS_CANCELLED'), 'PROCESS_CANCELLED', 'Tác vụ đã bị hủy.');
    expect(friendlyIssue(new Error(wire)).tone).toBe('neutral');
  });
});
