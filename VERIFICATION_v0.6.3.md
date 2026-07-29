# Verification — Download video Tubmedia v0.6.3

## Kết quả đã kiểm tra trong môi trường tạo bản vá

- 103 tệp triển khai TypeScript/TSX: **0 lỗi cú pháp** bằng TypeScript `transpileModule`.
- `package.json`: **JSON hợp lệ**.
- Ký tự khoảng trắng ẩn NBSP/zero-width/BOM trong mã nguồn: **không phát hiện**.
- Kiểm thử chạy thật các repository SQLite bằng `node:sqlite`:
  - nhập ở chế độ thay thế ghi đè dữ liệu cũ: **PASS**;
  - lô nhập cũ được xóa trước khi ghi lô mới: **PASS**;
  - xóa dự án kích hoạt khóa ngoại và xóa dữ liệu phụ thuộc: **PASS**;
  - tìm và xóa nhiều dự án trùng mã cũ: **PASS**;
  - `PRAGMA integrity_check`: **ok**.
- Kiểm thử chạy thật `QueueManager` với repository/process mock:
  - tạm dừng tất cả dự án: **PASS**;
  - tiếp tục tất cả dự án: **PASS**;
  - xóa dòng chưa kết thúc trả về `false`, không ném lỗi: **PASS**;
  - xóa dòng kết thúc sau khi phụ thuộc hoàn tất: **PASS**.
- Cấu trúc ZIP của bản vá và full source: **PASS**, không có lỗi dữ liệu nén.
- Chính sách cookies on-demand vẫn được giữ:
  - không gắn cookies ở lần tải công khai đầu tiên;
  - chỉ gắn cookies sau tín hiệu yêu cầu xác thực;
  - không có cấu hình cookies thì không tự gắn cookies.

## Chưa thể xác nhận trong môi trường tạo bản vá

Môi trường tạo bản vá không có đầy đủ `node_modules`, Electron runtime và Windows NSIS của project, vì vậy chưa chạy được toàn bộ các lệnh sau tại đây:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run dist
```

Các lệnh này bắt buộc phải chạy trên máy Windows của người dùng trước khi phát hành installer.

## Điều kiện nghiệm thu trên Windows

1. `npm.cmd run check` hoàn tất không lỗi và không cảnh báo lint.
2. Mở app không cần bấm **Kiểm tra lại**, trạng thái công cụ tự chuyển sang **Sẵn sàng**.
3. Sửa dữ liệu, chờ ít nhất 1 giây, khởi động lại và thấy đúng dữ liệu mới.
4. Xóa danh sách hoặc xóa toàn bộ, khởi động lại và không thấy dữ liệu cũ xuất hiện.
5. **Tạm dừng tất cả/Tiếp tục tất cả** tác động đến cả danh sách tải và quy trình tải–ghép.
6. Không còn log lặp `Error occurred in handler for 'queue:remove'`.
7. Video công khai không làm xuất hiện yêu cầu cookies.
8. `npm.cmd run dist` tạo `Download video Tubmedia-Setup-0.6.3-x64.exe`.
