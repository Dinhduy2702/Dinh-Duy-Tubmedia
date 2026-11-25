import { formatUserActionMessage } from './user-action-message.js';

/**
 * 1.7.6 việc B (người dùng duyệt 2026-11-07): khi yt-dlp báo cookie YouTube "no longer valid … likely been rotated", lý do
 * thật là trình duyệt vẫn dùng tiếp phiên đăng nhập đã xuất nên tự đổi (xoay) cookie — bản đã xuất mất hiệu lực sau vài
 * phút (03/11: 20/18/80/0/144 phút). Cách lấy lại đúng (theo hướng dẫn của yt-dlp): xuất từ một cửa sổ ẩn danh rồi đóng
 * cửa sổ đó ngay, để trình duyệt không dùng tiếp — và không xoay — phiên đó nữa. Không đổi logic phát hiện cookie.
 */
export const COOKIE_ROTATED_TITLE = 'Cookie đã bị trình duyệt xoay (YouTube không nhận bản đã xuất nữa)';

export const COOKIE_ROTATED_REASON =
  'YouTube báo cookie đã xuất không còn hợp lệ vì trình duyệt vẫn dùng tiếp phiên đăng nhập đó và đã tự đổi ("xoay") ' +
  'cookie để bảo mật — không phải do Tubmedia, và xuất lại từ cùng cửa sổ đó thì cookie sẽ lại hỏng sau ít phút.';

export const COOKIE_INCOGNITO_EXPORT_STEPS: readonly string[] = [
  'Mở một cửa sổ ẩn danh mới (Chrome/Edge: Ctrl+Shift+N) và đăng nhập YouTube bằng tài khoản cần dùng.',
  'Ngay trong cửa sổ ẩn danh đó, xuất cookies (tệp cookies.txt) rồi dán hoặc chọn tệp trong Tubmedia.',
  'Đóng cửa sổ ẩn danh ngay sau khi xuất — không xem YouTube tiếp bằng phiên đó.',
  'Sau khi lưu, Tubmedia tự tiếp tục các video đang chờ cookies.'
];

/** Câu đầy đủ (lý do + cách lấy lại) cho lỗi của video / Tải nhanh. */
export function cookieRotatedMessage(): string {
  return `${COOKIE_ROTATED_REASON} Cách lấy lại đúng: ${COOKIE_INCOGNITO_EXPORT_STEPS.map((step, index) => `(${index + 1}) ${step}`).join(' ')}`;
}

/** Hướng dẫn ngắn trong hộp thêm cookies. */
export const COOKIE_INCOGNITO_HINT =
  'Để cookie dùng được lâu: xuất từ một cửa sổ ẩn danh vừa đăng nhập YouTube, rồi đóng cửa sổ đó ngay. Xuất từ cửa sổ ' +
  'bạn vẫn đang dùng thì trình duyệt sẽ tự "xoay" cookie và bản đã xuất hỏng sau ít phút.';

/**
 * #13: Chrome/Edge 127+ bật App-Bound Encryption khiến yt-dlp không tự giải mã được cookie trực tiếp (DPAPI / issues/10927).
 */
export function browserCookieDpapiMessage(browser?: string | null): string {
  const browserLabel =
    browser === 'edge' ? 'Microsoft Edge' : browser === 'chrome' ? 'Google Chrome' : 'Chrome/Edge';
  return formatUserActionMessage({
    title: `Không đọc được cookie trực tiếp từ ${browserLabel}`,
    summary:
      `${browserLabel} phiên bản 127+ khóa giải mã cookie trực tiếp trên Windows (lỗi DPAPI / App-Bound Encryption) nên công cụ tải không tự đọc được cookie — không phải lỗi của Tubmedia.`,
    steps: [
      `Mở ${browserLabel} (nên dùng cửa sổ ẩn danh rồi đóng sau khi xuất), cài tiện ích xuất cookie (ví dụ "Get cookies.txt LOCALLY") và xuất tệp cookies.txt.`,
      'Mở khung Cookies trong Tubmedia › chọn "Chọn tệp cookies.txt" hoặc "Dán cookies" rồi lưu lại (hoặc chuyển sang lấy cookie từ Firefox / Cốc Cốc).',
      'Sau khi lưu cookie mới, tác vụ đang chờ sẽ tự động tiếp tục tải lại.'
    ]
  });
}
