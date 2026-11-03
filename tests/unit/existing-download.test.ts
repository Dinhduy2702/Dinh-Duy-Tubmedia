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

  // 2026-11-02 (người dùng báo dán lại link bị tải lại): tên tệp hiện nay là "<tiêu đề> [mã video] [LINK_…].mp4" — cách dò dự
  // phòng theo mã video (dùng khi mã link khác, ví dụ link dán dạng khác) trước đây KHÔNG BAO GIỜ khớp tên này.
  it('nhận tên tệp hiện tại "[mã video] [LINK_…].mp4" và bản CapCut (1.7.5); không nhận tệp tạm hay bản CapCut làm dở', () => {
    expect(isFinalDownloadForMediaId('Video [REPASTE0001] [LINK_2860A8CE4CE0].mp4', 'REPASTE0001')).toBe(true);
    expect(isFinalDownloadForMediaId('Video [REPASTE0001] [LINK_2860A8CE4CE0].mkv', 'REPASTE0001')).toBe(true);
    expect(isFinalDownloadForMediaId('Video [REPASTE0001] [LINK_2860A8CE4CE0].mp4', 'OTHER000001')).toBe(false);
    // 1.7.5 (người dùng duyệt dọn bản gốc trùng 2026-11-03): chỉ còn bản CapCut thì vẫn là video đã có — không tải lại.
    expect(isFinalDownloadForMediaId('Video [REPASTE0001] [LINK_2860A8CE4CE0].capcut-edit-1793589429019.mp4', 'REPASTE0001')).toBe(true);
    expect(
      isFinalDownloadForMediaId('Video [REPASTE0001] [LINK_2860A8CE4CE0].capcut-edit-1793589429019.pending.mp4', 'REPASTE0001')
    ).toBe(false);
    expect(isFinalDownloadForMediaId('Video [REPASTE0001] [LINK_2860A8CE4CE0].f270.mp4.part', 'REPASTE0001')).toBe(false);
    expect(isFinalDownloadForMediaId('Video [REPASTE0001] [ghi chú].mp4', 'REPASTE0001')).toBe(false);
  });

  it('không coi tệp tạm hoặc ID không an toàn là video hoàn tất', () => {
    expect(isFinalDownloadForMediaId('Video [abc123].mp4.part', 'abc123')).toBe(false);
    expect(isFinalDownloadForMediaId('Video [abc123].mp4', '../abc123')).toBe(false);
  });
});
