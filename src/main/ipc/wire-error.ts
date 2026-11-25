import { AppError } from '@shared/errors/app-errors.js';
import { encodeTypedMessage, toneForErrorCode } from '@shared/utils/notice-tone.js';
import { formatAppFaultMessage } from '@shared/utils/user-action-message.js';

/** 1.8.0: lỗi kiểu lập trình — chỉ có thể do mã của ứng dụng sai, không do dữ liệu người dùng (SyntaxError của JSON.parse thì có). */
const PROGRAMMING_ERRORS: ReadonlySet<string> = new Set(['TypeError', 'ReferenceError', 'RangeError']);

export function isProgrammingError(error: unknown): error is Error {
  return error instanceof Error && !(error instanceof AppError) && PROGRAMMING_ERRORS.has(error.name);
}

/**
 * Lỗi đi qua IPC của Electron chỉ còn `message`. Ở đây gắn thêm dấu KIỂU (mức + mã) vào lỗi nghiệp vụ
 * (AppError) để giao diện biết chắc đó là lỗi, cảnh báo, thông tin hay trung tính thay vì đoán từ chữ.
 * 1.8.0: lỗi lập trình (TypeError…) là lỗi của ứng dụng → gọi onUnexpected (tự lưu báo cáo) và đổi thành câu "Lỗi của
 * ứng dụng" (chi tiết kỹ thuật chỉ ở mục Chi tiết). Lỗi lạ khác (câu đã viết sẵn cho người dùng) được giữ nguyên.
 */
export function toWireError(error: unknown, onUnexpected?: (error: Error) => void): unknown {
  if (isProgrammingError(error)) {
    try {
      onUnexpected?.(error);
    } catch {
      // Lưu báo cáo không được làm hỏng đường trả lỗi.
    }
    return new Error(formatAppFaultMessage({ technical: `${error.name}: ${error.message}` }));
  }
  if (!(error instanceof AppError)) return error;
  const wire = new Error(encodeTypedMessage(toneForErrorCode(error.code), error.code, error.message));
  wire.name = error.name;
  return wire;
}

/** Chạy một xử lý IPC (đồng bộ hoặc bất đồng bộ) và chuyển mọi lỗi nghiệp vụ sang dạng có kiểu. */
export function runWithWireErrors<Output>(
  action: () => Output | Promise<Output>,
  onUnexpected?: (error: Error) => void
): Output | Promise<Output> {
  try {
    const result = action();
    if (result instanceof Promise) {
      return result.catch((error: unknown) => {
        throw toWireError(error, onUnexpected);
      });
    }
    return result;
  } catch (error) {
    throw toWireError(error, onUnexpected);
  }
}
