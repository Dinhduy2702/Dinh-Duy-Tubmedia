# KIỂM THỬ TUBMEDIA v1.0.0 RC4

## Mục tiêu

RC4 sửa bài kiểm thử khởi động còn dùng API cũ `healthCheckRequired()` trực tiếp.
Luồng ứng dụng hiện tại dùng `ensureRequiredReady()` để:

1. kiểm tra ba công cụ bắt buộc;
2. tự sửa/cài nếu thiếu;
3. kiểm tra lại sau khi sửa;
4. chỉ sau đó mới kiểm tra công cụ tùy chọn.

## Lệnh kiểm thử

```powershell
npm.cmd install
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

## Kết quả bắt buộc

- Unit test: 150/150 đạt.
- Integration test: 15/15 đạt.
- Dev app mở bình thường.
- Trung tâm công cụ nhận đủ yt-dlp, ffmpeg, ffprobe.
