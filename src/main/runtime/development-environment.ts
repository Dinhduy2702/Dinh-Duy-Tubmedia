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
  /** 2026-10-09: làm chậm queue.start() (ms, tối đa 60 s) — mô phỏng kết nối công cụ lâu lúc mở app, để bài e2e tạo tác vụ
   * chắc chắn TRƯỚC khi hàng đợi khởi động xong. Chỉ có tác dụng khi e2e=true và chạy từ mã nguồn; còn lại 0. */
  e2eQueueStartDelayMs: number;
  /** P2 (2026-10-10): gốc "ổ đĩa" giả cho khu cách ly (<gốc>\Tubmedia\quarantine) — bài e2e cần một lượt cách ly thật mà không
   * bao giờ tạo <ổ thật>\Tubmedia. Chỉ có tác dụng khi e2e=true và chạy từ mã nguồn. */
  e2eDriveRoot: string | undefined;
  /** Hướng B 429 (2026-10-12): thời gian nghỉ thay thế (ms, 100 ms – 60 s) cho mọi vòng chờ giới hạn nền tảng, để bài e2e
   * thấy cả lúc nghỉ lẫn lúc tự tiếp tục mà không chờ 2 phút thật. Chỉ có tác dụng khi e2e=true và chạy từ mã nguồn. */
  e2eRateLimitWaitMs: number | undefined;
  /** 2026-10-26: ghim trần tổng video tải cùng lúc (1–32) cho bài e2e không kiểm trần theo máy — máy GitHub yếu có trần thấp
   * hơn số video bài kiểm cần chạy song song. Chỉ có tác dụng khi e2e=true và chạy từ mã nguồn. */
  e2eGlobalDownloadCap: number | undefined;
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
      e2eShutdownHangStep: undefined,
      e2eQueueStartDelayMs: 0,
      e2eDriveRoot: undefined,
      e2eRateLimitWaitMs: undefined,
      e2eGlobalDownloadCap: undefined
    };
  }
  const queueStartDelay = Number(env.TUBMEDIA_E2E_QUEUE_START_DELAY_MS);
  const rateLimitWait = Number(env.TUBMEDIA_E2E_RATE_LIMIT_WAIT_MS);
  const globalDownloadCap = Number(env.TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP);
  return {
    rendererUrl: env.ELECTRON_RENDERER_URL || undefined,
    e2e: env.TUBMEDIA_E2E === '1',
    e2eUserData: env.TUBMEDIA_E2E_USER_DATA || undefined,
    fakeUpdateStatusJson: env.TUBMEDIA_E2E_FAKE_UPDATE_STATUS_JSON || undefined,
    e2eShutdownHangStep:
      env.TUBMEDIA_E2E === '1' ? env.TUBMEDIA_E2E_SHUTDOWN_HANG_STEP || undefined : undefined,
    e2eQueueStartDelayMs:
      env.TUBMEDIA_E2E === '1' && Number.isFinite(queueStartDelay) ? Math.min(Math.max(0, Math.trunc(queueStartDelay)), 60_000) : 0,
    e2eDriveRoot: env.TUBMEDIA_E2E === '1' ? env.TUBMEDIA_E2E_DRIVE_ROOT || undefined : undefined,
    e2eRateLimitWaitMs:
      env.TUBMEDIA_E2E === '1' && env.TUBMEDIA_E2E_RATE_LIMIT_WAIT_MS && Number.isFinite(rateLimitWait)
        ? Math.min(Math.max(100, Math.trunc(rateLimitWait)), 60_000)
        : undefined,
    e2eGlobalDownloadCap:
      env.TUBMEDIA_E2E === '1' && env.TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP && Number.isFinite(globalDownloadCap)
        ? Math.min(Math.max(1, Math.trunc(globalDownloadCap)), 32)
        : undefined
  };
}
