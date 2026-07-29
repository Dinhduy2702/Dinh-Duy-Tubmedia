# Hotfix v0.2.2 - Portable Tool Folder & Built-in Tool Repair

## Sửa lỗi chính

Ứng dụng trước đây chỉ tìm tool trong PATH, cấu hình thủ công, `resources/tools` hoặc vùng managed. Bản 0.2.2 tự nhận trực tiếp:

```text
<project>\tool\yt-dlp.exe
<project>\tool\ffmpeg.exe
<project>\tool\ffprobe.exe
<project>\tool\ffplay.exe
<project>\tool\aria2c.exe
```

Vì vậy khi chạy source bằng `npm.cmd run dev`, không cần thêm tool vào PATH và không cần nhập từng đường dẫn trong Settings.

## Công cụ mới trên giao diện

Trang **Công cụ** có:

- **Health Check**: kiểm tra đúng file thực tế, version và capability.
- **Sửa chữa tất cả**: chỉ tải lại package bị thiếu hoặc hỏng.
- **Cập nhật tất cả**: cập nhật yt-dlp, bộ FFmpeg và aria2c theo thứ tự an toàn.
- **Mở folder tool**: mở đúng thư mục đang được ứng dụng quản lý.
- **Rollback**: khôi phục bản backup gần nhất.

## Quy tắc cập nhật

- `yt-dlp.exe` được cập nhật riêng.
- `ffmpeg.exe`, `ffprobe.exe`, `ffplay.exe` luôn được cập nhật cùng một package để tránh lệch version.
- `aria2c.exe` được cập nhật riêng.
- File mới được chạy thử trước khi thay file cũ.
- File cũ được backup trước khi thay.
- Sau khi thay, Health Check chạy lại; nếu lỗi thì rollback tự động.
- Source/dev cập nhật trực tiếp vào `<project>\tool`.
- Installer cập nhật vào `userData\tools\current`, không yêu cầu quyền Administrator.

## Build installer

Folder `tool` được thêm vào `extraResources`. Khi build installer, các file EXE có trong folder này sẽ được đóng gói vào `resources\tool`.

## Sửa tool ngay cả khi giao diện chưa mở được

```powershell
npm.cmd run tools:check:windows
npm.cmd run tools:repair:windows
npm.cmd run tools:update:windows
```

- `check`: chỉ kiểm tra các file trong `<project>\tool`.
- `repair`: chỉ tải lại file bị thiếu/hỏng.
- `update`: tải mới toàn bộ tool.
