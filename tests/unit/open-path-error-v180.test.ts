import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../src/shared/errors/app-errors.js';

const root = process.cwd();
const registerIpc = readFileSync(join(root, 'src/main/ipc/register-ipc.ts'), 'utf8');
const stepPreviewCut = readFileSync(join(root, 'src/renderer/src/pages/StepPreviewCutPage.tsx'), 'utf8');

describe('#24: kiểm tra chuỗi lỗi shell.openPath và kết quả revealOutput', () => {
  it('openLocalPathOrThrow trả về "" khi shell.openPath thành công và ném InvalidInputError tiếng Việt khi thất bại', async () => {
    const { openLocalPathOrThrow } = await import('../../src/main/ipc/open-local-path.js');
    await expect(openLocalPathOrThrow('D:\\Video', () => Promise.resolve(''))).resolves.toBe('');
    await expect(
      openLocalPathOrThrow('D:\\Video\\chua-tao', () => Promise.resolve('The system cannot find the file specified.'))
    ).rejects.toThrow(InvalidInputError);
    await expect(
      openLocalPathOrThrow('D:\\Video\\chua-tao', () => Promise.resolve('Failed to open path'))
    ).rejects.toThrow(/Thư mục chưa được tạo hoặc tệp đã bị di chuyển/);
  });

  it('register-ipc.ts dùng openLocalPathOrThrow cho các đường dẫn mở qua shell.openPath', () => {
    expect(registerIpc).toContain('openLocalPathOrThrow(');
    expect(registerIpc).not.toMatch(/return shell\.openPath\(/);
  });

  it('StepPreviewCutPage kiểm tra giá trị boolean trả về của quickDownload.revealOutput và localCut.revealOutput', () => {
    expect(stepPreviewCut).not.toMatch(/onClick=\{\(\) => void window\.desktop\.quickDownload\.revealOutput\(/);
    expect(stepPreviewCut).not.toMatch(/onClick=\{\(\) => void window\.desktop\.localCut\.revealOutput\(/);
    expect(stepPreviewCut).toContain('if (!revealed)');
    expect(stepPreviewCut).toContain('Không thấy tệp đầu ra');
  });
});
