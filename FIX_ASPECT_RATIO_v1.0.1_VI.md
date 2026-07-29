# TUBMEDIA 1.0.1 — HOTFIX KHUNG HÌNH VIDEO GHÉP

## Lỗi đã sửa

Video tải riêng vẫn đúng khung nhưng khi ghép, clip độ phân giải thấp hơn canvas đích bị giữ nguyên kích thước rồi chèn nền đen bốn phía. Điều này làm hình ảnh trông bị bóp và thu nhỏ.

## Cách sửa

- Nguồn cùng tỷ lệ: scale đúng kích thước canvas đích, không pad.
- Nguồn khác tỷ lệ: scale lấp đầy và crop cân giữa, không pad nền đen.
- Khi mã hóa lại luôn đặt SAR = 1.
- Thêm kiểm thử tự động để lỗi không quay lại.

## Build trên Windows

Mở PowerShell trong thư mục source rồi chạy:

```powershell
npm.cmd install
npm.cmd run verify:stable
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\BUILD_INSTALLER_CHINH_THUC.ps1
```

Installer dự kiến:

```text
release\Download video Tubmedia-Setup-1.0.1-x64.exe
```

## Kiểm tra bắt buộc

Ghép lại đúng bộ video từng bị lỗi. Thành phẩm phải lấp đầy khung 16:9, không còn viền đen bốn phía. So sánh bằng Media Player và VLC.
