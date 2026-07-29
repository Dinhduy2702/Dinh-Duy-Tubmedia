import { describe, expect, it } from 'vitest';
import {
  buildWindowsProcessControlScript,
  isTransientWindowsProcessNtStatus,
  TRANSIENT_WINDOWS_PROCESS_NTSTATUS
} from '../../src/main/processes/process-manager.js';

describe('điều khiển tiến trình Windows', () => {
  it('nhận diện PID đang kết thúc là xung đột thời điểm có thể bỏ qua', () => {
    expect(isTransientWindowsProcessNtStatus(-1073741558)).toBe(true);
    expect(isTransientWindowsProcessNtStatus(-1073741813)).toBe(true);
    expect(isTransientWindowsProcessNtStatus(-1073741790)).toBe(false);
  });

  it('đưa các mã tạm thời vào script tạm dừng cây tiến trình', () => {
    const script = buildWindowsProcessControlScript(42624, 'pause');

    expect(script).toContain('$transientWindowsErrors = @(87, 1168)');
    expect(script).toContain(
      `$transientNtStatus = @(${TRANSIENT_WINDOWS_PROCESS_NTSTATUS.join(', ')})`
    );
    expect(script).toContain('$transientNtStatus -contains $result');
    expect(script).toContain('NtSuspendProcess');
    expect(script).toContain('Add-TubmediaProcessTree 42624');
    expect(script).toContain('NtResumeProcess($rollbackHandle)');
    expect(script).toContain('$rootUnavailable');
  });

  it('tiếp tục cây tiến trình theo thứ tự từ tiến trình cha', () => {
    const script = buildWindowsProcessControlScript(42624, 'resume');

    expect(script).toContain('$targets.Reverse()');
    expect(script).toContain('NtResumeProcess');
    expect(script).not.toContain('$rollbackHandle');
  });

  it('không cho phép chèn PID không hợp lệ vào PowerShell', () => {
    expect(() => buildWindowsProcessControlScript(0, 'pause')).toThrow(
      'PID Windows không hợp lệ'
    );
    expect(() => buildWindowsProcessControlScript(Number.NaN, 'pause')).toThrow(
      'PID Windows không hợp lệ'
    );
  });
});
