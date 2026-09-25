import { describe, expect, it } from 'vitest';
import { ZodError, type ZodType } from 'zod';
import { downloadMergeSchema, settingsPatchSchema } from '../../src/shared/schemas/ipc.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { describeValidationIssues } from '../../src/shared/utils/validation-message.js';

/** Dựng đúng chuỗi mà renderer nhận khi kênh IPC ném ZodError. */
function ipcError(schema: ZodType, value: unknown, channel = 'settings:update'): string {
  try {
    schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) return `Error invoking remote method '${channel}': ZodError: ${error.message}`;
    throw error;
  }
  throw new Error('giá trị lẽ ra phải bị từ chối');
}

describe('Thông báo lỗi kiểm tra dữ liệu (ZodError) bằng tiếng Việt', () => {
  it('số vượt giới hạn trên: nêu tên ô và giá trị lớn nhất', () => {
    const issue = friendlyIssue(ipcError(settingsPatchSchema, { aria2Connections: 999 }));
    expect(issue.title).toBe('Dữ liệu chưa hợp lệ');
    expect(issue.message).toBe('Ô "Kết nối aria2c mỗi video": giá trị lớn nhất là 32.');
    expect(issue.tone).toBe('warning');
    expect(issue.steps).toHaveLength(1);
  });

  it('số dưới giới hạn dưới: nêu giá trị nhỏ nhất', () => {
    expect(friendlyIssue(ipcError(settingsPatchSchema, { aria2Connections: 0 })).message).toBe(
      'Ô "Kết nối aria2c mỗi video": giá trị nhỏ nhất là 1.'
    );
  });

  it('ô số bị để trống (NaN): yêu cầu nhập số hợp lệ', () => {
    expect(friendlyIssue(ipcError(settingsPatchSchema, { aria2Connections: Number.NaN })).message).toContain(
      'phải là một số hợp lệ'
    );
  });

  it('chuỗi quá dài: nêu số ký tự tối đa', () => {
    expect(friendlyIssue(ipcError(settingsPatchSchema, { proxy: 'p'.repeat(2100) })).message).toBe(
      'Ô "Proxy mạng": tối đa 2048 ký tự.'
    );
  });

  it('lựa chọn không hợp lệ và địa chỉ sai định dạng', () => {
    expect(friendlyIssue(ipcError(settingsPatchSchema, { theme: 'neon' })).message).toContain(
      'không nằm trong các lựa chọn cho phép'
    );
    expect(friendlyIssue(ipcError(settingsPatchSchema, { toolManifestUrl: 'khong-phai-url' })).message).toContain(
      'địa chỉ (URL) không hợp lệ'
    );
  });

  it('tên quy trình Tải & Ghép quá 160 ký tự: nêu đúng ô', () => {
    const value = {
      slot: 'merge-1',
      name: 'n'.repeat(161),
      linksText: 'https://example.com/a.mp4',
      sourceFolder: 'D:\\a',
      tempFolder: 'D:\\b',
      outputFolder: 'D:\\c',
      finalFileName: 'f',
      qualityProfileId: 'q',
      resourceProfileId: 'r',
      exportTimelineTxt: false
    };
    expect(friendlyIssue(ipcError(downloadMergeSchema, value, 'workbench:start-merge')).message).toBe(
      'Ô "Tên": tối đa 160 ký tự.'
    );
  });

  it('liệt kê tối đa 3 lỗi rồi gộp phần còn lại', () => {
    const message = describeValidationIssues(
      JSON.stringify(
        [1, 2, 3, 4, 5].map((n) => ({ code: 'too_big', origin: 'number', maximum: n, path: ['proxy'], message: 'x' }))
      )
    );
    expect(message?.match(/Ô "Proxy mạng"/g)).toHaveLength(3);
    expect(message).toContain('Và 2 lỗi khác.');
  });

  it('giữ nguyên hành vi cũ với văn bản không phải mảng lỗi zod', () => {
    expect(describeValidationIssues('[1,2,3]')).toBeNull();
    expect(describeValidationIssues('[]')).toBeNull();
    expect(describeValidationIssues('{"code":"too_big"}')).toBeNull();
    expect(describeValidationIssues('Không tìm thấy tệp')).toBeNull();
    expect(describeValidationIssues('[không phải json]')).toBeNull();
    expect(friendlyIssue("Error invoking remote method 'x': Error: Đường dẫn yt-dlp: Tên tệp phải là yt-dlp.exe.").message).toContain(
      'Tên tệp phải là yt-dlp.exe'
    );
  });
});
