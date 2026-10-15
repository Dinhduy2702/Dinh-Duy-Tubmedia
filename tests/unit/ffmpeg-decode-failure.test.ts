import { describe, expect, it } from 'vitest';
import {
  blockedOutputProblemLabel,
  describeFfmpegDecodeFailure
} from '../../src/shared/utils/ffmpeg-decode-failure.js';

// Nguyên văn stderr của khách 2026-10-15 (job 03002b08) — ffmpeg 8, hậu kiểm thành phẩm.
const CUSTOMER_AAC_STDERR = [
  'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'E:\\VIDEO GHÉP\\Tubmedia\\merge-checkpoints\\x.pending.mp4\':',
  '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 256 kb/s (default)',
  '[Parsed_blackdetect_0 @ 000001] black_start:29.966667 black_end:30.166667 black_duration:0.2',
  '[aac @ 0000022f9cfbaf40] error in spectral data, ESC overflow',
  '[aist#0:1/aac @ 0000022f9cef8700] [dec:aac @ 0000022fa16aeb40] Error submitting packet to decoder: Invalid data found when processing input',
  '[aist#0:1/aac @ 0000022f9cef8700] [dec:aac @ 0000022fa16aeb40] Error processing packet in decoder: Invalid data found when processing input',
  '[aist#0:1/aac @ 0000022f9cef8700] [dec:aac @ 0000022fa16aeb40] Task finished with error code: -1094995529 (Invalid data found when processing input)',
  '[aist#0:1/aac @ 0000022f9cef8700] [dec:aac @ 0000022fa16aeb40] Terminating thread with return code -1094995529 (Invalid data found when processing input)'
].join('\n');

const H264_STDERR = [
  '[Parsed_freezedetect_1 @ 000001] lavfi.freezedetect.freeze_start: 220.7',
  '[h264 @ 00000298e3fb2c40] Invalid NAL unit size (-2108689795 > 69951).',
  '[h264 @ 00000298e3fb2c40] missing picture in access unit with size 69955',
  '[vist#0:0/h264 @ 00000298e341f4c0] [dec:h264 @ 00000298e5805000] Error submitting packet to decoder: Invalid data found when processing input'
].join('\n');

describe('describeFfmpegDecodeFailure', () => {
  it('stderr của khách: lỗi ở luồng tiếng, giữ câu lỗi aac gốc, bỏ dòng thông tin/blackdetect', () => {
    const failure = describeFfmpegDecodeFailure(CUSTOMER_AAC_STDERR);
    expect(failure.stream).toBe('audio');
    expect(failure.detail).toContain('[aac @ 0000022f9cfbaf40] error in spectral data, ESC overflow');
    expect(failure.detail).toContain('Invalid data found when processing input');
    expect(failure.detail).not.toContain('black_start');
    expect(failure.detail).not.toContain('Stream #0:1');
  });

  it('lỗi h264 → luồng hình', () => {
    const failure = describeFfmpegDecodeFailure(H264_STDERR);
    expect(failure.stream).toBe('video');
    expect(failure.detail).toContain('Invalid NAL unit size');
    expect(failure.detail).not.toContain('freeze_start');
  });

  it('ffmpeg cũ chỉ in tên bộ giải mã (không có aist#/vist#) vẫn nhận ra luồng', () => {
    expect(describeFfmpegDecodeFailure('[aac @ 0x1] Prediction is not allowed in AAC-LC.').stream).toBe('audio');
    expect(describeFfmpegDecodeFailure('[hevc @ 0x1] Could not find ref with POC 12').stream).toBe('video');
  });

  it('không nhận ra luồng → null, vẫn giữ câu lỗi; cắt tối đa 1.500 ký tự', () => {
    const failure = describeFfmpegDecodeFailure('E:\\x.mp4: Invalid data found when processing input');
    expect(failure.stream).toBeNull();
    expect(failure.detail).toContain('Invalid data found when processing input');
    const long = describeFfmpegDecodeFailure(Array.from({ length: 200 }, (_, i) => `[aac @ 0x1] error ${i} ${'x'.repeat(40)}`).join('\n'));
    expect(long.detail.length).toBeLessThanOrEqual(1_500);
    expect(long.detail).toContain('error 199');
  });

  it('stderr rỗng → detail rỗng, không đoán luồng', () => {
    expect(describeFfmpegDecodeFailure('')).toEqual({ stream: null, detail: '' });
  });
});

describe('blockedOutputProblemLabel — câu "Tubmedia đã CHẶN thành phẩm vì phát hiện …"', () => {
  it('lỗi giải mã ở luồng tiếng → "lỗi âm thanh" (khách 2026-10-15 bị báo nhầm là lỗi hình ảnh)', () => {
    expect(blockedOutputProblemLabel({ type: 'decode', stream: 'audio' })).toBe('lỗi âm thanh');
  });

  it('lỗi giải mã hình, không rõ luồng, đoạn đen, hình đứng, không có vấn đề → giữ "lỗi hình ảnh"', () => {
    expect(blockedOutputProblemLabel({ type: 'decode', stream: 'video' })).toBe('lỗi hình ảnh');
    expect(blockedOutputProblemLabel({ type: 'decode', stream: null })).toBe('lỗi hình ảnh');
    expect(blockedOutputProblemLabel({ type: 'decode' })).toBe('lỗi hình ảnh');
    expect(blockedOutputProblemLabel({ type: 'black' })).toBe('lỗi hình ảnh');
    expect(blockedOutputProblemLabel({ type: 'freeze' })).toBe('lỗi hình ảnh');
    expect(blockedOutputProblemLabel(undefined)).toBe('lỗi hình ảnh');
  });
});
