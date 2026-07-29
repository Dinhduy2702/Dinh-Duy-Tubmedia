import { describe, expect, it } from 'vitest';
import { isFinalDownloadForMediaId } from '../../src/main/downloader/download-engine.js';

describe('nhận diện video đã tải theo ID nguồn', () => {
  it('không nhầm hai video trùng tiêu đề nhưng khác ID', () => {
    expect(isFinalDownloadForMediaId('Cùng một tiêu đề [video_A].mp4', 'video_A')).toBe(true);
    expect(isFinalDownloadForMediaId('Cùng một tiêu đề [video_A].mp4', 'video_B')).toBe(false);
  });

  it('nhận đúng cùng ID dù tiêu đề và container khác nhau', () => {
    expect(isFinalDownloadForMediaId('Tiêu đề mới [abc-123_X].mkv', 'abc-123_X')).toBe(true);
    expect(isFinalDownloadForMediaId('Tên bất kỳ [abc-123_X].WEBM', 'abc-123_X')).toBe(true);
  });

  it('không coi tệp tạm hoặc ID không an toàn là video hoàn tất', () => {
    expect(isFinalDownloadForMediaId('Video [abc123].mp4.part', 'abc123')).toBe(false);
    expect(isFinalDownloadForMediaId('Video [abc123].mp4', '../abc123')).toBe(false);
  });
});
