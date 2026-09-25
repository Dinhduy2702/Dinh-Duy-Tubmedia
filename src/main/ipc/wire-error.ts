import { AppError } from '@shared/errors/app-errors.js';
import { encodeTypedMessage, toneForErrorCode } from '@shared/utils/notice-tone.js';

/**
 * Lỗi đi qua IPC của Electron chỉ còn `message`. Ở đây gắn thêm dấu KIỂU (mức + mã) vào lỗi nghiệp vụ
 * (AppError) để giao diện biết chắc đó là lỗi, cảnh báo, thông tin hay trung tính thay vì đoán từ chữ.
 * Lỗi không phải AppError (lỗi lạ, chưa phân loại) được giữ nguyên.
 */
export function toWireError(error: unknown): unknown {
  if (!(error instanceof AppError)) return error;
  const wire = new Error(encodeTypedMessage(toneForErrorCode(error.code), error.code, error.message));
  wire.name = error.name;
  return wire;
}

/** Chạy một xử lý IPC (đồng bộ hoặc bất đồng bộ) và chuyển mọi lỗi nghiệp vụ sang dạng có kiểu. */
export function runWithWireErrors<Output>(action: () => Output | Promise<Output>): Output | Promise<Output> {
  try {
    const result = action();
    if (result instanceof Promise) {
      return result.catch((error: unknown) => {
        throw toWireError(error);
      });
    }
    return result;
  } catch (error) {
    throw toWireError(error);
  }
}
