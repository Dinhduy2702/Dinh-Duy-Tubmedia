import type { QualityProfile } from '../types/domain.js';

export type TargetVideoCodec = 'h264' | 'hevc';
export type ResolvedVideoEncoder = 'libx264' | 'libx265' | 'h264_nvenc' | 'hevc_nvenc';

export interface EncoderSelection {
  encoder: ResolvedVideoEncoder;
  cpuEncoder: 'libx264' | 'libx265';
  usedCpuFallback: boolean;
  reason: string | null;
}

export function isNvencEncoder(encoder: ResolvedVideoEncoder): encoder is 'h264_nvenc' | 'hevc_nvenc' {
  return encoder === 'h264_nvenc' || encoder === 'hevc_nvenc';
}

/**
 * CPU auto is intentionally conservative: it always selects libx264/libx265.
 * NVENC is used only when the user explicitly requests it, the selected codec
 * matches, a GPU job is allowed, and Tool Health Check proved the encoder works.
 */
export function selectVideoEncoder(
  targetCodec: TargetVideoCodec,
  requested: QualityProfile['encoder'],
  capabilities: readonly string[],
  gpuJobs: number
): EncoderSelection {
  const cpuEncoder = targetCodec === 'hevc' ? 'libx265' : 'libx264';

  if (requested === 'h264_nvenc') {
    if (targetCodec !== 'h264') {
      return {
        encoder: cpuEncoder,
        cpuEncoder,
        usedCpuFallback: true,
        reason: 'Profile yêu cầu H.264 NVENC nhưng đầu ra đang là HEVC; ứng dụng tự chuyển sang CPU.'
      };
    }
    if (gpuJobs <= 0) {
      return {
        encoder: cpuEncoder,
        cpuEncoder,
        usedCpuFallback: true,
        reason: 'GPU jobs đang bằng 0; ứng dụng tự dùng libx264 để giữ tác vụ ổn định.'
      };
    }
    if (!capabilities.includes('h264_nvenc')) {
      return {
        encoder: cpuEncoder,
        cpuEncoder,
        usedCpuFallback: true,
        reason: 'NVENC H.264 không vượt qua kiểm tra runtime; ứng dụng tự dùng libx264.'
      };
    }
    return { encoder: 'h264_nvenc', cpuEncoder, usedCpuFallback: false, reason: null };
  }

  if (requested === 'hevc_nvenc') {
    if (targetCodec !== 'hevc') {
      return {
        encoder: cpuEncoder,
        cpuEncoder,
        usedCpuFallback: true,
        reason: 'Profile yêu cầu HEVC NVENC nhưng đầu ra đang là H.264; ứng dụng tự chuyển sang CPU.'
      };
    }
    if (gpuJobs <= 0) {
      return {
        encoder: cpuEncoder,
        cpuEncoder,
        usedCpuFallback: true,
        reason: 'GPU jobs đang bằng 0; ứng dụng tự dùng libx265 để giữ tác vụ ổn định.'
      };
    }
    if (!capabilities.includes('hevc_nvenc')) {
      return {
        encoder: cpuEncoder,
        cpuEncoder,
        usedCpuFallback: true,
        reason: 'NVENC HEVC không vượt qua kiểm tra runtime; ứng dụng tự dùng libx265.'
      };
    }
    return { encoder: 'hevc_nvenc', cpuEncoder, usedCpuFallback: false, reason: null };
  }

  if (requested === 'auto') {
    const gpuEncoder: ResolvedVideoEncoder = targetCodec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc';
    if (gpuJobs > 0 && capabilities.includes(gpuEncoder)) {
      return { encoder: gpuEncoder, cpuEncoder, usedCpuFallback: false, reason: null };
    }
    return {
      encoder: cpuEncoder,
      cpuEncoder,
      usedCpuFallback: false,
      reason: gpuJobs <= 0
        ? 'Chế độ tự động đang dùng CPU vì cấu hình tài nguyên chưa cho phép tác vụ GPU.'
        : `Chế độ tự động đang dùng CPU vì ${gpuEncoder} chưa vượt qua kiểm tra runtime.`
    };
  }

  // cpu_auto luôn ưu tiên CPU để người dùng có một lựa chọn ổn định, dễ dự đoán.
  return { encoder: cpuEncoder, cpuEncoder, usedCpuFallback: false, reason: null };
}
