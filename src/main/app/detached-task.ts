/**
 * 1.7.6 việc D: chạy một việc không cần chờ (fire-and-forget) nhưng LUÔN bắt lỗi — thay cho `void promise` trần, vốn biến lỗi
 * thành unhandled rejection (mất ngữ cảnh, làm bài kiểm chập chờn). Lỗi đồng bộ lẫn bất đồng bộ đều đi vào `onError`; nếu
 * chính `onError` ném lỗi (ví dụ nhật ký đã đóng lúc tắt app) thì bỏ qua.
 */
export function runDetached(task: () => Promise<unknown>, onError: (error: unknown) => void): void {
  const report = (error: unknown): void => {
    try {
      onError(error);
    } catch {
      // Không còn chỗ nào để báo lỗi (nhật ký đã đóng) — không được để lỗi thoát ra ngoài.
    }
  };
  let pending: Promise<unknown>;
  try {
    pending = task();
  } catch (error) {
    report(error);
    return;
  }
  pending.catch(report);
}
