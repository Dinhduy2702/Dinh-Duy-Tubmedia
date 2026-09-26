import { describe, expect, it } from 'vitest';
import {
  buildCutSuggestions,
  buildSceneDetectArguments,
  buildSilenceDetectArguments,
  parseFfmpegDurationSeconds,
  parseSceneTimestamps,
  parseSilenceIntervals
} from '../../src/main/media/cut-suggestion.js';

// Sự cố/tính năng C1 (2026-09-26) — "Gợi ý điểm cắt tự động": dòng dưới đây là output THẬT (không bịa)
// lấy từ việc chạy FFmpeg 8.1.2 thật trên một video mẫu tự dựng (đỏ+có tiếng 3s, xanh dương+im lặng 2s,
// xanh lá+có tiếng 3s, tổng 8,02s) — xác nhận đúng định dạng thật trước khi viết regex phân tích, không
// đoán định dạng.
const REAL_SILENCE_DETECT_OUTPUT = [
  '  Duration: 00:00:08.02, start: 0.000000, bitrate: 66 kb/s',
  '[Parsed_silencedetect_0 @ 0000028d9b42dac0] silence_start: 3',
  '[Parsed_silencedetect_0 @ 0000028d9b42dac0] silence_end: 5.023288 | silence_duration: 2.023288'
];

const REAL_SCENE_DETECT_OUTPUT = [
  '  Duration: 00:00:08.02, start: 0.000000, bitrate: 66 kb/s',
  '[Parsed_showinfo_1 @ 000001e485c0a980] n:   0 pts:  38694 pts_time:3.022969 duration:    512 duration_time:0.04    fmt:yuv420p cl:left sar:1/1 s:320x240 i:P iskey:1 type:I checksum:7EEB9ECA plane_checksum:[699A0ED0 B1DB541A F17B3BE0] mean:[41 240 110] stdev:[0.0 0.0 0.0]',
  '[Parsed_showinfo_1 @ 000001e485c0a980] n:   1 pts:  64294 pts_time:5.022969 duration:    512 duration_time:0.04    fmt:yuv420p cl:left sar:1/1 s:320x240 i:P iskey:1 type:I checksum:8936587F plane_checksum:[EFD7F182 6D07AA86 859CBC59] mean:[81 91 81] stdev:[0.0 0.0 0.0]'
];

describe('cut-suggestion: xây tham số FFmpeg', () => {
  it('xây đúng tham số silencedetect với ngưỡng mặc định cố định', () => {
    const args = buildSilenceDetectArguments('E:\\video.mp4');
    expect(args).toContain('-af');
    expect(args[args.indexOf('-af') + 1]).toBe('silencedetect=noise=-30dB:d=0.5');
    expect(args).toContain('-vn');
    expect(args).not.toContain('-an');
  });

  it('xây đúng tham số phát hiện đổi cảnh với ngưỡng mặc định cố định', () => {
    const args = buildSceneDetectArguments('E:\\video.mp4');
    expect(args).toContain('-vf');
    expect(args[args.indexOf('-vf') + 1]).toBe("select='gt(scene,0.4)',showinfo");
    expect(args).toContain('-an');
    expect(args).not.toContain('-vn');
  });
});

describe('cut-suggestion: phân tích output FFmpeg thật', () => {
  it('đọc đúng thời lượng từ dòng Duration thật', () => {
    expect(parseFfmpegDurationSeconds(REAL_SILENCE_DETECT_OUTPUT)).toBeCloseTo(8.02, 2);
  });

  it('trả về null khi không có dòng Duration nào', () => {
    expect(parseFfmpegDurationSeconds(['không có gì liên quan'])).toBeNull();
  });

  it('ghép đúng cặp silence_start/silence_end thật thành một khoảng lặng', () => {
    const intervals = parseSilenceIntervals(REAL_SILENCE_DETECT_OUTPUT);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.start).toBeCloseTo(3, 3);
    expect(intervals[0]?.end).toBeCloseTo(5.023288, 5);
  });

  it('đọc đúng cả 2 mốc đổi cảnh thật từ showinfo', () => {
    const timestamps = parseSceneTimestamps(REAL_SCENE_DETECT_OUTPUT);
    expect(timestamps).toHaveLength(2);
    expect(timestamps[0]).toBeCloseTo(3.022969, 5);
    expect(timestamps[1]).toBeCloseTo(5.022969, 5);
  });
});

