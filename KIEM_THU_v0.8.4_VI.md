# Biên bản kiểm tra Tubmedia v0.8.4

## Lỗi và yêu cầu đã xử lý

- Bảng `Video cần đăng nhập hoặc cookies` vẫn còn sau khi người dùng thêm cookies thành công.
- Thông báo nổi có thời gian hiển thị không đồng nhất và lâu hơn 3 giây.
- Mã `AUTHENTICATION_REQUIRED` cần được giữ để lần tải lại gắn cookies, nhưng không được tiếp tục làm giao diện hiện cảnh báo khi tác vụ đã chờ chạy lại.

## Hành vi mới cần xác nhận trên Windows

1. Mở `Mở 3 cách thêm cookies` từ đúng danh sách đang bị chặn.
2. Xác nhận cookies bằng trình duyệt, nội dung dán trực tiếp hoặc tệp `cookies.txt`.
3. Hộp Cookies đóng sau khi xác nhận.
4. Bảng hướng dẫn cookies của đúng danh sách biến mất khi tác vụ chuyển sang chờ chạy lại.
5. Danh sách khác không bị tạm dừng hoặc tiếp tục ngoài ý muốn.
6. Lần tải lại vẫn gắn cookies cho đúng video đã yêu cầu xác thực.
7. Mọi thông báo nổi tự biến mất sau đúng 3 giây; nút đóng thủ công vẫn hoạt động.
8. Lỗi chi tiết của từng video vẫn còn ở trang Tiến trình và nhật ký để kiểm tra.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.4_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Chưa tạo installer trong vòng kiểm tra source này.
