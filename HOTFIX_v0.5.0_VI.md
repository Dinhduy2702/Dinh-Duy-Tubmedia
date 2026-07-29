# Video Download & Merge Studio Pro v0.5.0

## Mục tiêu

Bản v0.5.0 xử lý hai vấn đề chính: Tool Center phải được nhận giống nhau ở cả workflow tải và workflow tải-ghép; giao diện phải hiện đại, sáng, responsive và cho phép dọn dữ liệu cũ mà không xóa nhầm video.

## Tool Center dùng chung

`WorkbenchService.startDownload()` và `WorkbenchService.startMerge()` đều chạy cùng một `assertDownloadReady()`, dùng cùng singleton `ToolManager`. Giao diện hai trang hiện có `ToolReadinessPanel` giống nhau để Health Check, hiển thị phiên bản và đường dẫn thực tế của yt-dlp, FFmpeg và ffprobe.

## Dọn danh sách, pipeline và tiến trình

- Xóa một danh sách/pipeline: hủy tiến trình nền, dọn queue, input, project và log trong ứng dụng.
- File source, video đã tải và thành phẩm trên ổ đĩa không bị xóa.
- Xóa một dòng tiến trình chỉ áp dụng cho job đã kết thúc.
- Dọn hàng loạt chỉ xóa project có toàn bộ dependency đã kết thúc.
- Job đang chạy, đang chờ hoặc pipeline còn dependency được bảo vệ.

## Giao diện Aurora

- Theme Light mặc định cho cài đặt mới; cài đặt cũ giữ theme đã lưu.
- Sidebar/Topbar mới, màu gradient tươi, card kính mờ, hover/loading/progress animation.
- Responsive theo các mốc 1260 px, 980 px và 720 px.
- Tự giảm animation khi Windows bật Reduce Motion.
- Hộp xác nhận riêng thay cho thông báo kỹ thuật thô.

## Nhà phát triển

**Đình Duy Tubmedia** được hiển thị tại Sidebar, trang Giới thiệu và metadata package.
