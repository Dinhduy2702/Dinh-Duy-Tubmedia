import { describe, expect, it } from 'vitest';
import { builtInResourceProfiles } from '@main/settings/defaults.js';
import { DEFAULT_RESOURCE_PROFILE_ID } from '@shared/constants/app.js';
import { withMachineFfmpegThreads } from '@main/settings/resource-machine-threads.js';
import type { ResourceProfile } from '@shared/types/domain.js';

// 2026-11-05 (người dùng duyệt sửa A): hồ sơ mặc định luôn cho ffmpeg 6 luồng giải mã + 6 luồng mã hoá — máy 4 luồng đo được
// 1 bản mã hoá chiếm 93% CPU, 4 luồng bận 99%. Giờ: min(6, max(1, nửa số luồng logic)); người dùng tự chỉnh thì giữ nguyên.

const defaultProfile = builtInResourceProfiles.find((profile) => profile.id === DEFAULT_RESOURCE_PROFILE_ID)!;

describe('luồng ffmpeg của hồ sơ có sẵn tự theo máy', () => {
  it.each([
    [2, 1],
    [4, 2],
    [6, 3],
    [8, 4],
    [12, 6],
    [16, 6],
    [36, 6],
    [72, 6]
  ])('hồ sơ mặc định trên máy %i luồng → %i luồng ffmpeg', (logical, expected) => {
    expect(defaultProfile.ffmpegThreads).toBe(6);
    expect(withMachineFfmpegThreads(defaultProfile, logical).ffmpegThreads).toBe(expected);
  });

  it('máy báo 0/1 luồng → vẫn ít nhất 1 luồng', () => {
    expect(withMachineFfmpegThreads(defaultProfile, 0).ffmpegThreads).toBe(1);
    expect(withMachineFfmpegThreads(defaultProfile, 1).ffmpegThreads).toBe(1);
  });

  it('hồ sơ có sẵn khác cũng không vượt giá trị gốc của chính nó (Máy yếu 3 luồng: máy 4 luồng → 2, máy 16 luồng → 3)', () => {
    const low = builtInResourceProfiles.find((profile) => profile.id === 'resource-low')!;
    expect(withMachineFfmpegThreads(low, 4).ffmpegThreads).toBe(2);
    expect(withMachineFfmpegThreads(low, 16).ffmpegThreads).toBe(3);
  });

  it('người dùng đã tự chỉnh số luồng của hồ sơ có sẵn → giữ nguyên', () => {
    const edited: ResourceProfile = { ...defaultProfile, ffmpegThreads: 4 };
    expect(withMachineFfmpegThreads(edited, 2).ffmpegThreads).toBe(4);
  });

  it('hồ sơ người dùng tự tạo → giữ nguyên', () => {
    const custom: ResourceProfile = { ...defaultProfile, id: 'resource-cua-toi', builtIn: false, ffmpegThreads: 6 };
    expect(withMachineFfmpegThreads(custom, 4).ffmpegThreads).toBe(6);
  });

  it('không đổi gì khác của hồ sơ', () => {
    const result = withMachineFfmpegThreads(defaultProfile, 4);
    expect({ ...result, ffmpegThreads: defaultProfile.ffmpegThreads }).toEqual(defaultProfile);
  });
});
