# Kiểm thử Tubmedia v0.10.1

Bản này sửa ba lỗi unit test còn lại của v0.10.0:

1. Source có đầy đủ `installer/identity.json`.
2. Source có đầy đủ `installer/video-studio-pro.nsi` và giữ cơ chế cập nhật tại chỗ.
3. Chế độ giữ dung lượng dùng `target.videoBitrate` đã tính từ toàn bộ nguồn trước khi fallback về bitrate riêng của từng tệp.

Chạy trên Windows:

```powershell
npm.cmd install
npm.cmd run verify:v0101
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```
