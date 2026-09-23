import { describe, expect, it } from 'vitest';
import { buildLocalCutArguments, buildLocalFrameExtractArguments } from '../../src/main/media/local-cut-command.js';

describe('Giai đoạn 6 mục 2 — lệnh ffmpeg cắt tệp có sẵn (local-cut-command)', () => {
  it('trích khung hình: tua bằng -ss trước -i (nhanh), luôn có -v error để bắt lỗi rõ ràng', () => {
    const args = buildLocalFrameExtractArguments('C:\\video.mp4', 12.5, 'C:\\out\\frame.jpg');
    expect(args).toEqual(['-y', '-v', 'error', '-ss', '12.5', '-i', 'C:\\video.mp4', '-frames:v', '1', '-q:v', '3', 'C:\\out\\frame.jpg']);
  });

  it('trích khung hình: mốc âm được kẹp về 0', () => {
    const args = buildLocalFrameExtractArguments('C:\\video.mp4', -5, 'C:\\out\\frame.jpg');
    expect(args).toContain('0');
    expect(args).not.toContain('-5');
  });

  it('sao chép nhanh (accurateCut=false): -c copy, -map 0 (giữ mọi luồng), không có tham số mã hóa lại', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 10,
      endSeconds: 25,
      accurateCut: false,
      outputPath: 'C:\\out.mp4'
    });

    expect(args).toEqual(
      expect.arrayContaining(['-ss', '10', '-i', 'C:\\in.mp4', '-t', '15', '-map', '0', '-c', 'copy'])
    );
    expect(args.some((arg) => ['-crf', '-preset', 'libx264', 'aac'].includes(arg))).toBe(false);
    expect(args).toContain('C:\\out.mp4');
  });

  it('chính xác (accurateCut=true): mã hóa lại libx264/aac, đúng thông số nhất quán với ClipEngine (veryfast, crf 18)', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 10,
      endSeconds: 25,
      accurateCut: true,
      outputPath: 'C:\\out.mp4'
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-ar', '48000', '-movflags', '+faststart'
      ])
    );
    expect(args).not.toContain('copy');
  });

  it('thời lượng luôn dương, tối thiểu 0.01 giây (chặn đoạn 0 giây gây lỗi ffmpeg)', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 10,
      endSeconds: 10,
      accurateCut: false,
      outputPath: 'C:\\out.mp4'
    });
    expect(args).toContain('0.01');
  });

  it('luôn báo tiến trình qua -progress pipe:1 (cả hai chế độ) để giao diện có thanh tiến trình', () => {
    for (const accurateCut of [true, false]) {
      const args = buildLocalCutArguments({
        filePath: 'C:\\in.mp4',
        startSeconds: 0,
        endSeconds: 10,
        accurateCut,
        outputPath: 'C:\\out.mp4'
      });
      expect(args).toEqual(expect.arrayContaining(['-progress', 'pipe:1']));
    }
  });
});
