# Tubmedia 1.2.0 FIX4 – Đóng gói FFmpeg/FFprobe vào installer

## Lỗi

Máy build có FFmpeg/FFprobe chạy được từ PATH hoặc WinGet nên bước kiểm tra công cụ báo `Ok = True`. Tuy nhiên các tệp `ffmpeg.exe` và `ffprobe.exe` không tồn tại trong thư mục `tool` của source. Vì electron-builder chỉ đóng gói thư mục source, bản `win-unpacked` chỉ có yt-dlp và build dừng tại cổng kiểm tra payload.

## Sửa

- Tách kiểm tra công cụ hệ thống và kiểm tra công cụ vật lý trong `ProjectRoot\tool`.
- Chế độ `repair-required` luôn nhập/sao chép yt-dlp, FFmpeg và FFprobe vào thư mục `tool`, kể cả khi máy đã có bản chạy được trong PATH.
- Sau sửa chữa, kiểm tra lại riêng payload. Build dừng nếu thiếu bất kỳ công cụ bắt buộc nào.
- Thêm unit test chống tái diễn lỗi "PATH có FFmpeg nhưng installer không có FFmpeg".

## Kết quả mong đợi

Sau bước `Prepare required bundled tools`, thư mục source phải có:

- `tool\yt-dlp.exe`
- `tool\ffmpeg.exe`
- `tool\ffprobe.exe`

Sau khi electron-builder đóng gói, phải có:

- `release\win-unpacked\resources\tool\yt-dlp.exe`
- `release\win-unpacked\resources\tool\ffmpeg.exe`
- `release\win-unpacked\resources\tool\ffprobe.exe`
