import { describe, expect, it } from 'vitest';
import {
  capCutFilterChain,
  capCutScaledSize,
  editEncodeLimit,
  isCapCutOneFileMode
} from '../../src/shared/utils/capcut-encode.js';
import { planCapCutCompatibility } from '../../src/shared/utils/download-quality.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';
import type { AppSettings, MediaInfo } from '../../src/shared/types/domain.js';

// 1.7.5 (người dùng duyệt 2026-11-03, đo thật trên máy 72 nhân): mỗi bản mã hoá CapCut ~8–11 nhân; 6 bản cùng lúc = CPU 93%.
// HDR 4K chuyển màu TRƯỚC khi thu nhỏ = 0,39x thời gian thực; thu nhỏ trước = 1,30x, SSIM 0,993.

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  duration: 600,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.0',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/15360',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  hdr: false,
  audioCodec: 'aac',
  videoBitrate: 5_000_000,
  audioBitrate: 128_000,
  sampleRate: 44_100,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  fileSize: 1,
  ...over
});
const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ ...defaultAppSettings, ...over });

describe('số bản mã hoá CapCut cùng lúc — theo CPU của máy đang chạy, chỉ dùng khoảng một nửa máy', () => {
  it('máy 72 nhân, 8 luồng mỗi bản → 3 (không phải 6 như 1.7.4)', () => {
    expect(editEncodeLimit(72, 8)).toBe(3);
  });
  it('máy phổ thông và máy yếu → 1', () => {
    expect(editEncodeLimit(16, 8)).toBe(1);
    expect(editEncodeLimit(8, 4)).toBe(1);
    expect(editEncodeLimit(4, 2)).toBe(1);
    expect(editEncodeLimit(2, 1)).toBe(1);
  });
  it('máy nhiều nhân hơn → nhiều bản hơn, không bao giờ dưới 1', () => {
    expect(editEncodeLimit(128, 8)).toBe(6);
    expect(editEncodeLimit(0, 0)).toBe(1);
  });
});

describe('HDR: thu nhỏ trước rồi mới chuyển màu (nhanh gấp ~3 lần, hình như cũ)', () => {
  it('HDR 4K → bước đầu tiên là zscale về đúng 1920x1080 kèm chuyển tuyến tính; không còn bước scale 4K phía sau', () => {
    const source = info({
      width: 3840,
      height: 2160,
      hdr: true,
      videoCodec: 'av1',
      pixelFormat: 'yuv420p10le'
    });
    const plan = planCapCutCompatibility(settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }), source);
    const chain = capCutFilterChain(plan, source);
    expect(chain[0]).toBe('zscale=w=1920:h=1080:t=linear:npl=100');
    expect(chain).toContain('tonemap=hable:desat=0');
    expect(chain.some((filter) => filter.startsWith('scale='))).toBe(false);
    expect(chain.slice(-2)).toEqual(['setsar=1', 'format=yuv420p']);
  });
  it('kích thước giống hệt bộ lọc scale cũ (force_original_aspect_ratio=decrease, số chẵn) — kể cả video dọc 9:16', () => {
    expect(capCutScaledSize(2160, 3840, 1920, 1080)).toEqual({ width: 608, height: 1080 });
    expect(capCutScaledSize(3840, 2160, 2560, 1440)).toEqual({ width: 2560, height: 1440 });
    expect(capCutScaledSize(1280, 720, 1920, 1080)).toEqual({ width: 1280, height: 720 });
  });
  it('SDR: chuỗi lọc giữ nguyên như trước (không đổi chất lượng bản SDR)', () => {
    const source = info({ width: 3840, height: 2160, videoCodec: 'vp9' });
    const plan = planCapCutCompatibility(settings({ downloadCompatibilityMode: 'capcut_sdr_1080p' }), source);
    expect(capCutFilterChain(plan, source)).toEqual([
      "scale=w='min(iw,1920)':h='min(ih,1080)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      'setsar=1',
      'format=yuv420p'
    ]);
  });
});

describe('một tệp mỗi video', () => {
  it('"CapCut trực tiếp" và không bật "tạo thêm bản CapCut" → một tệp', () => {
    expect(
      isCapCutOneFileMode(
        settings({ downloadCompatibilityMode: 'capcut_sdr_1080p', downloadEditCopyMode: 'off' })
      )
    ).toBe(true);
    expect(
      isCapCutOneFileMode(
        settings({ downloadCompatibilityMode: 'capcut_sdr_2k', downloadEditCopyMode: 'off' })
      )
    ).toBe(true);
  });
  it('chế độ giữ bản gốc + tạo thêm bản CapCut (2 tệp) giữ nguyên cho ai cần', () => {
    expect(
      isCapCutOneFileMode(
        settings({ downloadCompatibilityMode: 'source', downloadEditCopyMode: 'capcut_sdr_1080p' })
      )
    ).toBe(false);
    expect(
      isCapCutOneFileMode(
        settings({ downloadCompatibilityMode: 'capcut_sdr_1080p', downloadEditCopyMode: 'capcut_sdr_1080p' })
      )
    ).toBe(false);
    expect(
      isCapCutOneFileMode(settings({ downloadCompatibilityMode: 'source', downloadEditCopyMode: 'off' }))
    ).toBe(false);
  });
});
