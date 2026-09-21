# Kiểm kê thông báo — Tubmedia 1.4 (Giai đoạn 1)

Bảng này liệt kê các thông báo, nhãn trạng thái và hộp thoại của ứng dụng, **mức thật** của từng loại, màu ở
v1.3.7 và màu mới theo bảng màu phương án C. Nguồn số liệu:

- 123 điểm gọi `setAttention` / `setError` / `notify` ở 22 tệp giao diện + 3 điểm gửi từ `queue-manager` +
  luật `tone` trong `ui-error.ts` (trích bằng kịch bản đọc mã nguồn, không phải ước đoán);
- "Màu cũ" của thông báo có chữ cố định lấy bằng cách **chạy đúng hàm `friendlyIssue` của v1.3.7** trên từng câu;
- màu nền cũ lấy từ CSS v1.3.7 (`--accent` = đỏ thương hiệu, `--warn` = vàng, `--good` = xanh lá, `--bad` = đỏ).

## Quy tắc mức

| Mức | Khi nào | Màu mới | Biểu tượng + nhãn chữ | Tự tắt? |
|---|---|---|---|---|
| Lỗi | Việc đang làm bị hỏng thật | đỏ `#B3261E` | ⊗ "Lỗi" | **Không** (đóng được) |
| Cảnh báo | Việc vẫn chạy nhưng cần chú ý, hoặc thiếu điều kiện | vàng cam `#B26A00` | ⚠ "Cảnh báo" | 6,5 giây |
| Thông tin | Thông tin, tiến trình | xanh dương `#1F5FBF` | ⓘ "Thông tin" | 4,8 giây |
| Thành công | Hoàn tất | xanh lá `#1F7A3D` | ✓ "Thành công" | 3,6 giây |
| Ghi nhận (trung tính) | Đã hủy, tạm dừng, bỏ qua, không có gì để làm | xám `#5F5B55` | ⊖ "Đã ghi nhận" | 4,8 giây |

Nhật ký đầy đủ luôn còn trong **Trung tâm thông báo** và trang **Nhật ký**, kể cả khi thông báo nổi đã tự tắt.

## A. Thông báo có chữ cố định do giao diện tạo ra

"Màu cũ" ở cột này là màu **thông báo nổi** ở v1.3.7. Lưu ý quan trọng: ở v1.3.7 mức "thông tin" của thông báo nổi
dùng `--accent`, tức **màu ĐỎ thương hiệu** — nên mọi thông báo thông tin (kể cả "Đã hủy…") hiện đỏ.