describe('cut-suggestion: ghép mốc thành đoạn gợi ý', () => {
  it('dùng đúng dữ liệu thật ở trên: chỉ giữ đoạn đủ dài (≥3s), bỏ các đoạn quá ngắn quanh khoảng lặng', () => {
    const duration = parseFfmpegDurationSeconds(REAL_SILENCE_DETECT_OUTPUT)!;
    const silences = parseSilenceIntervals(REAL_SILENCE_DETECT_OUTPUT);
    const scenes = parseSceneTimestamps(REAL_SCENE_DETECT_OUTPUT);
    const suggestions = buildCutSuggestions(duration, silences, scenes);

    // Mốc thật: 0(đầu) — 3.02(đổi cảnh) — 4.01(giữa khoảng lặng) — 5.02(đổi cảnh) — 8.02(cuối).
    // Đoạn (0→3.02)=3.02s hợp lệ. 2 đoạn giữa (~1s) bị loại vì dưới ngưỡng tối thiểu 3 giây. Đoạn cuối
    // (5.02→8.02)=2.997s cũng bị loại — dưới ngưỡng đúng vài mili giây (khác biệt encode thật của video
    // mẫu) — kết quả PHẢN ÁNH ĐÚNG hành vi thật của bộ lọc, không phải lỗi.
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.startSeconds).toBeCloseTo(0, 1);
    expect(suggestions[0]?.endSeconds).toBeCloseTo(3.02, 1);
    expect(suggestions[0]?.startReason).toBe('edge');
    expect(suggestions[0]?.endReason).toBe('scene');
  });

  it('trả về mảng rỗng khi không có mốc nào và cả video dài hơn ngưỡng tối đa', () => {
    expect(buildCutSuggestions(600, [], [])).toEqual([]);
  });

  it('trả về đúng cả video khi không có mốc nào nhưng đủ ngắn để nằm trong ngưỡng hợp lệ', () => {
    const suggestions = buildCutSuggestions(30, [], []);
    expect(suggestions).toEqual([{ startSeconds: 0, endSeconds: 30, startReason: 'edge', endReason: 'edge' }]);
  });

  it('giới hạn tối đa 8 đoạn dù phát hiện được nhiều điểm hơn', () => {
    // Dựng 20 mốc đổi cảnh cách đều 10 giây trên video 210 giây — đủ tạo hơn 8 đoạn hợp lệ (mỗi đoạn 10s).
    const scenes = Array.from({ length: 20 }, (_, index) => (index + 1) * 10);
    const suggestions = buildCutSuggestions(210, [], scenes);
    expect(suggestions.length).toBeLessThanOrEqual(8);
  });

  it('xếp đoạn dài nhất lên đầu', () => {
    const suggestions = buildCutSuggestions(100, [], [10, 20, 80]);
    // Các đoạn: [0,10]=10s [10,20]=10s [20,80]=60s [80,100]=20s — dài nhất phải đứng đầu.
    expect(suggestions[0]?.startSeconds).toBe(20);
    expect(suggestions[0]?.endSeconds).toBe(80);
  });

  it('bỏ qua thời lượng không hợp lệ (0, âm, NaN) mà không throw', () => {
    expect(buildCutSuggestions(0, [], [])).toEqual([]);
    expect(buildCutSuggestions(-5, [], [])).toEqual([]);
    expect(buildCutSuggestions(Number.NaN, [], [])).toEqual([]);
  });
});
