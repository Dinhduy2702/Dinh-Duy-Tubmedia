# KIỂM THỬ TUBMEDIA v1.0.0 RC3

## Mục tiêu

Khóa lỗi `spawn ffmpeg ENOENT` / `spawn ffprobe ENOENT` khi chạy source mới hoặc cài ứng dụng trên máy chưa có công cụ.

## Chạy source

```powershell
npm.cmd install
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

Lệnh `dev` phải tự chạy `tools:repair-required:windows`. Lần đầu có thể mất vài phút vì tải FFmpeg. Những lần sau chỉ health-check nhanh.

## Kết quả bắt buộc

- Thư mục `tool` có `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `ffplay.exe`.
- Trung tâm công cụ báo ba công cụ bắt buộc `Sẵn sàng`.
- Bấm tải hoặc ghép không còn lỗi `spawn ... ENOENT`.
- Nếu GitHub API bị giới hạn, log phải cho biết chuyển sang đường tải trực tiếp.
- Nếu mạng chập chờn, log phải có tối đa 3 lượt thử thay vì dừng ngay.

## Build installer

`npm.cmd run release:windows` phải dừng ngay nếu thiếu bất kỳ công cụ bắt buộc nào. Installer thành công phải chứa các file trong `resources\tool`.
