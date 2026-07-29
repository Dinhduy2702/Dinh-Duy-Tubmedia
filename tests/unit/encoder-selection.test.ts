import { describe, expect, it } from 'vitest';
import { selectVideoEncoder } from '../../src/shared/utils/encoder-selection.js';

describe('CPU automatic encoder selection', () => {
  it('uses libx264 for H.264 in cpu_auto mode', () => {
    expect(selectVideoEncoder('h264', 'cpu_auto', ['libx264', 'h264_nvenc'], 1)).toMatchObject({
      encoder: 'libx264',
      usedCpuFallback: false
    });
  });

  it('uses libx265 for HEVC in cpu_auto mode', () => {
    expect(selectVideoEncoder('hevc', 'cpu_auto', ['libx265', 'hevc_nvenc'], 1)).toMatchObject({
      encoder: 'libx265',
      usedCpuFallback: false
    });
  });

  it('falls back to CPU when forced NVENC did not pass runtime health check', () => {
    const result = selectVideoEncoder('h264', 'h264_nvenc', ['libx264', 'h264_nvenc_unavailable'], 1);
    expect(result.encoder).toBe('libx264');
    expect(result.usedCpuFallback).toBe(true);
    expect(result.reason).toContain('không vượt qua kiểm tra runtime');
  });

  it('allows NVENC only when explicitly requested and runtime-tested', () => {
    expect(selectVideoEncoder('h264', 'h264_nvenc', ['libx264', 'h264_nvenc'], 1)).toMatchObject({
      encoder: 'h264_nvenc',
      usedCpuFallback: false
    });
  });

  it('falls back to CPU when GPU jobs are disabled', () => {
    expect(selectVideoEncoder('hevc', 'hevc_nvenc', ['libx265', 'hevc_nvenc'], 0)).toMatchObject({
      encoder: 'libx265',
      usedCpuFallback: true
    });
  });
});