| Nơi tạo | Nội dung | Mức thật | Màu cũ | Màu mới | Đã sửa |
|---|---|---|---|---|---|
| `SystemCleanupPanel` | "Đã hủy thao tác tắt chế độ ngủ đông." | Trung tính | đỏ (thông tin → `--accent` đỏ) | xám | ✔ `showNotice('neutral')` |
| `SystemCleanupPanel` | "Hãy chọn ít nhất một hạng mục." | Cảnh báo | vàng | vàng | ✔ đổi sang `showNotice('warning')` |
| `SystemCleanupPanel` | "Hãy quét dung lượng với đúng phạm vi… trước khi xóa." | Cảnh báo | **đỏ** (lỗi) | vàng | ✔ |
| `SystemCleanupPanel` | "Các hạng mục đang chọn chỉ dùng để lập báo cáo…" | Thông tin | **đỏ** (lỗi) | xanh dương | ✔ |
| `QuickDownloadPanel` | "Không thể sao chép liên kết…" | Cảnh báo | **đỏ** (lỗi) | vàng | ✔ |
| `QuickDownloadPanel` | "File đầu ra không còn tồn tại." | Cảnh báo | **đỏ** (lỗi) | vàng | ✔ |
| `QueuePage` | "File đầu ra của Tải nhanh không còn tồn tại." | Cảnh báo | **đỏ** (lỗi) | vàng | ✔ |
| `ImportLinksDialog` | "Chỉ hỗ trợ kéo thả tệp TXT hoặc CSV." | Cảnh báo | vàng | vàng | ✔ |
| `DownloadWorkbenchPage` | "Một danh sách sắp bị ẩn vẫn đang chạy…" | Cảnh báo | **đỏ** (lỗi) | vàng | ✔ |
| `DownloadMergePage` | "Một quy trình ghép sắp bị ẩn vẫn đang chạy…" | Cảnh báo | **đỏ** (lỗi) | vàng | ✔ |
| `DownloadWorkbenchPage` | "Danh sách N đã hủy" | Trung tính | vàng (cảnh báo) | xám | ✔ |
| `DownloadWorkbenchPage` | "Danh sách N đã tạm dừng" | Trung tính | xanh lá (thành công) | xám | ✔ |
| `DownloadWorkbenchPage` | "Danh sách N đã tiếp tục" / "đã bắt đầu" | Thành công | xanh lá | xanh lá | — |
| `DownloadWorkbenchPage` | "Thử lại danh sách N — Không có tác vụ lỗi cần thử lại." | Trung tính | đỏ (thông tin) | xám | ✔ |
| `DownloadWorkbenchPage` | "Đã dọn tiến trình / nhật ký danh sách N" | Thông tin | đỏ | xanh dương | — (mức đúng, màu đổi) |
| `DownloadWorkbenchPage` | "Đã xóa danh sách N", "Đã thay đổi số danh sách" | Thông tin | đỏ | xanh dương | — |
| `DownloadMergePage` | "Quy trình ghép N đã hủy riêng" | Trung tính | vàng | xám | ✔ |
| `DownloadMergePage` | "Quy trình ghép N đã tạm dừng an toàn" | Trung tính | xanh lá | xám | ✔ |
| `DownloadMergePage` | "Thử lại quy trình ghép — Không có tác vụ lỗi…" | Trung tính | đỏ | xám | ✔ |
| `DownloadMergePage` | "Đã dọn…", "Đã xóa quy trình ghép N", "Đã áp dụng giới hạn ghép" | Thông tin | đỏ | xanh dương | — |
| `QueuePage` | "<Nhóm>: đã tạm dừng / đã hủy" (mọi tác vụ nhận lệnh) | Trung tính | xanh lá | xám | ✔ |
| `QueuePage` | "<Nhóm>: đã tiếp tục / đã thử lại" | Thành công | xanh lá | xanh lá | — |
| `QueuePage` | Lệnh chỉ đến được một phần tác vụ (ví dụ 2/3) | Cảnh báo | vàng | vàng | — |
| `QueuePage` | "Đã dọn hàng đợi", "Đã xóa tác vụ" | Thông tin | đỏ | xanh dương | — |
| `QueuePage` | "Đã xóa dữ liệu hàng đợi" | Thành công | vàng | xanh lá | ✔ |
| `QueuePage` + `Topbar` | "Đã tạm dừng tất cả" | Trung tính | vàng | xám | ✔ |
| `QueuePage` + `Topbar` | "Đã tiếp tục tất cả" | Thành công | xanh lá | xanh lá | — |
| `SettingsPage` | "Đã lưu cài đặt", "Đã áp dụng cấu hình tối ưu", "Đã lưu Cấu hình…" | Thành công | xanh lá | xanh lá | — |
| `SettingsPage` | "Đã tạo cấu hình khuyến nghị" | Thông tin | đỏ | xanh dương | — |
| `ToolsPage` | Kết quả công cụ (kiểm tra/sửa/cập nhật) | Thành công | xanh lá | xanh lá | — |
| `ToolsPage` | "Đã mở thư mục công cụ" | Thông tin | đỏ | xanh dương | — |
| `LogsPage` | "Đã xóa nhật ký…" | Thông tin | đỏ | xanh dương | — |
| `VideoLinkFilterPage` | "Đã lọc video theo link" / "…có mục cần kiểm tra" | Thành công / Cảnh báo | xanh lá / vàng | xanh lá / vàng | — |
| `CookieManagerDialog` | "Cookies đã được cập nhật" | Thành công | xanh lá | xanh lá | — |
| `NotificationCenter` | "Đã sao chép đường dẫn" / "Không thể mở vị trí đầu ra" / "…sao chép" | Thành công / Cảnh báo | xanh lá / vàng | xanh lá / vàng | — |
| `use-desktop-events` | "Đã có Tubmedia X" (bản mới) | Thông tin | đỏ | xanh dương | — |
| `use-desktop-events` | "Bản cập nhật đã sẵn sàng" | Thành công | xanh lá (cố định) | xanh lá (tự tắt) | ✔ không còn cố định |
| `use-desktop-events` | "Cần thêm Cookies" | Cảnh báo | vàng (cố định) | vàng (tự tắt; việc vẫn hiện ở khung chặn) | ✔ |

## B. Thông báo gửi từ tiến trình chính (`queue-manager`)

