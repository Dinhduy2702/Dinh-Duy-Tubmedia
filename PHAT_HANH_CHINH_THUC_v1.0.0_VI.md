# Phát hành chính thức Tubmedia 1.0.0

## Tạo installer

Mở PowerShell trong thư mục source và chạy:

```powershell
npm.cmd run dist:official
```

Quy trình tự động cài dependency, kiểm tra bản ổn định, typecheck, lint, unit test, integration test, chuẩn bị công cụ và build NSIS.

Sản phẩm cuối:

```text
release\Download video Tubmedia-Setup-1.0.0-x64.exe
release\Download-video-Tubmedia-1.0.0-SHA256.txt
```

## Phạm vi gỡ cài đặt

Uninstaller chỉ xóa thư mục cài đặt của Tubmedia cùng shortcut và khóa Registry của ứng dụng. Video trong thư mục người dùng chọn như `E:\Ghép video` không nằm trong thư mục cài đặt và không bị xóa. Cấu hình/database trong AppData được giữ lại để cài lại hoặc nâng cấp không mất trạng thái.

## Cập nhật trực tuyến

Bản 1.0.0 có sẵn Trung tâm cập nhật nhưng không tự truy cập mạng khi chưa có `app-update.yml` hoặc URL HTTPS. Muốn phát hành bản 1.0.1 qua ứng dụng, cần thiết lập máy chủ cập nhật rồi dùng `npm.cmd run release:windows`.
