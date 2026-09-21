import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  DiskFullError,
  InvalidInputError,
  ProcessCancelledError
} from '../../src/shared/errors/app-errors.js';
import { readTypedMessage } from '../../src/shared/utils/notice-tone.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { runWithWireErrors, toWireError } from '../../src/main/ipc/wire-error.js';

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('gắn dấu kiểu cho lỗi nghiệp vụ trước khi qua IPC', () => {
  it('AppError được gắn đúng mức theo mã', () => {
    const cancelled = toWireError(new ProcessCancelledError()) as Error;
    expect(readTypedMessage(cancelled.message)?.tone).toBe('neutral');
    const invalid = toWireError(new InvalidInputError('Sai đầu vào.')) as Error;
    expect(readTypedMessage(invalid.message)?.tone).toBe('warning');
    const disk = toWireError(new DiskFullError('D:')) as Error;
    expect(readTypedMessage(disk.message)).toMatchObject({ tone: 'error', code: 'DISK_FULL' });
  });

  it('lỗi lạ (không phải AppError) được giữ nguyên, không tự nhận là loại nào', () => {
    const plain = new Error('lạ');
    expect(toWireError(plain)).toBe(plain);
    expect(toWireError('chuỗi')).toBe('chuỗi');
  });

  it('bắt cả lỗi đồng bộ và lỗi bất đồng bộ', async () => {
    expect(() =>
      runWithWireErrors(() => {
        throw new AppError('UPDATE_BLOCKED_ACTIVE_WORK', 'Đang bận.');
      })
    ).toThrow(/\[\[tm:warning:UPDATE_BLOCKED_ACTIVE_WORK\]\]/);
    await expect(
      Promise.resolve(runWithWireErrors(() => Promise.reject(new AppError('DOWNLOAD_FAILED', 'Hỏng.'))))
    ).rejects.toThrow(/\[\[tm:error:DOWNLOAD_FAILED\]\]/);
    expect(runWithWireErrors(() => 42)).toBe(42);
    await expect(Promise.resolve(runWithWireErrors(() => Promise.resolve('ok')))).resolves.toBe('ok');
  });

  it('giao diện đọc lại đúng mức và không lộ dấu kiểu', () => {
    const wire = toWireError(
      new AppError('UPDATE_BLOCKED_ACTIVE_WORK', 'Hãy tạm dừng hoặc hoàn tất mọi tác vụ.')
    ) as Error;
    const issue = friendlyIssue(new Error(`Error invoking remote method 'x': Error: ${wire.message}`));
    expect(issue.tone).toBe('warning');
    expect(issue.message).toBe('Hãy tạm dừng hoặc hoàn tất mọi tác vụ.');
  });

  it('cả hai đường đăng ký IPC đều đi qua bộ gắn dấu kiểu', () => {
    const ipc = source('src/main/ipc/register-ipc.ts');
    expect(ipc).toContain("from './wire-error.js'");
    expect(ipc).toContain('runWithWireErrors(() => handler(schema.parse(raw)))');
    expect(ipc).toContain('runWithWireErrors(() => handler())');
    expect(ipc.match(/ipcMain\.handle\(/g)?.length).toBe(2);
  });

  it('các điều kiện chặn cập nhật là lỗi CÓ KIỂU, không phải Error thường', () => {
    const service = source('src/main/updates/app-update-service.ts');
    for (const code of [
      'UPDATE_NOT_NEWER',
      'UPDATE_DOWNLOAD_FAILED',
      'UPDATE_BLOCKED_ACTIVE_WORK',
      'UPDATE_INSTALL_PREPARATION_FAILED'
    ]) {
      expect(service).toContain(`'${code}'`);
    }
    expect(service).toMatch(/throw new AppError\(\s*'UPDATE_BLOCKED_ACTIVE_WORK'/);
    expect(source('src/shared/utils/notice-tone.ts')).toContain("'UPDATE_BLOCKED_ACTIVE_WORK'");
  });
});
