# Application Update

Ứng dụng dùng `electron-updater` với generic feed URL cấu hình trên UI. Quy trình: check → download → xác minh metadata → đảm bảo queue không chạy → backup database → cài khi restart. App update không gộp tool update.

Installer thủ công và bản do `electron-updater` gọi phải giữ nguyên định danh trong `installer/identity.json`. Bản mới đọc khóa Registry ổn định `Software\Tubmedia\DownloadVideo` và `InstallLocation` của các bản cũ, sau đó cập nhật tại chỗ. Không thêm version vào app ID, product name, khóa Registry hoặc tên thư mục cài đặt.
