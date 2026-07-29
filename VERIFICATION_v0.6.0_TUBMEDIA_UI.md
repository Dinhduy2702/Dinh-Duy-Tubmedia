# Verification — Download video Tubmedia v0.6.0

## Phạm vi thay đổi

- Đổi product name và tên file installer thành `Download video Tubmedia`.
- Thiết kế lại toàn bộ lớp giao diện bằng theme đỏ/trắng Tubmedia.
- Hỗ trợ giao diện `system`, `light`, `dark`.
- Thiết kế lại Sidebar, Topbar, Trung tâm công cụ và About.
- Thêm logo vector Tubmedia và icon Windows mới.
- Sửa responsive/overflow bằng auto-fit grid, min-width an toàn và breakpoint mới.
- Giữ nguyên backend tải, ghép, queue, database, cookies và CPU fallback của v0.5.1.
- Giữ NSIS safe build cho PowerShell 5.1; sửa chuỗi UninstallString.

## Kiểm tra đã thực hiện trong môi trường tạo patch

- Parse `package.json`: PASS.
- Parse cú pháp 105 file TypeScript/TSX bằng TypeScript compiler parser: 0 lỗi cú pháp.
- Kiểm tra import có khả năng không sử dụng trong các file được viết lại: không phát hiện.
- Kiểm tra cân bằng dấu ngoặc CSS:
  - `styles.css`: PASS.
  - `tubmedia-theme.css`: PASS.
- Kiểm tra mojibake phổ biến trong source mới: không phát hiện.
- Kiểm tra `build-installer-windows.ps1` chỉ chứa ASCII để tương thích Windows PowerShell 5.1: PASS.
- Kiểm tra product name, version, theme mặc định và import theme mới: PASS.
- Kiểm tra icon PNG/ICO có thể đọc và đóng gói: PASS.
- Kiểm tra cấu trúc patch và full source: PASS.

## Chưa xác nhận trong môi trường tạo patch

Môi trường tạo patch không có `node_modules` của project và không có Electron Windows runtime, nên chưa chạy trực tiếp:

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test`
- `npm.cmd run test:integration`
- `npm.cmd run build`
- `npm.cmd run dist`

Các lệnh này cần chạy trên máy Windows của người dùng trước khi phát hành installer.
