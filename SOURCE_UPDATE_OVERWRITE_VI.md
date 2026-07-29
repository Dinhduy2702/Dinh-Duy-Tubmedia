# Cập nhật trực tiếp vào source Tubmedia cũ

Từ v0.9.0, gói `Tubmedia_SOURCE_UPDATE_OVERWRITE_vX.Y.Z.zip` không còn bọc mã nguồn trong một thư mục mang tên phiên bản mới.

## Cách cập nhật

1. Thoát Tubmedia và cửa sổ `npm.cmd run dev`.
2. Sao lưu thư mục source hiện tại một lần nếu đang có code tự chỉnh.
3. Mở ZIP cập nhật.
4. Giải nén toàn bộ nội dung **trực tiếp vào đúng thư mục source cũ**.
5. Khi Windows hỏi, chọn **Replace the files in the destination / Ghi đè tất cả**.
6. Mở PowerShell tại chính thư mục source cũ rồi chạy:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run dev
```

Các thư mục sinh ra trên máy như `node_modules`, `out`, `release`, `tmp` và thư mục công cụ `tool` không nằm trong ZIP nên không bị đóng gói thành rác hoặc ghi đè công cụ đang hoạt động. Source cập nhật chứa đầy đủ code hiện tại để có thể ghi đè từ bản v0.8.7, v0.8.8 hoặc v0.8.9.

## Build và cập nhật ứng dụng đã cài

Sau khi source chạy ổn:

```powershell
npm.cmd run dist
```

Installer mới tự tìm `InstallLocation` của Tubmedia đang cài, bỏ qua trang chọn thư mục khi phát hiện bản cũ và ghi đè chương trình tại đúng chỗ cũ. Project, setting, history và database nằm ngoài thư mục cài đặt nên được giữ nguyên.

Muốn tạo lại gói source có cấu trúc ghi đè:

```powershell
npm.cmd run dist:source-update
```
