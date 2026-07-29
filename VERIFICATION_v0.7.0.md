# Xác minh — Download video Tubmedia v0.7.0

## Kết quả trong môi trường phát triển

- `npm run typecheck`: **PASS**.
- `npm run lint`: **PASS**, không có cảnh báo.
- `npm run test`: **PASS**, 12 tệp và 39 kiểm thử.
- `npm run test:integration`: **PASS**, 1 tệp và 5 kiểm thử SQLite.
- `npm run build`: **PASS** cho main, preload và renderer.
- `PRAGMA integrity_check`: **ok**.
- Icon PNG: 1024 × 1024, RGBA, nền trong suốt.
- Icon ICO: đủ khung 16, 20, 24, 32, 40, 48, 64, 128 và 256 px.

## Các hồi quy đã được kiểm tra

- Nhập ở chế độ thay thế không làm dữ liệu cũ xuất hiện lại.
- Xóa dự án kích hoạt khóa ngoại và dọn dữ liệu phụ thuộc.
- Xóa mọi dự án trùng mã từ phiên bản cũ.
- Xóa toàn bộ dọn dự án, mục nhập, lô nhập, hàng đợi theo dự án và tác vụ toàn ứng dụng.
- `queue:remove` trả kết quả bảo vệ thay vì ném lỗi khi tác vụ chưa đủ điều kiện xóa.
- Bootstrap chờ quá trình tự động kiểm tra công cụ hoàn tất trước khi hiển thị trạng thái.
- Trình dựng sản xuất tạo thành công mã main, preload và renderer.

## Nghiệm thu bổ sung trên Windows

1. Cài ứng dụng và xác nhận Desktop/Start Menu dùng icon Tubmedia không viền đen.
2. Mở ứng dụng; công cụ tự chuyển sang Sẵn sàng mà không cần bấm Kiểm tra lại.
3. Đang tải hoặc ghép, nhấn Tạm dừng tất cả và xác nhận CPU/đĩa của yt-dlp/FFmpeg dừng; nhấn Tiếp tục tất cả để chạy tiếp.
4. Thu hẹp cửa sổ dưới 760 px và xác nhận điều hướng chuyển xuống đáy, không che nút hay nội dung.
5. Xóa toàn bộ, mở lại ứng dụng và xác nhận danh sách, quy trình và tiến trình cũ không xuất hiện.
6. `npm.cmd run dist` tạo `Download video Tubmedia-Setup-0.7.0-x64.exe`.
