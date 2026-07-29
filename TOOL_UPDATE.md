# Tool Update

## Tự nhận tool portable

Ứng dụng tìm theo thứ tự:

1. Đường dẫn người dùng cấu hình trên giao diện.
2. `<project>\tool` khi chạy source/dev.
3. `userData\tools\current` cho tool đã update trong bản cài đặt.
4. `resources\tool` hoặc `resources\tools` trong installer.
5. PATH của Windows.

Các file hỗ trợ:

- `yt-dlp.exe`
- `ffmpeg.exe`
- `ffprobe.exe`
- `ffplay.exe`
- `aria2c.exe`

## Updater tích hợp

Không bắt buộc Tool Manifest URL.

- yt-dlp: lấy từ trang phát hành `yt-dlp/yt-dlp`; channel beta dùng nightly builds.
- FFmpeg/ffprobe/ffplay: lấy cùng một package Windows x64 từ `BtbN/FFmpeg-Builds`.
- aria2c: lấy từ trang phát hành `aria2/aria2`.

Quy trình update:

1. Không cho update khi tool đang chạy.
2. Tải vào staging.
3. Kiểm tra kích thước và SHA-256 khi release API có digest.
4. Giải nén và chạy version test trên file mới.
5. Backup file hiện tại.
6. Thay file bằng rename an toàn.
7. Chạy Health Check sau cài.
8. Nếu lỗi, tự rollback.

## Nút trên giao diện

- **Health Check**: chỉ kiểm tra.
- **Sửa chữa tất cả**: tải lại package bị thiếu hoặc hỏng.
- **Cập nhật tất cả**: cập nhật toàn bộ package.
- **Rollback**: quay về backup gần nhất.
- **Mở folder tool**: mở đúng folder writable mà app đang quản lý.

## PowerShell fallback

Khi Electron chưa mở được, chạy trực tiếp:

```powershell
npm.cmd run tools:check:windows
npm.cmd run tools:repair:windows
npm.cmd run tools:update:windows
```
