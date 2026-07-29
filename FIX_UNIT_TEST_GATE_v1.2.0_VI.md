# Tubmedia 1.2.0 FIX2 – sửa cổng Unit Test

Bản FIX2 xử lý 7 unit test thất bại sau khi ESLint đã đạt.

## Phân loại

- `brand-layout.test.ts`: cập nhật assertion theo cấu trúc JSX có class mới của logo trong app.
- `installer-upgrade.test.ts`: sửa assertion ký tự gạch chéo của đường dẫn NSIS; script installer thực tế đã đúng.
- `merge-target.test.ts`: đồng bộ test với thuật toán smart merge chọn định dạng nguồn chiếm ưu thế để tránh tạo mục tiêu lai tốn mã hóa.
- `normalize-engine-stream-copy.test.ts`: tạo tệp nguồn giả trước khi kiểm tra cache key; trước đây test truyền đường dẫn không tồn tại nên `stat()` báo ENOENT.

Các thay đổi này không bỏ kiểm tra chất lượng. Chúng sửa dữ liệu kiểm thử và kỳ vọng cũ để tiếp tục kiểm tra đúng hành vi hiện tại.