Các thông báo này **đã có mức rõ ràng** từ nguồn (`AttentionNotice.severity`), không đoán từ chữ.

| Mã / tình huống | Mức thật | Màu cũ | Màu mới | Ghi chú |
|---|---|---|---|---|
| `DISK_FULL` (đã tạm dừng an toàn) | Cảnh báo | vàng (cố định) | vàng (tự tắt; nằm lại ở khung chặn của tác vụ) | mức do mã nguồn quyết định |
| `PERMISSION_DENIED`, `SOURCE_RATE_LIMITED`, `NETWORK_CIRCUIT_OPEN` | Cảnh báo | vàng | vàng | — |
| Công cụ thiếu / lỗi ghép / lỗi xử lý (không tự phục hồi) | Lỗi | đỏ (cố định) | đỏ (không tự tắt, đóng được) | — |
| Lỗi ngoài có thể phục hồi (mạng, máy chủ nguồn) | Cảnh báo | vàng | vàng | — |
| `DISK_SPACE_RECOVERED` | Thành công | xanh lá | xanh lá | — |

## C. Lỗi đi qua IPC (điều kiện chặn, thất bại) — nay có mức theo MÃ, không theo chữ

Trước đây mọi lỗi lạ đều rơi vào mức "lỗi" (đỏ). Nay lỗi nghiệp vụ (`AppError`) mang dấu kiểu (mức + mã) qua IPC.
Các cột "Màu cũ" lấy từ chạy thật `friendlyIssue` v1.3.7.

| Lỗi | Mã | Mức thật | Màu cũ | Màu mới |
|---|---|---|---|---|
| "Hãy tạm dừng hoặc hoàn tất mọi tác vụ… trước khi cập nhật." | `UPDATE_BLOCKED_ACTIVE_WORK` | Cảnh báo | **đỏ** | vàng |
| "Chỉ có thể cài phiên bản mới hơn… đã chặn thao tác hạ cấp." | `UPDATE_NOT_NEWER` | Thông tin | **đỏ** | xanh dương |
| "Không thể tải trọn vẹn bản cập nhật…" (mất mạng, tệp hỏng, sai mã băm) | `UPDATE_DOWNLOAD_FAILED` | Cảnh báo | **đỏ** | vàng |
| "Chưa thể chuẩn bị cập nhật an toàn…" | `UPDATE_INSTALL_PREPARATION_FAILED` | Cảnh báo | **đỏ** | vàng |
| "Không thể kiểm tra bản cập nhật." (huy hiệu `Cần thử lại`) | trạng thái `error` | Cảnh báo | đỏ | vàng (kèm hướng dẫn) |
| "Tác vụ đã bị hủy." | `PROCESS_CANCELLED` | Trung tính | **đỏ** | xám |
| Video đã bị xóa khỏi nền tảng | `SOURCE_REMOVED` | Trung tính | xanh lá (bỏ qua) | xám |
| "Không có gì để dọn." | (chữ) | Trung tính | **vàng** (cảnh báo) | xám |
| Cookies hết hạn / cần đăng nhập / bị khóa / sai định dạng | `COOKIES_EXPIRED`… | Cảnh báo | vàng | vàng |
| Dữ liệu nhập chưa hợp lệ (`ZodError`) | `INVALID_INPUT` | Cảnh báo | vàng | vàng |
| Ổ đĩa không đủ dung lượng | `DISK_FULL` | Lỗi | đỏ | đỏ |
| Thiếu công cụ bắt buộc | `TOOL_NOT_FOUND` | Lỗi | đỏ | đỏ |
| Thành phẩm bị hậu kiểm chặn (frame lỗi, timestamp) | `VERIFICATION_FAILED` | Lỗi | đỏ | đỏ |
| Lỗi lạ chưa phân loại | (không có) | Lỗi | đỏ | đỏ (giữ, an toàn hơn là nói nhẹ đi) |

## D. Nhãn trạng thái (`StatusBadge`)

Trước đây mỗi trạng thái một màu cố định (hồng, tím, cam, ngọc…), dùng mã màu viết cứng nên không kiểm được
tương phản. Nay màu theo **mức** và luôn kèm biểu tượng + chữ.

