import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Thư mục để đo dung lượng trống của ổ chứa `folder` khi `folder` có thể chưa được tạo (2026-10-23: thư mục tạm của lượt tải
 * chỉ được tạo lúc bắt đầu tải). Đi lên thư mục cha gần nhất đang có — cùng ổ nên cùng dung lượng trống. Ổ đã bị rút thì không
 * còn thư mục nào → trả lại chính `folder` để statfs báo lỗi như với thư mục bắt buộc.
 */
export async function nearestExistingFolder(folder: string): Promise<string> {
  let current = resolve(folder);
  for (;;) {
    const isDirectory = await stat(current).then(
      (entry) => entry.isDirectory(),
      () => false
    );
    if (isDirectory) return current;
    const parent = dirname(current);
    if (parent === current) return folder;
    current = parent;
  }
}
