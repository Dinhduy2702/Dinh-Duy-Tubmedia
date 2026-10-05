/**
 * #4 (khám phá bản cài 2026-10-05) — lý do mã hóa NVIDIA (NVENC) không dùng được.
 * Trước đây bước kiểm tra chỉ để lại cờ "h264_nvenc_unavailable": người dùng có GTX 1060 thấy "NVIDIA chưa
 * khả dụng" mà không biết chỉ cần cập nhật driver. Định dạng stderr dưới đây lấy từ ffmpeg THẬT đi kèm 1.5.0.
 */
export const NVIDIA_DRIVER_DOWNLOAD_URL = 'https://www.nvidia.com/drivers/';

export interface GpuEncoderIssue {
  encoder: 'h264_nvenc' | 'hevc_nvenc';
  kind: 'driver-too-old' | 'unknown';
  requiredApi: string | null;
  foundApi: string | null;
  minimumDriver: string | null;
  exitCode: number | null;
  /** Dòng lỗi đầu tiên đã bỏ tiền tố "[h264_nvenc @ 0x…]" — để hỗ trợ khi không nhận ra lý do. */
  detail: string;
}

/** Windows trả mã thoát dạng số không dấu 32 bit (ffmpeg -40 → 4294967256). */
export function toSignedExitCode(code: number | null): number | null {
  if (code === null || !Number.isFinite(code)) return code;
  return code > 0x7fffffff && code <= 0xffffffff ? code - 0x100000000 : code;
}

function stripPrefix(line: string): string {
  return line.replace(/^(?:\[[^\]]*\]\s*)+/, '').trim();
}

export function diagnoseNvencFailure(
  encoder: GpuEncoderIssue['encoder'],
  stderr: string,
  exitCode: number | null
): GpuEncoderIssue {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const api = /required nvenc API version\.\s*Required:\s*([\d.]+)\s*Found:\s*([\d.]+)/i.exec(stderr);
  const driver = /minimum required Nvidia driver for nvenc is\s*([\d.]+)/i.exec(stderr);
  return {
    encoder,
    kind: api || driver ? 'driver-too-old' : 'unknown',
    requiredApi: api?.[1] ?? null,
    foundApi: api?.[2] ?? null,
    minimumDriver: driver?.[1] ?? null,
    exitCode: toSignedExitCode(exitCode),
    detail: stripPrefix(lines[0] ?? '').slice(0, 300)
  };
}

/** "32.0.15.6094" (DriverVersion của Windows) → "560.94" (số NVIDIA quen thuộc): 5 chữ số cuối. */
export function nvidiaDriverVersionFromWindows(value: string | null | undefined): string | null {
  if (!value || !/^\d+(?:\.\d+){3}$/.test(value)) return null;
  const digits = value.split('.').slice(2).join('');
  if (digits.length < 5) return null;
  const last = digits.slice(-5);
  return `${Number(last.slice(0, 3))}.${last.slice(3)}`;
}

export function describeGpuEncoderIssue(
  issue: GpuEncoderIssue,
  currentDriver: string | null
): { title: string; message: string; canUpdateDriver: boolean } {
  const current = currentDriver ? `Driver NVIDIA hiện tại (${currentDriver})` : 'Driver NVIDIA hiện tại';
  if (issue.kind === 'driver-too-old') {
    const need = issue.minimumDriver ? `cần driver ${issue.minimumDriver} trở lên` : 'cần driver NVIDIA mới hơn';
    const api = issue.requiredApi && issue.foundApi ? ` (NVENC API ${issue.foundApi}, cần ${issue.requiredApi})` : '';
    return {
      title: 'Driver NVIDIA quá cũ cho mã hóa bằng GPU',
      message:
        `${current} quá cũ cho bộ mã hóa GPU của FFmpeg đang dùng${api} — ${need}. ` +
        'Cập nhật driver NVIDIA để bật tăng tốc GPU; trong lúc đó Tubmedia dùng CPU (chậm hơn, chất lượng như nhau).',
      canUpdateDriver: true
    };
  }
  return {
    title: 'NVIDIA chưa khả dụng · CPU tự động đã thay thế',
    message:
      `FFmpeg không mở được bộ mã hóa NVIDIA${issue.detail ? `: ${issue.detail}` : ''}. ` +
      'Việc tải và ghép không bị gián đoạn — Tubmedia dùng CPU (chậm hơn, chất lượng như nhau). Cập nhật driver NVIDIA có thể khắc phục.',
    canUpdateDriver: true
  };
}
