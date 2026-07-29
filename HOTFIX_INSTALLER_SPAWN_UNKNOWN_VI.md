# Hotfix installer NSIS cho lỗi `spawn UNKNOWN`

Bản vá giữ nguyên ứng dụng 0.5.1 và chỉ thay quy trình tạo installer.

## Nguyên nhân

`electron-builder` đã đóng gói thành công `release\win-unpacked`, nhưng dừng ở bước chạy một uninstaller tạm thời để xử lý chữ ký. Trên máy có App Control/Code Integrity, tiến trình tạm có thể bị Windows chặn và Node chỉ trả `spawn UNKNOWN`.

## Cách mới

- Dùng `electron-builder --dir` để tạo `win-unpacked`.
- Dùng NSIS compiler đã được electron-builder tải để biên dịch installer trực tiếp.
- Không chạy uninstaller tạm trong lúc build.
- Loại bỏ `resources\tool\.backups` khỏi installer để tránh gói phình rất lớn.
- Tạo file SHA-256 tự động.

## Lệnh

```powershell
npm.cmd run dist
```

Lệnh cũ vẫn còn để chẩn đoán:

```powershell
npm.cmd run dist:electron-builder
```
