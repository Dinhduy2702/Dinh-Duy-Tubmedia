/**
 * Giai đoạn 6 mục 6 (2026-09-24) — "Xem thông tin tệp": các hàm định dạng dùng cho thẻ mới trong
 * StepPreviewCutPage.tsx. Chú ý đặc biệt: ffprobe trả bit_rate theo bit/giây (bps) — đã xác nhận thật
 * bằng ffprobe thật (video nominal 2000k → đo ~534829, audio nominal 128k → ~120804) trước khi viết
 * formatBitrate; test này khóa lại đúng phép chia /1000 để không lặp lại sai lệch 1000 lần.
 */
import { describe, expect, it } from 'vitest';
import {
  formatBitrate,
  formatFileSize,
  formatFps,
  formatHdr,
  formatVideoCodec
} from '../../src/shared/utils/media-info-format.js';

describe('Giai đoạn 6 mục 6 — media-info-format (Xem thông tin tệp)', () => {
  describe('formatFileSize', () => {
    it('chọn đúng đơn vị và số chữ số thập phân theo độ lớn', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(1536)).toBe('1.50 KB');
      expect(formatFileSize(15 * 1024 * 1024)).toBe('15.0 MB');
      expect(formatFileSize(150 * 1024 * 1024)).toBe('150 MB');
      expect(formatFileSize(2.5 * 1024 ** 3)).toBe('2.50 GB');
    });

    it('giá trị không hợp lệ (âm, NaN) trả về "0 B" thay vì hiển thị sai', () => {
      expect(formatFileSize(-5)).toBe('0 B');
      expect(formatFileSize(Number.NaN)).toBe('0 B');
    });
  });

  describe('formatFps', () => {
    it('bỏ phần thập phân khi fps là số nguyên', () => {
      expect(formatFps({ fps: 30, variableFrameRate: false })).toBe('30 fps');
    });

    it('giữ 2 chữ số thập phân khi fps lẻ (ví dụ NTSC 29.97)', () => {
      expect(formatFps({ fps: 29.97, variableFrameRate: false })).toBe('29.97 fps');
    });

    it('ghi chú rõ khi khung hình/giây thay đổi (variable frame rate)', () => {
      expect(formatFps({ fps: 30, variableFrameRate: true })).toBe('30 fps (khung hình/giây thay đổi)');
    });
  });

  describe('formatVideoCodec', () => {
    it('viết hoa tên codec, kèm profile/level nếu có', () => {
      expect(formatVideoCodec({ videoCodec: 'h264', videoProfile: 'High', videoLevel: '4.1' })).toBe(
        'H264 · High · 4.1'
      );
    });

    it('chỉ có tên codec khi không có profile/level', () => {
      expect(formatVideoCodec({ videoCodec: 'vp9', videoProfile: null, videoLevel: null })).toBe('VP9');
    });
  });

  describe('formatHdr', () => {
    it("không phải HDR: trả về 'Không (SDR)'", () => {
      expect(formatHdr({ hdr: false, hdrType: null })).toBe('Không (SDR)');
    });

    it('gọi đúng tên từng loại HDR', () => {
      expect(formatHdr({ hdr: true, hdrType: 'hdr10' })).toBe('HDR10');
      expect(formatHdr({ hdr: true, hdrType: 'hlg' })).toBe('HLG');
      expect(formatHdr({ hdr: true, hdrType: 'dolby_vision' })).toBe('Dolby Vision');
      expect(formatHdr({ hdr: true, hdrType: 'unknown' })).toBe('HDR (không rõ loại)');
    });

    it('HDR=true nhưng thiếu hdrType vẫn không để trống', () => {
      expect(formatHdr({ hdr: true, hdrType: null })).toBe('HDR');
    });
  });

  describe('formatBitrate — ffprobe trả bps, PHẢI chia 1000 ra kbps', () => {
    it('chuyển đúng bit/giây thật đo được từ ffprobe thật sang kbps', () => {
      // Số liệu THẬT đo bằng ffprobe thật trên một video test dựng bằng ffmpeg thật (không phải số bịa):
      // nominal video 2000k → ffprobe báo 534829 bps; nominal audio 128k → ffprobe báo 120804 bps.
      expect(formatBitrate(534829)).toBe('535 kbps');
      expect(formatBitrate(120804)).toBe('121 kbps');
    });

    it("không có bitrate (null): trả về 'Không rõ', không hiển thị '0 kbps' gây hiểu nhầm", () => {
      expect(formatBitrate(null)).toBe('Không rõ');
    });
  });
});