| Trạng thái | Mức | Màu cũ | Màu mới |
|---|---|---|---|
| Hoàn tất | Thành công | xanh lá | xanh lá |
| Đang tải / phân tích / kiểm tra / chuẩn hóa / xử lý / ghép / thử lại | Thông tin (đang chạy) | xanh dương, tím, cam, hồng… (mỗi trạng thái một màu) | xanh dương |
| Tạm dừng | Trung tính | vàng đậm | xám (biểu tượng ⏸) |
| Đã hủy | Trung tính | xám | xám |
| Đã bỏ qua | Trung tính | xanh lá nhạt | xám (biểu tượng ⏭) |
| Đang chờ / nháp / sẵn sàng | Trung tính | tím / xám / ngọc | xám (biểu tượng đồng hồ) |
| Bị gián đoạn | Cảnh báo | **hồng đỏ** (biểu tượng cảnh báo) | vàng |
| Có lỗi / hỏng | Lỗi | đỏ | đỏ |
| Mức nhật ký `info` / `warn` / `error` / `debug` | Thông tin / Cảnh báo / Lỗi / Trung tính | theo bảng màu riêng | theo mức |

## E. Khung trong trang, huy hiệu và hộp thoại

| Thành phần | Mức thật | Màu cũ | Màu mới | Ghi chú |
|---|---|---|---|---|
| Thông báo nổi (`AttentionCenter`) | theo mức | chữ + viền theo `--bad/--warn/--good/--accent` | nền/viền/chữ/biểu tượng theo bảng màu + nhãn chữ | chuyển xuống góc dưới-phải, không che tiêu đề |
| Trung tâm thông báo (từng mục) | theo mức | chữ tô màu | nền/viền theo mức + nhãn chữ | — |
| Khung chẩn đoán (`DiagnosticDock`) | theo **mức dòng nhật ký** | luôn biểu tượng cảnh báo, viền đỏ | theo mức nhật ký, biểu tượng đúng mức | trước đây đoán từ chữ |
| Huy hiệu cập nhật (`update-state-*`) | Cảnh báo khi không cập nhật được | đỏ | vàng | ✔ |
| Thông điệp tác vụ ở Hàng đợi | theo mức sự cố | **mọi mức khác "cảnh báo" đều tô đỏ** | màu theo đúng mức | ✔ sửa lỗi ánh xạ |
| Khung "đang bị chặn" (`blocking-*`) | theo mức | chỉ có cảnh báo và lỗi | đủ năm mức | ✔ |
| Nhãn mức an toàn của Dọn dẹp | Thành công / Cảnh báo | xanh lá, xanh dương, vàng, **đỏ** ("Thay đổi hệ thống") | xanh lá / vàng | ✔ không còn đỏ |
| Thẻ hạng mục Dọn dẹp được chọn | — | **viền đỏ** | viền đen than | ✔ |
| `ConfirmDialog` (xóa, hủy) | Nguy hiểm khi xóa thật | đỏ cam gradient | nút nguy hiểm đỏ đặc `#B3261E` | đỏ chỉ ở nút nguy hiểm |
| `window.confirm` / `window.prompt` (Dọn dẹp: 2 + 1 chỗ) | — | hộp thoại gốc của hệ điều hành | **chưa đổi** | sẽ thay bằng `ConfirmDialog` ở Giai đoạn 4 khi viết lại trang Dọn dẹp (bỏ PowerShell/Admin) |
| Màn hình khởi động thất bại | Lỗi | đỏ | đỏ | đúng mức |

## Cách kiểm tra tự động

- `tests/unit/notice-tone.test.ts`: mức theo mã lỗi (mọi mã của `AppError` phải được phân loại rõ), mức theo trạng thái,
  "hủy / tạm dừng / bỏ qua / không có gì để dọn" **không bao giờ là lỗi**, dấu kiểu qua IPC.
- `tests/unit/ipc-wire-error.test.ts`: lỗi nghiệp vụ mang đúng mức qua IPC; điều kiện chặn cập nhật là lỗi có kiểu.
- `tests/unit/color-tokens.test.ts`: tương phản WCAG của từng mức ở cả hai giao diện; màu nhấn không đỏ/xanh dương; đỏ chỉ ở mức lỗi.
- `tests/unit/notice-components.test.ts`: mọi mức có biểu tượng + nhãn chữ; thông báo nổi ở góc dưới-phải; chỉ lỗi không tự tắt;
  không còn `setError` với chuỗi cố định.
- `node scripts/capture-ui-screenshots.mjs --audit`: quét giao diện THẬT tìm màu đỏ ngoài bảng màu và chữ thiếu tương phản.
