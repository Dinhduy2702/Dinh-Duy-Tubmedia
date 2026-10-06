export interface DevelopmentEnvironment {
  /** Địa chỉ dev server của electron-vite; chỉ dùng khi chạy từ mã nguồn. */
  rendererUrl: string | undefined;
  /** Chế độ kiểm thử e2e (bỏ khóa một phiên bản, đổi thư mục dữ liệu); chỉ dùng khi chạy từ mã nguồn. */
  e2e: boolean;
  e2eUserData: string | undefined;
  /** Sự cố sau phát hành 2026-09-25: JSON AppUpdateStatus giả để bài kiểm e2e mô phỏng đúng sự kiện
   * "vừa phát hiện bản cập nhật mới" mà không cần mạng/máy chủ cập nhật thật. Chỉ dùng khi chạy từ mã
   * nguồn (isPackaged=false) và e2e=true — bản đã đóng gói bỏ qua hoàn toàn như mọi biến khác ở đây. */
  fakeUpdateStatusJson: string | undefined;
  /** 2026-10-06: tên bước dọn dẹp khi thoát cố ý làm TREO, để bài e2e "Thoát an toàn" chứng minh app vẫn thoát hẳn.
   * Chỉ có tác dụng khi e2e=true và chạy từ mã nguồn. */
  e2eShutdownHangStep: string | undefined;
}

/**
 * Các biến môi trường chỉ phục vụ phát triển/kiểm thử. Bản đã đóng gói bỏ qua hoàn toàn chúng, để
 * một tiến trình khác trên máy không thể đặt ELECTRON_RENDERER_URL nhằm nạp trang web từ xa vào cửa sổ
 * có preload, hay đặt TUBMEDIA_E2E để đổi thư mục dữ liệu và tắt khóa một phiên bản của ứng dụng.
 */
export function readDevelopmentEnvironment(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean
): DevelopmentEnvironment {
  if (isPackaged) {
    return {
      rendererUrl: undefined,
      e2e: false,
      e2eUserData: undefined,
      fakeUpdateStatusJson: undefined,
      e2eShutdownHangStep: undefined
    };
  }
  return {
    rendererUrl: env.ELECTRON_RENDERER_URL || undefined,
    e2e: env.TUBMEDIA_E2E === '1',
    e2eUserData: env.TUBMEDIA_E2E_USER_DATA || undefined,
    fakeUpdateStatusJson: env.TUBMEDIA_E2E_FAKE_UPDATE_STATUS_JSON || undefined,
    e2eShutdownHangStep:
      env.TUBMEDIA_E2E === '1' ? env.TUBMEDIA_E2E_SHUTDOWN_HANG_STEP || undefined : undefined
  };
}
