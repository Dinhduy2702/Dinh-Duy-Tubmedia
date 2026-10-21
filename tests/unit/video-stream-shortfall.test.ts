import { describe, expect, it } from 'vitest';
import { detectVideoStreamShortfall } from '../../src/shared/utils/video-stream-shortfall.js';
import { createYtDlpNoteCollector } from '../../src/shared/utils/ytdlp-notes.js';

// 2026-10-21, YouTube 1JtdsqPbsXw (10:41): tệp tải về có luồng tiếng đủ 640,75 s nhưng luồng hình chỉ 586,7 s — mất trọn
// 10 mảnh HLS (#16–#25, 1:21–2:15) mà yt-dlp vẫn báo mã 0. Kiểm tra cũ lấy max(hình, tiếng, container) = 640,75 ≈ 641 → đạt.
describe('phát hiện luồng hình ngắn hơn luồng tiếng / thời lượng nền tảng', () => {
  it('đúng ca thật: hình 586,7 s, tiếng 640,75 s, YouTube 641 s → hỏng, thiếu ~54 s so với luồng tiếng', () => {
    const shortfall = detectVideoStreamShortfall({ videoStreamDuration: 586.7, audioStreamDuration: 640.754649, expectedDuration: 641 });
    expect(shortfall).toMatchObject({ reference: 'audio', videoSeconds: 586.7, referenceSeconds: 640.754649 });
    expect(shortfall?.missingSeconds).toBeCloseTo(54.05, 1);
  });

  it('chỉ mất một mảnh 6 s cũng bị bắt (dung sai cố định 3 s, không theo phần trăm)', () => {
    expect(detectVideoStreamShortfall({ videoStreamDuration: 634.7, audioStreamDuration: 640.75, expectedDuration: 641 })).not.toBeNull();
  });

  it('bản tải lại đủ (hình 640,7 s, tiếng 640,75 s) → không hỏng', () => {
    expect(detectVideoStreamShortfall({ videoStreamDuration: 640.7, audioStreamDuration: 640.754649, expectedDuration: 641 })).toBeNull();
  });

  it('chênh lệch nhỏ thường gặp (≤ 3 s) → không hỏng', () => {
    expect(detectVideoStreamShortfall({ videoStreamDuration: 120, audioStreamDuration: 122.9, expectedDuration: null })).toBeNull();
  });

  it('tiếng dài hơn hình nhưng hình khớp thời lượng nền tảng → nguồn vốn vậy, không hỏng', () => {
    expect(detectVideoStreamShortfall({ videoStreamDuration: 60.1, audioStreamDuration: 75, expectedDuration: 60 })).toBeNull();
  });

  it('không có luồng tiếng: hình ngắn hơn thời lượng nền tảng quá max(3 s, 2%) → hỏng; trong dung sai → không', () => {
    expect(detectVideoStreamShortfall({ videoStreamDuration: 586.7, audioStreamDuration: null, expectedDuration: 641 })).toMatchObject({
      reference: 'expected',
      referenceSeconds: 641
    });
    expect(detectVideoStreamShortfall({ videoStreamDuration: 630, audioStreamDuration: null, expectedDuration: 641 })).toBeNull();
  });

  it('thiếu số đo (MKV/WebM không ghi thời lượng từng luồng) → không kết luận', () => {
    expect(detectVideoStreamShortfall({ videoStreamDuration: null, audioStreamDuration: 640, expectedDuration: 641 })).toBeNull();
    expect(detectVideoStreamShortfall({ videoStreamDuration: undefined, audioStreamDuration: undefined })).toBeNull();
  });
});

// Cách sửa 2 (2026-10-21): lần tải trên không để lại dấu vết vì app chỉ lưu lời nhắn của yt-dlp khi tải LỖI.
describe('gom lời nhắn của yt-dlp để lưu cả khi tải thành công', () => {
  it('giữ cảnh báo/lỗi/mảnh, bỏ dòng tiến độ và dòng nội bộ, che URL có tham số', () => {
    const notes = createYtDlpNoteCollector();
    for (const line of [
      '__VDMSP_PROGRESS__| 12.0%|5.00MiB/s|00:30|100|1000',
      '__VDMSP_FILE__:E:\\video.mp4',
      '[youtube] 1JtdsqPbsXw: Downloading webpage',
      '[hlsnative] Downloading m3u8 manifest',
      '[hlsnative] Total fragments: 122',
      '[download] Got error: HTTP Error 403: Forbidden. Retrying fragment 16 (1/20)...',
      'WARNING: [youtube] Some formats may be missing https://rr1.googlevideo.com/videoplayback?expire=1&sig=abc',
      '[download] fragment not found; Skipping fragment 17 ...',
      'ERROR: unable to download video data'
    ]) notes.push(line);

    const lines = notes.lines();
    expect(lines).toEqual([
      '[hlsnative] Total fragments: 122',
      '[download] Got error: HTTP Error 403: Forbidden. Retrying fragment 16 (1/20)...',
      'WARNING: [youtube] Some formats may be missing https://rr1.googlevideo.com/videoplayback?[REDACTED]',
      '[download] fragment not found; Skipping fragment 17 ...',
      'ERROR: unable to download video data'
    ]);
    expect(notes.hasProblems()).toBe(true);
  });

  it('chỉ có dòng tổng số mảnh → không có vấn đề; giới hạn 40 dòng, không trùng lặp', () => {
    const notes = createYtDlpNoteCollector();
    notes.push('[hlsnative] Total fragments: 122');
    expect(notes.hasProblems()).toBe(false);
    for (let i = 0; i < 100; i++) notes.push(`WARNING: lần ${i % 60}`);
    expect(notes.lines()).toHaveLength(40);
    expect(new Set(notes.lines()).size).toBe(40);
  });
});
