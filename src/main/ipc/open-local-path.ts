import { InvalidInputError } from '@shared/errors/app-errors.js';

/**
 * Electron `shell.openPath` trả về `""` khi mở thành công và trả về chuỗi lỗi không rỗng khi thất bại
 * (ví dụ thư mục chưa được tạo hoặc tệp đã bị di chuyển). Ném lỗi nghiệp vụ tiếng Việt để kênh IPC từ chối
 * thay vì trả về thành công giả.
 */
export async function openLocalPathOrThrow(
  targetPath: string,
  openPath: (path: string) => Promise<string>
): Promise<string> {
  const openError = await openPath(targetPath);
  if (openError) {
    throw new InvalidInputError(
      `Không mở được đường dẫn "${targetPath}". Thư mục chưa được tạo hoặc tệp đã bị di chuyển (${openError}).`
    );
  }
  return '';
}
