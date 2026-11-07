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
