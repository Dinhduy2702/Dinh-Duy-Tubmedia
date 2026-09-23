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
      aspectRatio: 'original',
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
      aspectRatio: 'original',
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
      aspectRatio: 'original',
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
        aspectRatio: 'original',
        outputPath: 'C:\\out.mp4'
      });
      expect(args).toEqual(expect.arrayContaining(['-progress', 'pipe:1']));
    }
  });
});

describe('Giai đoạn 6 mục 3 (2026-09-24) — đổi tỉ lệ khung hình (nền mờ kiểu CapCut)', () => {
  it('mỗi tỉ lệ dùng đúng độ phân giải chuẩn nền tảng: 9:16→1080x1920, 1:1→1080x1080, 16:9→1920x1080', () => {
    const dimensions: Record<'9:16' | '1:1' | '16:9', [number, number]> = {
      '9:16': [1080, 1920],
      '1:1': [1080, 1080],
      '16:9': [1920, 1080]
    };
    for (const [aspectRatio, [width, height]] of Object.entries(dimensions) as Array<
      ['9:16' | '1:1' | '16:9', [number, number]]
    >) {
      const args = buildLocalCutArguments({
        filePath: 'C:\\in.mp4',
        startSeconds: 0,
        endSeconds: 10,
        accurateCut: false,
        aspectRatio,
        outputPath: 'C:\\out.mp4'
      });
      const filterIndex = args.indexOf('-filter_complex');
      expect(filterIndex).toBeGreaterThanOrEqual(0);
      const filter = args[filterIndex + 1];
      expect(filter).toContain(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
      expect(filter).toContain(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
      expect(filter).toContain('gblur=sigma=20');
      expect(filter).toContain('overlay=(W-w)/2:(H-h)/2:format=auto,setsar=1');
    }
  });

  it('đổi tỉ lệ LUÔN mã hóa lại, kể cả khi accurateCut=false — bộ lọc pixel không thể đi cùng -c copy', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 0,
      endSeconds: 10,
      accurateCut: false,
      aspectRatio: '9:16',
      outputPath: 'C:\\out.mp4'
    });
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18']));
    expect(args).not.toContain('copy');
  });

  it('vẫn ánh xạ âm thanh tùy chọn (0:a:0?) để không lỗi khi nguồn không có âm thanh', () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 0,
      endSeconds: 10,
      accurateCut: true,
      aspectRatio: '1:1',
      outputPath: 'C:\\out.mp4'
    });
    expect(args).toEqual(expect.arrayContaining(['-map', '0:a:0?']));
  });

  it("aspectRatio='original' không thêm -filter_complex nào cả (giữ đúng hành vi cũ)", () => {
    const args = buildLocalCutArguments({
      filePath: 'C:\\in.mp4',
      startSeconds: 0,
      endSeconds: 10,
      accurateCut: true,
      aspectRatio: 'original',
      outputPath: 'C:\\out.mp4'
    });
    expect(args).not.toContain('-filter_complex');
  });

  it('trích khung hình xem trước: khi có aspectRatio khác original, dùng đúng bộ lọc nền mờ + đúng kích thước', () => {
    const args = buildLocalFrameExtractArguments('C:\\video.mp4', 5, 'C:\\out\\frame.jpg', '16:9');
    const filterIndex = args.indexOf('-filter_complex');
    expect(filterIndex).toBeGreaterThanOrEqual(0);
    expect(args[filterIndex + 1]).toContain('scale=1920:1080');
  });

  it("trích khung hình xem trước: aspectRatio mặc định 'original' không thêm bộ lọc nào (tương thích ngược)", () => {
    const args = buildLocalFrameExtractArguments('C:\\video.mp4', 5, 'C:\\out\\frame.jpg');
    expect(args).not.toContain('-filter_complex');
  });
});
