# KIỂM THỬ TUBMEDIA v0.9.8

## Mục tiêu

Khắc phục lỗi Electron main process bị đóng do SQLite nhận `NULL` cho cột `queue_jobs.progress` khi FFmpeg/yt-dlp phát ra một dòng tiến trình không hợp lệ.

## Các lớp bảo vệ

1. QueueManager chuẩn hóa mọi phần trăm về 0–100 và dùng tiến trình gần nhất khi nhận NaN/Infinity.
2. QueueRepository kiểm tra lại lần cuối trước khi ghi SQLite; không dữ liệu runtime lỗi nào được phép trở thành NULL.
3. Bộ đọc FFmpeg ở Normalize, Clip và Merge bỏ qua dòng `out_time_ms` không hợp lệ.
4. ProcessManager cô lập lỗi callback stdout/stderr; xử lý video tiếp tục thay vì làm Electron main process văng.
5. FfmpegProgressTracker trả số hữu hạn ngay cả khi duration nguồn bị thiếu hoặc lỗi.

## Test hồi quy đã thêm

- QueueRepository nhận NaN/Infinity mà database vẫn toàn vẹn.
- Bộ chuẩn hóa progress clamp 0–100 và giữ fallback hợp lệ.
- FFmpeg tracker với total duration NaN vẫn trả progress hữu hạn.
- Callback đọc tiến trình cố tình throw không làm child process hoặc main process thất bại.

## Cách xác nhận trên Windows

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```
