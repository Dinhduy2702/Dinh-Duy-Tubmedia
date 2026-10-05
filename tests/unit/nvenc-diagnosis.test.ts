import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeGpuEncoderIssue,
  diagnoseNvencFailure,
  NVIDIA_DRIVER_DOWNLOAD_URL,
  nvidiaDriverVersionFromWindows,
  toSignedExitCode
} from '../../src/shared/utils/nvenc-diagnosis.js';

// Khám phá bản cài 2026-10-05, vấn đề #4: máy có GTX 1060 nhưng NVENC "chưa khả dụng" mà không nói lý do.
// Nguyên văn stderr THẬT của ffmpeg đi kèm bản 1.5.0 (N-126856-ged27b2c498-20260925) trên máy người dùng,
// driver 560.94 — chụp ngày 2026-10-05, dùng làm dữ liệu mẫu thay vì đoán định dạng.
const REAL_STDERR = [
  '[h264_nvenc @ 000002406ecb3d80] Driver does not support the required nvenc API version. Required: 13.1 Found: 12.2',
  '[h264_nvenc @ 000002406ecb3d80] The minimum required Nvidia driver for nvenc is 610.00 or newer',
  '[vost#0:0/h264_nvenc @ 000002406ecb3280] [enc:h264_nvenc @ 000002406ec25280] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
  '[vf#0:0 @ 000002406eccec40] Error sending frames to consumers: Function not implemented'
].join('\n');

describe('#4 — phân tích lý do NVENC không dùng được', () => {
  it('driver quá cũ: lấy đúng API yêu cầu/hiện có và driver tối thiểu từ stderr thật', () => {
    const issue = diagnoseNvencFailure('h264_nvenc', REAL_STDERR, 4294967256);
    expect(issue).toEqual(
      expect.objectContaining({
        encoder: 'h264_nvenc',
        kind: 'driver-too-old',
        requiredApi: '13.1',
        foundApi: '12.2',
        minimumDriver: '610.00',
        exitCode: -40
      })
    );
  });

  it('lỗi lạ: không bịa lý do, giữ dòng lỗi đầu tiên (bỏ địa chỉ bộ nhớ) để hỗ trợ', () => {
    const issue = diagnoseNvencFailure('hevc_nvenc', '[hevc_nvenc @ 0000aa] No capable devices found\nfoo', 1);
    expect(issue.kind).toBe('unknown');
    expect(issue.minimumDriver).toBeNull();
    expect(issue.detail).toBe('No capable devices found');
  });

  it('mã thoát Windows dạng không dấu đổi về có dấu (4294967256 → -40)', () => {
    expect(toSignedExitCode(4294967256)).toBe(-40);
    expect(toSignedExitCode(0)).toBe(0);
    expect(toSignedExitCode(1)).toBe(1);
    expect(toSignedExitCode(null)).toBeNull();
  });

  it('đổi số phiên bản driver kiểu Windows sang số NVIDIA quen thuộc', () => {
    expect(nvidiaDriverVersionFromWindows('32.0.15.6094')).toBe('560.94');
    expect(nvidiaDriverVersionFromWindows('31.0.15.5222')).toBe('552.22');
    expect(nvidiaDriverVersionFromWindows('khong-hop-le')).toBeNull();
    expect(nvidiaDriverVersionFromWindows(null)).toBeNull();
  });

  it('câu hiển thị tiếng Việt nói rõ lý do, driver hiện tại, driver cần và việc CPU thay thế', () => {
    const text = describeGpuEncoderIssue(diagnoseNvencFailure('h264_nvenc', REAL_STDERR, 4294967256), '560.94');
    expect(text.title).toBe('Driver NVIDIA quá cũ cho mã hóa bằng GPU');
    expect(text.message).toContain('Driver NVIDIA hiện tại (560.94)');
    expect(text.message).toContain('610.00');
    expect(text.message).toContain('CPU');
    expect(text.canUpdateDriver).toBe(true);
    const unknownDriver = describeGpuEncoderIssue(diagnoseNvencFailure('h264_nvenc', REAL_STDERR, -40), null);
    expect(unknownDriver.message).toContain('Driver NVIDIA hiện tại');
    expect(unknownDriver.message).not.toContain('()');
  });

  it('địa chỉ tải driver là trang chính thức của NVIDIA, HTTPS', () => {
    expect(NVIDIA_DRIVER_DOWNLOAD_URL).toBe('https://www.nvidia.com/drivers/');
  });
});

describe('#4 — nối vào app (test canh mã nguồn)', () => {
  const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

  it('IPC mở trang driver chỉ dùng địa chỉ cố định, không nhận URL từ giao diện', () => {
    const ipc = read('src/main/ipc/register-ipc.ts');
    expect(read('src/shared/contracts/channels.ts')).toContain("openNvidiaDriverPage: 'tools:open-nvidia-driver-page'");
    expect(ipc).toMatch(/noArgs\(IPC\.tools\.openNvidiaDriverPage,[^)]*\)\s*=>\s*shell\.openExternal\(NVIDIA_DRIVER_DOWNLOAD_URL\)/);
    expect(read('src/preload/index.ts')).toContain('openNvidiaDriverPage');
  });

  it('trang Công cụ và Chẩn đoán hiện lý do + nút "Tải driver NVIDIA"', () => {
    for (const page of ['src/renderer/src/pages/ToolsPage.tsx', 'src/renderer/src/pages/DiagnosticsPage.tsx']) {
      const source = read(page);
      expect(source, page).toContain('GpuEncoderIssueNotice');
    }
    const notice = read('src/renderer/src/components/GpuEncoderIssueNotice.tsx');
    expect(notice).toContain('describeGpuEncoderIssue(');
    expect(notice).toContain('Tải driver NVIDIA');
    expect(notice).toContain('window.desktop.tools.openNvidiaDriverPage()');
  });

  it('nhật ký tiến trình in mã thoát có dấu', () => {
    expect(read('src/main/processes/process-manager.ts')).toContain('kết thúc với mã ${toSignedExitCode(code)}');
  });
});
