import { describe, expect, it } from 'vitest';
import { validateLocalCutRequest } from '../../src/shared/local-cut.js';

describe('Giai đoạn 6 mục 2 — validateLocalCutRequest (dùng lại parseQuickDownloadTime, không trùng lặp)', () => {
  it('chấp nhận yêu cầu hợp lệ, mặc định accurateCut = false khi không gửi', () => {
    const request = validateLocalCutRequest({
      filePath: 'C:\\video.mp4',
      outputDirectory: 'C:\\ra',
      startTime: '00:01:00',
      endTime: '00:02:30'
    });

    expect(request).toEqual({
      filePath: 'C:\\video.mp4',
      outputDirectory: 'C:\\ra',
      accurateCut: false,
      startSeconds: 60,
      endSeconds: 150
    });
  });

  it('chấp nhận accurateCut = true khi gửi rõ', () => {
    const request = validateLocalCutRequest({
      filePath: 'C:\\video.mp4',
      outputDirectory: 'C:\\ra',
      startTime: '10',
      endTime: '20',
      accurateCut: true
    });
    expect(request.accurateCut).toBe(true);
  });

  it('từ chối khi thiếu filePath hoặc outputDirectory', () => {
    expect(() =>
      validateLocalCutRequest({ outputDirectory: 'C:\\ra', startTime: '0', endTime: '5' })
    ).toThrow();
    expect(() =>
      validateLocalCutRequest({ filePath: 'C:\\video.mp4', startTime: '0', endTime: '5' })
    ).toThrow();
  });

  it('từ chối mốc kết thúc <= mốc bắt đầu, và đoạn ngắn hơn 1 giây', () => {
    expect(() =>
      validateLocalCutRequest({ filePath: 'a', outputDirectory: 'b', startTime: '10', endTime: '10' })
    ).toThrow(/lớn hơn/);
    expect(() =>
      validateLocalCutRequest({ filePath: 'a', outputDirectory: 'b', startTime: '10', endTime: '10.5' })
    ).toThrow(/1 giây/);
  });

  it('dùng lại đúng bộ phân tích giờ của Tải nhanh (chấp nhận HH:MM:SS, MM:SS, và số giây thuần)', () => {
    const request = validateLocalCutRequest({
      filePath: 'a',
      outputDirectory: 'b',
      startTime: '01:02:03',
      endTime: '01:05:03'
    });
    expect(request.startSeconds).toBe(3723);
    expect(request.endSeconds).toBe(3903);
  });
});
